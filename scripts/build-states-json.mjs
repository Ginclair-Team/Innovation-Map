// Joins the transcribed source tables on scripts/state-name-map.json, reconciles each table against the total
// printed in its source, computes per-capita values, scores and ranks, and writes:
//   data/states.json  +  public/data/states.json  +  public/data/sources.json  +  data/coverage.csv
//
// Rules enforced here:
//   - a value exists only if a source row exists; nothing is estimated, interpolated or backfilled
//   - an unmatched state name stops the build
//   - a table that does not reconcile with its printed total stops the build
import { mkdir, writeFile } from 'node:fs/promises';
import {
  COMPOSITE_METRICS, METRICS, SCALES, VIEWS,
  makeResolver, median, minMax, parseNumber, path, rankDesc, readCsv, readJson, round, viewValue,
} from './lib.mjs';

const METHODOLOGY_VERSION = 'IID-2M v1.0';
const WEIGHTS = { startups: 0.5, fdi_usd_m: 0.5 };

const nameMap = await readJson('scripts/state-name-map.json');
const sources = await readJson('data/sources.json');
const resolve = makeResolver(nameMap);
const fail = (msg) => { console.error(`\nBUILD FAILED: ${msg}\n`); process.exit(1); };
const stated = (text) => Number(String(text).trim().split(/\s+/)[0]);
const needSource = (id) => { if (!sources[id]) fail(`source_id "${id}" is not in data/sources.json`); return id; };

/** Read a table into Map<iso, row[]>, failing on unmatched names and on unexpected duplicates. */
async function loadTable(rel) {
  const file = rel.split('/').pop();
  const { meta, rows } = await readCsv(rel);
  const byIso = new Map();
  const skipped = [];
  for (const row of rows) {
    const iso = resolve(row.state_name, file);
    if (iso === 'SKIP') { skipped.push(row); continue; }
    if (!byIso.has(iso)) byIso.set(iso, []);
    byIso.get(iso).push(row);
  }
  const allowed = new Set(nameMap.multi_row_sum_allowed[file] ?? []);
  for (const [iso, list] of byIso) {
    if (list.length > 1 && !allowed.has(iso)) fail(`${file}: ${list.length} rows map to ${iso} and summing is not allowed for this file`);
  }
  return { meta, rows, byIso, skipped, file };
}

