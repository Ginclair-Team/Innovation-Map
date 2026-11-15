// Validates public/data/states.json on its own - it does not need data/raw/.
// Exits 1 on the first class of failure, after printing every problem found.
import {
  COMPOSITE_METRICS, METRICS, SCALES, VIEWS, minMax, rankDesc, readJson, round, viewValue,
} from './lib.mjs';

const data = await readJson('public/data/states.json');
const sources = await readJson('public/data/sources.json');
const nameMap = await readJson('scripts/state-name-map.json');
const errors = [];
const err = (m) => errors.push(m);
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) err(msg); };

const STATUSES = new Set(['reported', 'reported_zero', 'rounded_zero', 'not_reported', 'not_available', 'not_loaded', 'not_applicable', 'projected']);
const { states, meta } = data;

// 36 States/UTs, exactly the canonical set
check(states.length === 36, `expected 36 States/UTs, found ${states.length}`);
const canon = new Map(nameMap.canonical.map((c) => [c.iso, c]));
check(new Set(states.map((s) => s.iso)).size === states.length, 'duplicate iso codes');
for (const s of states) {
  const c = canon.get(s.iso);
  check(!!c, `${s.iso}: not in the canonical list`);
  if (c) check(c.name === s.state && c.lgd === s.lgd, `${s.iso}: name/LGD code differs from the canonical list`);
}

// every number is finite; every figure has a source and a year; every gap is explicit
const walk = (node, where) => {
  if (typeof node === 'number') check(Number.isFinite(node), `${where}: non-finite number`);
  else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${where}[${i}]`));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${where}.${k}`);
};
walk(data, 'states.json');

const figure = (o, where, valueKey = 'value') => {
  check(STATUSES.has(o.status), `${where}: unknown status "${o.status}"`);
  if (o[valueKey] != null) {
    check(typeof o[valueKey] === 'number', `${where}: value is not a number`);
    check(!!o.source_id, `${where}: figure without source_id`);
    check(!!o.year, `${where}: figure without year`);
    check(!!sources[o.source_id], `${where}: source_id "${o.source_id}" missing from sources.json`);
    check(o.original_cell_text != null && o.original_cell_text !== '', `${where}: figure without original_cell_text`);
    check(['reported', 'reported_zero', 'rounded_zero', 'projected'].includes(o.status), `${where}: has a value but status is "${o.status}"`);
  } else {
    check(o.source_id == null && o.year == null, `${where}: null value must have null source_id and year`);
    check(['not_reported', 'not_available', 'not_loaded', 'not_applicable'].includes(o.status), `${where}: null value but status is "${o.status}"`);
    check(!!o.note, `${where}: gap without an explanatory note`);
  }
};

for (const s of states) {
  for (const m of METRICS) {
    const o = s.metrics[m];
    check(!!o, `${s.iso}.${m}: missing metric object`);
    if (!o) continue;
    figure(o, `${s.iso}.${m}`);
    if (o.value != null) {
      check(o.value >= 0, `${s.iso}.${m}: negative value`);
      // per-capita must be the raw value over the stated population, nothing else
      const expected = m === 'startups' ? o.value / (s.population.value / 1e6) : (o.value * 1e6) / s.population.value;
      check(!!o.per_capita && Math.abs(o.per_capita.value - round(expected, 4)) < 1e-9, `${s.iso}.${m}: per-capita does not equal value / population`);
      check(Number(String(o.original_cell_text).replace(/[^0-9.]/g, '')) > 0 || o.value === 0, `${s.iso}.${m}: original_cell_text has no number`);
    } else {
      check(o.per_capita == null, `${s.iso}.${m}: per-capita present without a value`);
      check(VIEWS.every((v) => s.scores[m][v] === null), `${s.iso}.${m}: score present without a value`);
    }
  }
  figure(s.population, `${s.iso}.population`);
  check(s.population.value > 0, `${s.iso}.population: must be positive`);
  figure(s.context.fdi_fy2025_26_usd_m, `${s.iso}.context.fdi_fy2025_26`);
  figure(s.context.sisfs, `${s.iso}.context.sisfs`, 'funds_approved_rs_crore');
}

// transcribed numeric text equals stored value for the two official metrics
for (const s of states) {
  for (const m of ['startups', 'fdi_usd_m']) {
    const o = s.metrics[m];
    if (o.value != null) check(Number(o.original_cell_text.replace(/,/g, '')) === o.value, `${s.iso}.${m}: value differs from original_cell_text`);
  }
}

// totals printed by the sources
const sum = (m) => states.reduce((a, s) => a + (s.metrics[m].value ?? 0), 0);
check(sum('startups') === meta.metrics.startups.stated_total, `startups: rows sum to ${sum('startups')}, source total is ${meta.metrics.startups.stated_total}`);
const fdiTotal = sum('fdi_usd_m') + meta.metrics.fdi_usd_m.state_not_indicated.value;
check(Math.abs(fdiTotal - meta.metrics.fdi_usd_m.stated_total) <= 0.05, `FDI: rows + "State Not Indicated" sum to ${fdiTotal}, source total is ${meta.metrics.fdi_usd_m.stated_total}`);
check(!states.some((s) => s.metrics.fdi_usd_m.value === meta.metrics.fdi_usd_m.state_not_indicated.value), 'FDI "State Not Indicated" appears to be assigned to a state');

// scores and ranks re-derived from raw values
for (const m of METRICS) {
  for (const v of VIEWS) {
    const items = states.map((s) => ({ iso: s.iso, value: viewValue(s, m, v) })).filter((d) => d.value != null);
    const ranks = rankDesc(items);
    const lin = minMax(items, false);
    const log = minMax(items, true);
    for (const s of states) {
      const sc = s.scores[m][v];
      if (!ranks.has(s.iso)) continue;
      check(sc && sc.linear === round(lin.get(s.iso), 2) && sc.log === round(log.get(s.iso), 2), `${s.iso}.${m}.${v}: stored score differs from re-derived score`);
      const raw = viewValue(s, m, v);
      check(sc && sc.x_median === round(raw / meta.metrics[m].medians[v], 2), `${s.iso}.${m}.${v}: x_median differs from value / median`);
      if (v === 'absolute' && meta.metrics[m].stated_total) {
        check(sc && sc.share_pct === round((raw / meta.metrics[m].stated_total) * 100, 2), `${s.iso}.${m}: share_pct differs from value / source total`);
      }
      if (meta.metrics[m].ranked) check(sc && sc.rank === ranks.get(s.iso), `${s.iso}.${m}.${v}: stored rank differs from re-derived rank`);
      else check(sc && sc.rank === null, `${s.iso}.${m}.${v}: a partial-coverage metric must not carry a rank`);
    }
  }
}

// composite: fixed cohort, fixed weights, never rescaled per state
const w = meta.composite.weights;
check(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-12, 'composite weights do not sum to 1');
check(JSON.stringify(meta.composite.components) === JSON.stringify(COMPOSITE_METRICS), 'composite components differ from the fixed metric set');
const cohort = states.filter((s) => COMPOSITE_METRICS.every((m) => s.metrics[m].value != null));
check(cohort.length === meta.composite.cohort_size, 'composite cohort size mismatch');
for (const s of states) {
  const inC = cohort.includes(s);
  check(s.composite.in_cohort === inC, `${s.iso}: in_cohort flag is wrong`);
  if (!inC) check(s.composite.absolute === null && s.composite.per_capita === null, `${s.iso}: has a composite score despite a missing component`);
}
for (const v of VIEWS) for (const sc of SCALES) {
  const comp = new Map(cohort.map((s) => [s.iso, 0]));
  for (const m of COMPOSITE_METRICS) {
    const norm = minMax(cohort.map((s) => ({ iso: s.iso, value: viewValue(s, m, v) })), sc === 'log');
    for (const s of cohort) comp.set(s.iso, comp.get(s.iso) + w[m] * norm.get(s.iso));
  }
  const ranks = rankDesc(cohort.map((s) => ({ iso: s.iso, value: round(comp.get(s.iso), 6) })));
  for (const s of cohort) {
    const c = s.composite[v][sc];
    check(c.score === round(comp.get(s.iso), 1) && c.rank === ranks.get(s.iso), `${s.iso}: composite ${v}/${sc} differs from re-derived value`);
    check(c.score >= 0 && c.score <= 100, `${s.iso}: composite ${v}/${sc} out of range`);
  }
}

// sources are complete
for (const [id, s] of Object.entries(sources)) {
  for (const k of ['name', 'publisher', 'url', 'table', 'accessed_at']) check(!!s[k], `sources.json: ${id} is missing "${k}"`);
  check(/^https:\/\//.test(s.url), `sources.json: ${id} url is not https`);
}

if (errors.length) {
  console.error(`validate: ${errors.length} problem(s) in ${checks} checks\n` + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
const n = (m) => states.filter((s) => s.metrics[m].value != null).length;
console.log(`validate: OK - ${checks} checks passed. 36 States/UTs; startups ${n('startups')}/36, FDI ${n('fdi_usd_m')}/36, funding ${n('funding_usd_m')}/36; composite cohort ${cohort.length}/36; methodology ${meta.methodology_version}.`);