function reconcile(label, sum, stated, tolerance) {
  const diff = Math.abs(sum - stated);
  const ok = diff <= tolerance;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: rows sum to ${round(sum, 2)}, source prints ${stated} (diff ${round(diff, 2)}, tolerance ${tolerance})`);
  if (!ok) fail(`${label} does not reconcile with the total printed in the source`);
}

console.log('Reconciling tables against totals printed in the sources:');

// ---------- startups ----------
const startupsT = await loadTable('data/raw/startups/dpiit-recognised-startups-2026-06-30.csv');
needSource(startupsT.meta.source_id);
const startups = new Map();
for (const [iso, [row]] of startupsT.byIso) {
  startups.set(iso, { value: parseNumber(row.original_cell_text, startupsT.file), text: row.original_cell_text, name: row.state_name });
}
const startupsSum = [...startups.values()].reduce((a, d) => a + d.value, 0);
reconcile('DPIIT-recognised startups', startupsSum, stated(startupsT.meta.stated_total), 0);

// ---------- FDI cumulative ----------
const fdiT = await loadTable('data/raw/fdi/fdi-statewise-oct2019-mar2026.csv');
needSource(fdiT.meta.source_id);
const fdi = new Map();
for (const [iso, [row]] of fdiT.byIso) {
  fdi.set(iso, {
    value: parseNumber(row.usd_million_text, fdiT.file),
    inr: parseNumber(row.inr_crore_text, fdiT.file),
    text: row.usd_million_text, name: row.state_name, sr: row.sr_no,
  });
}
const notIndicated = fdiT.skipped.find((r) => /not indicated/i.test(r.state_name));
if (!notIndicated) fail('FDI table: "State Not Indicated" row is missing');
const notIndicatedUsd = parseNumber(notIndicated.usd_million_text, fdiT.file);
const fdiSum = [...fdi.values()].reduce((a, d) => a + d.value, 0) + notIndicatedUsd;
reconcile('FDI equity inflow Oct 2019-Mar 2026 (USD million)', fdiSum, stated(fdiT.meta.stated_total_usd_million), 0.05);

// ---------- FDI annual (context only) ----------
const fdiYT = await loadTable('data/raw/fdi/fdi-annual-fy2020-21_fy2025-26.csv');
needSource(fdiYT.meta.source_id);
const fyCols = ['fy2020_21', 'fy2021_22', 'fy2022_23', 'fy2023_24', 'fy2024_25', 'fy2025_26'];
const statedFy = fdiYT.meta.stated_totals.trim().split(/\s+/)[0].split(',').map(Number);
fyCols.forEach((col, i) => {
  // every printed cell is a whole number, so each row can be off by up to 0.5
  const sum = fdiYT.rows.reduce((a, r) => a + (r[col] === '-' ? 0 : parseNumber(r[col], fdiYT.file)), 0);
  reconcile(`FDI equity inflow ${col} (USD million)`, sum, statedFy[i], fdiYT.rows.length * 0.5);
});
const fdiFy26 = new Map();
for (const [iso, [row]] of fdiYT.byIso) {
  const text = row.fy2025_26;
  if (text === '-') fdiFy26.set(iso, { value: null, text, status: 'not_reported', note: 'The source prints "-" for this year.' });
  else {
    const value = parseNumber(text, fdiYT.file);
    fdiFy26.set(iso, { value, text, status: value === 0 ? 'rounded_zero' : 'reported' });
  }
}

// ---------- population ----------
const popT = await loadTable('data/raw/population/population-projection-2026-03-01.csv');
needSource(popT.meta.source_id);
const population = new Map();
for (const [iso, list] of popT.byIso) {
  const thousands = list.reduce((a, r) => a + parseNumber(r.persons_2026_thousands_text, popT.file), 0);
  population.set(iso, {
    value: thousands * 1000,
    text: list.map((r) => r.persons_2026_thousands_text).join(' + '),
    name: list.map((r) => r.state_name).join(' + '),
    derived: list.length > 1,
  });
}
const popSum = [...population.values()].reduce((a, d) => a + d.value, 0) / 1000;
reconcile("Projected population 1 Mar 2026 ('000)", popSum, stated(popT.meta.stated_total), 25);

// ---------- SISFS (context only) ----------
const sisfsT = await loadTable('data/raw/startups/sisfs-2026-06-30.csv');
needSource(sisfsT.meta.source_id);
const sisfs = new Map();
for (const [iso, [row]] of sisfsT.byIso) {
  sisfs.set(iso, {
    startups: parseNumber(row.startups_supported, sisfsT.file),
    funds: parseNumber(row.funds_approved_rs_crore, sisfsT.file),
    text: `${row.startups_supported} | ${row.funds_approved_rs_crore}`,
  });
}
reconcile('SISFS startups supported', [...sisfs.values()].reduce((a, d) => a + d.startups, 0), stated(sisfsT.meta.stated_total_startups), 0);
reconcile('SISFS funds approved (Rs crore)', [...sisfs.values()].reduce((a, d) => a + d.funds, 0), stated(sisfsT.meta.stated_total_funds), 0.02);

// ---------- funding (partial) ----------
const fundT = await loadTable('data/raw/funding/funding-tracxn-2025.csv');
const funding = new Map();
for (const [iso, [row]] of fundT.byIso) {
  needSource(row.source_id);
  funding.set(iso, {
    value: parseNumber(row.usd_million, fundT.file), text: row.original_cell_text, name: row.state_name,
    source_id: row.source_id, read_from: row.read_from, note: row.note,
  });
}
console.log(`  n/a   Startup funding: ${funding.size} states with a citable figure; no national total to reconcile against`);

// ---------- assemble ----------
const states = nameMap.canonical.map((c) => {
  const pop = population.get(c.iso);
  if (!pop) fail(`no population row for ${c.name}; per-capita would be undefined`);
  const perMillion = (v) => round(v / (pop.value / 1e6), 4);
  const perResident = (vUsdM) => round((vUsdM * 1e6) / pop.value, 4);

  const s = startups.get(c.iso);
  const f = fdi.get(c.iso);
  const u = funding.get(c.iso);

  const metrics = {
    startups: s
      ? {
          value: s.value, unit: 'entities recognised as startups', year: '30 Jun 2026',
          period_start: '2016-01-16', period_end: '2026-06-30', period_type: 'cumulative stock at snapshot date',
          status: 'reported', original_cell_text: s.text, original_state_name: s.name,
          source_id: startupsT.meta.source_id, locator: 'Annexure-I', provisional: false,
          per_capita: { value: perMillion(s.value), unit: 'per million residents' },
        }
      : { value: null, year: null, source_id: null, status: 'not_reported', note: 'No row for this State/UT in the source table.' },
    fdi_usd_m: f
      ? {
          value: f.value, unit: 'USD million', year: 'Oct 2019 - Mar 2026',
          period_start: '2019-10-01', period_end: '2026-03-31', period_type: 'cumulative inflow over the window',
          status: 'reported', original_cell_text: f.text, original_state_name: f.name,
          source_id: fdiT.meta.source_id, locator: `Annexure-C, Sr. No. ${f.sr}`, provisional: true,
          inr_crore: f.inr,
          per_capita: { value: perResident(f.value), unit: 'USD per resident' },
        }
      : {
          value: null, year: null, source_id: null, status: 'not_reported',
          note: 'The DPIIT state-wise table has no row for this State/UT. That is a gap in the source, not a zero.',
        },
    funding_usd_m: u
      ? {
          value: u.value, unit: 'USD million', year: '2025',
          period_start: '2025-01-01', period_end: null, period_type: "publisher's 2025 window; cutoff date not printed",
          status: 'reported', original_cell_text: u.text, original_state_name: u.name,
          source_id: u.source_id, locator: 'Headline total', provisional: false,
          read_from: u.read_from, note: u.note,
          per_capita: { value: perResident(u.value), unit: 'USD per resident' },
        }
      : {
          value: null, year: null, source_id: null, status: 'not_available',
          note: 'No citable public state-level figure was found for this State/UT.',
        },
  };

  const fy = fdiFy26.get(c.iso);
  const ss = sisfs.get(c.iso);
  const context = {
    fdi_fy2025_26_usd_m: fy
      ? { value: fy.value, year: fy.value == null ? null : 'FY2025-26', source_id: fy.value == null ? null : fdiYT.meta.source_id,
          status: fy.status, original_cell_text: fy.text, ...(fy.note ? { note: fy.note } : {}) }
      : { value: null, year: null, source_id: null, status: 'not_reported',
          note: c.type === 'UT'
            ? 'The annual table reports all Union Territories together as "UTs and Others"; no separate figure is printed.'
            : 'No row for this state in the annual table.' },
    sisfs: ss
      ? { startups_supported: ss.startups, funds_approved_rs_crore: ss.funds, year: '30 Jun 2026',
          source_id: sisfsT.meta.source_id, status: 'reported', original_cell_text: ss.text }
      : { startups_supported: null, funds_approved_rs_crore: null, year: null, source_id: null, status: 'not_reported',
          note: 'Not listed in the source annexure. Not listed is not the same as zero.' },
  };

  return {
    state: c.name, iso: c.iso, lgd: c.lgd, type: c.type,
    metrics,
    population: {
      value: pop.value, year: '1 Mar 2026 (projected)', status: 'projected', source_id: popT.meta.source_id,
      original_cell_text: pop.text, original_state_name: pop.name, unit: 'persons',
      ...(pop.derived ? { note: 'Sum of two rows the source prints separately for the two former UTs.' } : {}),
    },
    context,
    scores: {},
    composite: {},
  };
});

if (states.length !== 36) fail(`expected 36 States/UTs, got ${states.length}`);
for (const [label, m] of [['startups', startups], ['fdi', fdi], ['funding', funding], ['population', population]]) {
  for (const iso of m.keys()) if (!states.some((s) => s.iso === iso)) fail(`${label}: ${iso} is not a canonical State/UT`);
}

// ---------- per-metric scores and ranks ----------
const metricMeta = {};
for (const metric of METRICS) {
  const medians = {};
  const ranges = {};
  for (const view of VIEWS) {
    const items = states.map((s) => ({ iso: s.iso, value: viewValue(s, metric, view) })).filter((d) => d.value != null);
    const ranks = rankDesc(items);
    const lin = minMax(items, false);
    const log = minMax(items, true);
    for (const s of states) {
      s.scores[metric] ??= {};
      s.scores[metric][view] = ranks.has(s.iso)
        ? { rank: metric === 'funding_usd_m' ? null : ranks.get(s.iso), of: metric === 'funding_usd_m' ? null : items.length,
            linear: round(lin.get(s.iso), 2), log: round(log.get(s.iso), 2) }
        : null;
    }
    medians[view] = round(median(items.map((d) => d.value)), 4);
    // how many times the median this state is - used for the per-state takeaways
    const valueOf = new Map(items.map((d) => [d.iso, d.value]));
    for (const s of states) {
      const sc = s.scores[metric][view];
      if (sc) sc.x_median = round(valueOf.get(s.iso) / medians[view], 2);
    }
    ranges[view] = { min: Math.min(...items.map((d) => d.value)), max: Math.max(...items.map((d) => d.value)) };
  }
  metricMeta[metric] = { coverage: states.filter((s) => s.metrics[metric].value != null).length, medians, ranges };
  // share of the total the SOURCE prints (so FDI shares are of the gross total, "State Not Indicated" included)
  const total = metric === 'startups' ? stated(startupsT.meta.stated_total)
    : metric === 'fdi_usd_m' ? stated(fdiT.meta.stated_total_usd_million) : null;
  if (total) {
    for (const s of states) {
      const sc = s.scores[metric].absolute;
      if (sc) sc.share_pct = round((s.metrics[metric].value / total) * 100, 2);
    }
    const top = states.filter((s) => s.metrics[metric].value != null)
      .sort((a, b) => b.metrics[metric].value - a.metrics[metric].value).slice(0, 5);
    metricMeta[metric].top5 = {
      isos: top.map((s) => s.iso),
      share_pct: round((top.reduce((a, s) => a + s.metrics[metric].value, 0) / total) * 100, 1),
    };
  }
}

// ---------- composite: fixed metric set, fixed weights, one cohort ----------
const inCohort = (s) => COMPOSITE_METRICS.every((m) => s.metrics[m].value != null);
const cohort = states.filter(inCohort);
const compositeMedians = {};
for (const view of VIEWS) {
  compositeMedians[view] = {};
  for (const scale of SCALES) {
    const comp = new Map(cohort.map((s) => [s.iso, 0]));
    for (const metric of COMPOSITE_METRICS) {
      const norm = minMax(cohort.map((s) => ({ iso: s.iso, value: viewValue(s, metric, view) })), scale === 'log');
      for (const s of cohort) comp.set(s.iso, comp.get(s.iso) + WEIGHTS[metric] * norm.get(s.iso));
    }
    const ranks = rankDesc(cohort.map((s) => ({ iso: s.iso, value: round(comp.get(s.iso), 6) })));
    for (const s of cohort) {
      s.composite[view] ??= {};
      s.composite[view][scale] = { score: round(comp.get(s.iso), 1), rank: ranks.get(s.iso), of: cohort.length };
    }
    compositeMedians[view][scale] = round(median(cohort.map((s) => round(comp.get(s.iso), 1))), 1);
  }
}
for (const s of states) {
  const present = COMPOSITE_METRICS.filter((m) => s.metrics[m].value != null);
  s.composite.coverage = `${present.length}/${COMPOSITE_METRICS.length} metrics`;
  s.composite.in_cohort = inCohort(s);
  s.composite.missing = COMPOSITE_METRICS.filter((m) => s.metrics[m].value == null);
  if (!s.composite.in_cohort) { s.composite.absolute = null; s.composite.per_capita = null; }
}

// ---------- meta ----------
const accessed = Object.values(sources).map((s) => s.accessed_at).sort();
const out = {
  meta: {
    generated_at: new Date().toISOString().slice(0, 10),
    data_checked_at: accessed[accessed.length - 1],
    methodology_version: METHODOLOGY_VERSION,
    default_view: 'per_capita',
    scale_presets: { absolute: 'linear', per_capita: 'log' },
    composite: {
      name: 'Innovation Density Index',
      qualifier: '2-metric, experimental',
      components: COMPOSITE_METRICS,
      weights: WEIGHTS,
      cohort_size: cohort.length,
      excluded: states.filter((s) => !inCohort(s)).map((s) => ({ iso: s.iso, state: s.state, missing: s.composite.missing })),
      medians: compositeMedians,
    },
    metrics: {
      startups: {
        label: 'Startups', long_label: 'DPIIT-recognised startups', period_label: 'as on 30 Jun 2026',
        unit: { absolute: 'entities', per_capita: 'per million residents' },
        partial: false, ranked: true, source_ids: [startupsT.meta.source_id],
        stated_total: stated(startupsT.meta.stated_total), ...metricMeta.startups,
      },
      fdi_usd_m: {
        label: 'FDI', long_label: 'FDI equity inflow', period_label: 'Oct 2019 - Mar 2026',
        unit: { absolute: 'USD million', per_capita: 'USD per resident' },
        partial: false, ranked: true, source_ids: [fdiT.meta.source_id],
        stated_total: stated(fdiT.meta.stated_total_usd_million),
        state_not_indicated: {
          value: notIndicatedUsd, original_cell_text: notIndicated.usd_million_text, unit: 'USD million',
          source_id: fdiT.meta.source_id, year: 'Oct 2019 - Mar 2026',
        },
        ...metricMeta.fdi_usd_m,
      },
      funding_usd_m: {
        label: 'Funding', long_label: 'Tech startup funding', period_label: '2025',
        unit: { absolute: 'USD million', per_capita: 'USD per resident' },
        partial: true, ranked: false, source_ids: [...new Set([...funding.values()].map((d) => d.source_id))],
        stated_total: null, ...metricMeta.funding_usd_m,
      },
    },
    population: {
      label: 'Projected population, 1 Mar 2026', source_id: popT.meta.source_id,
      stated_total: stated(popT.meta.stated_total) * 1000,
    },
    context: {
      fdi_fy2025_26_usd_m: { label: 'FDI equity inflow, FY2025-26', unit: 'USD million', source_id: fdiYT.meta.source_id },
      sisfs: { label: 'Startup India Seed Fund Scheme, as on 30 Jun 2026', source_id: sisfsT.meta.source_id },
    },
  },
  states,
};

const json = JSON.stringify(out, null, 1) + '\n';
await mkdir(path('public/data'), { recursive: true });
await writeFile(path('data/states.json'), json);
await writeFile(path('public/data/states.json'), JSON.stringify(out) + '\n');
await writeFile(path('public/data/sources.json'), JSON.stringify(sources) + '\n');

// coverage matrix
const cov = ['iso,state,type,startups,fdi_usd_m,funding_usd_m,population,composite_cohort'];
for (const s of states) {
  cov.push([s.iso, `"${s.state}"`, s.type, ...METRICS.map((m) => s.metrics[m].status), s.population.status, s.composite.in_cohort ? 'yes' : 'no'].join(','));
}
await writeFile(path('data/coverage.csv'), cov.join('\n') + '\n');

// ---------- review table ----------
const fmt = (v, dp = 0) => (v == null ? 'null' : v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
console.log('\nState/UT x metric (absolute values; null = no source figure)\n');
console.log(['', 'State/UT'.padEnd(42), 'Startups'.padStart(9), 'FDI USD m'.padStart(13), 'Funding USD m'.padStart(14), 'Pop (proj.)'.padStart(15), 'Composite pc'.padStart(13)].join(' '));
for (const s of states) {
  console.log([
    s.iso, s.state.padEnd(42),
    fmt(s.metrics.startups.value).padStart(9),
    fmt(s.metrics.fdi_usd_m.value, 2).padStart(13),
    fmt(s.metrics.funding_usd_m.value).padStart(14),
    fmt(s.population.value).padStart(15),
    (s.composite.per_capita ? `${s.composite.per_capita.log.score.toFixed(1)} (#${s.composite.per_capita.log.rank})` : 'n/a').padStart(13),
  ].join(' '));
}
console.log(`\nFootnote row, never assigned to a state: FDI "State Not Indicated" = USD ${notIndicatedUsd} million`);
console.log(`Coverage: startups ${metricMeta.startups.coverage}/36, FDI ${metricMeta.fdi_usd_m.coverage}/36, funding ${metricMeta.funding_usd_m.coverage}/36, composite cohort ${cohort.length}/36`);
console.log('wrote data/states.json, public/data/states.json, public/data/sources.json, data/coverage.csv');
