// Infographic layer: national stat tiles, a leaderboard, and a startups-vs-FDI scatter.
// Every figure is read from states.json; positions come from the stored 0-100 scores.
import { esc, formatValue, layerLabel, layerRank, layerScore, layerValue, num, unitLabel, viewLabel } from './model';
import type { AppState, Dataset, MetricKey, StateRecord } from './types';

type Handlers = { select(iso: string, from?: HTMLElement): void; hover(iso: string | null): void };

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count a number up once, when it scrolls into view. The final text is always the exact formatted value. */
function countUp(node: HTMLElement, end: number, fmt: (v: number) => string) {
  node.textContent = fmt(end);
  if (reduced() || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      node.textContent = fmt(end * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick); else node.textContent = fmt(end);
    };
    requestAnimationFrame(tick);
  });
  io.observe(node);
}

const ring = (part: number, whole: number) => {
  const r = 26, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" class="ring-track"/>
    <circle cx="32" cy="32" r="${r}" class="ring-fill" stroke-dasharray="${((part / whole) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 32 32)"/>
  </svg>`;
};

// ---------------------------------------------------------------- stat tiles
export function createStats(root: HTMLElement, data: Dataset, on: Handlers): void {
  const { meta, states } = data;
  const byIso = new Map(states.map((s) => [s.iso, s]));
  const n = states.length;

  const concentration = (m: MetricKey) => {
    const mm = meta.metrics[m];
    if (!mm.top5) return '';
    const segs = mm.top5.isos.map((iso, i) => {
      const s = byIso.get(iso)!;
      const share = s.scores[m].absolute!.share_pct!;
      return `<button type="button" class="seg seg-${i}" style="flex-grow:${share}" data-iso="${iso}"
        aria-label="${esc(s.state)}: ${share}% of the national total"><span>${share >= 9 ? esc(iso) : ''}</span></button>`;
    }).join('');
    const rest = +(100 - mm.top5.share_pct).toFixed(1);
    return `<div class="conc" role="group" aria-label="Share of the national total held by the top five">
        ${segs}<span class="seg seg-rest" style="flex-grow:${rest}" title="Everyone else: ${rest}%"></span></div>
      <p class="tile-foot"><strong>Top 5 hold ${mm.top5.share_pct}%</strong> · ${mm.top5.isos.map((i) => esc(byIso.get(i)!.state)).join(', ')}</p>`;
  };

  const s = meta.metrics.startups, f = meta.metrics.fdi_usd_m, u = meta.metrics.funding_usd_m;
  root.innerHTML = `
    <article class="tile tile-a">
      <p class="tile-kicker">${esc(s.long_label)}</p>
      <p class="tile-num num" id="stat-startups"></p>
      <p class="tile-sub">recognised nationally, ${esc(s.period_label)}</p>
      ${concentration('startups')}
    </article>
    <article class="tile tile-b">
      <p class="tile-kicker">${esc(f.long_label)}</p>
      <p class="tile-num num" id="stat-fdi"></p>
      <p class="tile-sub">US$ billion, ${esc(f.period_label)}, all sectors</p>
      ${concentration('fdi_usd_m')}
    </article>
    <article class="tile tile-c tile-ring">
      ${ring(meta.composite.cohort_size, n)}
      <div><p class="tile-kicker">${esc(meta.composite.name)}</p>
      <p class="tile-num num">${meta.composite.cohort_size}<span class="tile-of"> / ${n}</span></p>
      <p class="tile-sub">States/UTs scored. The rest lack a component and are left out, not guessed.</p></div>
    </article>
    <article class="tile tile-d tile-ring">
      ${ring(u.coverage, n)}
      <div><p class="tile-kicker">${esc(u.long_label)} <span class="badge">partial</span></p>
      <p class="tile-num num">${u.coverage}<span class="tile-of"> / ${n}</span></p>
      <p class="tile-sub">states with a citable public figure. Shown, never ranked.</p></div>
    </article>`;

  countUp(root.querySelector('#stat-startups')!, s.stated_total!, (v) => Math.round(v).toLocaleString('en-US'));
  countUp(root.querySelector('#stat-fdi')!, f.stated_total! / 1000, (v) => `$${v.toFixed(1)}B`);

  root.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-iso]');
    if (b) on.select(b.dataset.iso!, b);
  });
}

// ---------------------------------------------------------------- leaderboard
export function createLeaders(root: HTMLElement, data: Dataset, on: Handlers): { update(st: AppState): void } {
  const { meta, states } = data;
  let showAll = false;
  let last: AppState | null = null;

  const render = (st: AppState) => {
    last = st;
    const rows = states
      .map((s) => ({ s, v: layerValue(s, st.layer, st.view, st.scale), r: layerRank(s, st.layer, st.view, st.scale) }))
      .filter((d): d is { s: StateRecord; v: number; r: { rank: number; of: number } | null } => d.v != null)
      .sort((a, b) => b.v - a.v);
    const max = rows[0]?.v ?? 1;
    let shown = showAll ? rows : rows.slice(0, 10);
    const sel = rows.find((d) => d.s.iso === st.selected);
    if (sel && !shown.includes(sel)) shown = [...shown, sel];
    const unavailable = states.length - rows.length;

    root.innerHTML = `
      <div class="panel-head">
        <div><h3>${showAll ? 'All' : 'Top ten'} · ${esc(layerLabel(meta, st.layer, true))}</h3>
        <p class="panel-sub">${esc(viewLabel(st.view))} · ${esc(unitLabel(meta, st.layer, st.view))}. Bar length is the value itself, from zero.</p></div>
        ${rows.length > 10 ? `<button type="button" class="btn btn-quiet" data-toggle aria-pressed="${showAll}">${showAll ? 'Show top ten' : `Show all ${rows.length}`}</button>` : ''}
      </div>
      <ol class="leaders">
        ${shown.map((d, i) => `
          <li class="${d.s.iso === st.selected ? 'is-selected' : ''}${sel === d && i >= 10 && !showAll ? ' is-appended' : ''}">
            <button type="button" data-iso="${d.s.iso}">
              <span class="lead-rank num">${d.r ? d.r.rank : '·'}</span>
              <span class="lead-name">${esc(d.s.state)}</span>
              <span class="lead-track"><span class="lead-bar" style="width:${Math.max((d.v / max) * 100, 0.6).toFixed(2)}%"></span></span>
              <span class="lead-val num">${formatValue(st.layer, st.view, d.v)}</span>
            </button>
          </li>`).join('')}
      </ol>
      <p class="note">${st.layer !== 'composite' && !meta.metrics[st.layer].ranked
        ? `Partial coverage: these are the only ${rows.length} states with a citable figure. Not a national ranking.`
        : unavailable ? `${unavailable} State/UT${unavailable > 1 ? 's are' : ' is'} not shown: no figure in the source.` : 'All 36 States/UTs report this metric.'}</p>`;
  };

  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-toggle]')) { showAll = !showAll; if (last) render(last); root.querySelector<HTMLElement>('[data-toggle]')?.focus(); return; }
    const b = t.closest<HTMLElement>('[data-iso]');
    if (b) on.select(b.dataset.iso!, b);
  });
  return { update: render };
}

// ---------------------------------------------------------------- scatter
export function createScatter(root: HTMLElement, data: Dataset, on: Handlers): { update(st: AppState): void } {
  const { meta, states } = data;
  const W = 640, H = 420, M = { l: 58, r: 22, t: 18, b: 48 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const px = (score: number) => M.l + (score / 100) * iw;
  const py = (score: number) => M.t + ih - (score / 100) * ih;

  root.innerHTML = `
    <div class="panel-head"><div><h3>Startup base against foreign capital</h3><p class="panel-sub" id="scatter-sub"></p></div></div>
    <div class="scatter-frame">
      <svg viewBox="0 0 ${W} ${H}" class="scatter" role="group" aria-label="Scatter plot of startups against FDI equity inflow by state. The rankings table carries the same values."></svg>
      <div class="tooltip" id="scatter-tip" role="status" hidden></div>
    </div>
    <p class="note" id="scatter-note"></p>`;
  const svg = root.querySelector('svg')!;
  const tip = root.querySelector<HTMLElement>('#scatter-tip')!;
  let cur: AppState | null = null;

  const medianPos = (m: MetricKey, st: AppState) => {
    const { min, max } = meta.metrics[m].ranges[st.view];
    const med = meta.metrics[m].medians[st.view];
    return st.scale === 'log'
      ? ((Math.log10(med) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))) * 100
      : ((med - min) / (max - min)) * 100;
  };

  const render = (st: AppState) => {
    cur = st;
    const pts = states
      .map((s) => ({ s, x: layerScore(s, 'startups', st.view, st.scale), y: layerScore(s, 'fdi_usd_m', st.view, st.scale) }))
      .filter((d): d is { s: StateRecord; x: number; y: number } => d.x != null && d.y != null);
    const missing = states.filter((s) => !pts.some((p) => p.s === s)).map((s) => s.state);
    const rx = meta.metrics.startups.ranges[st.view], ry = meta.metrics.fdi_usd_m.ranges[st.view];
    const mx = px(medianPos('startups', st)), my = py(medianPos('fdi_usd_m', st));

    // label the standouts and the selected state; everything else is reachable by hover and by the table
    const labelled = new Set(
      [...pts].sort((a, b) => (b.x + b.y) - (a.x + a.y)).slice(0, 6).map((d) => d.s.iso)
        .concat([...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y)).slice(0, 2).map((d) => d.s.iso)),
    );
    if (st.selected) labelled.add(st.selected);

    // place labels greedily: right, left, above, below; a label that cannot avoid dots and other labels is dropped
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = pts.map((d) => ({ x0: px(d.x) - 7, y0: py(d.y) - 7, x1: px(d.x) + 7, y1: py(d.y) + 7 }));
    const hits = (b: { x0: number; y0: number; x1: number; y1: number }) =>
      b.x0 < M.l || b.x1 > W - 2 || b.y0 < 2 || boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    const labels: string[] = [];
    const order = pts.filter((d) => labelled.has(d.s.iso)).sort((a, b) => Number(b.s.iso === st.selected) - Number(a.s.iso === st.selected) || (b.x + b.y) - (a.x + a.y));
    for (const d of order) {
      const cx = px(d.x), cy = py(d.y), w = d.s.state.length * 6.7 + 4, h = 14;
      const options = [
        { x: cx + 11, y: cy + 4, anchor: 'start', b: { x0: cx + 9, y0: cy - h / 2, x1: cx + 11 + w, y1: cy + h / 2 } },
        { x: cx - 11, y: cy + 4, anchor: 'end', b: { x0: cx - 11 - w, y0: cy - h / 2, x1: cx - 9, y1: cy + h / 2 } },
        { x: cx, y: cy - 12, anchor: 'middle', b: { x0: cx - w / 2, y0: cy - 12 - h, x1: cx + w / 2, y1: cy - 9 } },
        { x: cx, y: cy + 21, anchor: 'middle', b: { x0: cx - w / 2, y0: cy + 9, x1: cx + w / 2, y1: cy + 12 + h } },
      ];
      const fit = options.find((o) => !hits(o.b));
      if (!fit) continue;
      boxes.push(fit.b);
      labels.push(`<text x="${fit.x.toFixed(1)}" y="${fit.y.toFixed(1)}" text-anchor="${fit.anchor}" class="pt-label${d.s.iso === st.selected ? ' is-selected' : ''}">${esc(d.s.state)}</text>`);
    }

    const grid = [0, 25, 50, 75, 100].map((g) =>
      `<line x1="${px(g)}" x2="${px(g)}" y1="${M.t}" y2="${M.t + ih}" class="grid"/><line x1="${M.l}" x2="${M.l + iw}" y1="${py(g)}" y2="${py(g)}" class="grid"/>`).join('');

    svg.innerHTML = `
      ${grid}
      <line x1="${mx}" x2="${mx}" y1="${M.t}" y2="${M.t + ih}" class="median-line"/>
      <line x1="${M.l}" x2="${M.l + iw}" y1="${my}" y2="${my}" class="median-line"/>
      <text x="${mx + 5}" y="${M.t + 11}" class="axis-note">median</text>
      <text x="${M.l + iw - 4}" y="${my - 5}" class="axis-note" text-anchor="end">median</text>
      <text x="${M.l + iw - 6}" y="${M.t + ih - 8}" class="quad" text-anchor="end">more startups than capital</text>
      <text x="${M.l + 6}" y="${M.t + 26}" class="quad">more capital than startups</text>
      <text x="${M.l}" y="${H - 26}" class="axis-end">${formatValue('startups', st.view, rx.min)}</text>
      <text x="${M.l + iw}" y="${H - 26}" class="axis-end" text-anchor="end">${formatValue('startups', st.view, rx.max)}</text>
      <text x="${M.l + iw / 2}" y="${H - 8}" class="axis-title" text-anchor="middle">Startups, ${esc(meta.metrics.startups.unit[st.view])} →</text>
      <text x="${M.l - 8}" y="${M.t + ih}" class="axis-end" text-anchor="end">${formatValue('fdi_usd_m', st.view, ry.min)}</text>
      <text x="${M.l - 8}" y="${M.t + 10}" class="axis-end" text-anchor="end">${formatValue('fdi_usd_m', st.view, ry.max)}</text>
      <text transform="translate(14 ${M.t + ih / 2}) rotate(-90)" class="axis-title" text-anchor="middle">FDI, ${esc(meta.metrics.fdi_usd_m.unit[st.view])} →</text>
      ${pts.map((d) => `<circle cx="${px(d.x).toFixed(1)}" cy="${py(d.y).toFixed(1)}" r="${d.s.iso === st.selected ? 9 : 6.5}"
          class="pt${d.s.iso === st.selected ? ' is-selected' : ''}" data-iso="${d.s.iso}" aria-label="${esc(d.s.state)}"/>`).join('')}
      ${labels.join('')}`;

    root.querySelector('#scatter-sub')!.textContent =
      `${viewLabel(st.view)} values on ${st.scale === 'log' ? 'log' : 'linear'} axes. Each dot is a state or UT; dashed lines mark the medians.`;
    root.querySelector('#scatter-note')!.textContent =
      `Startups ${meta.metrics.startups.period_label}; FDI ${meta.metrics.fdi_usd_m.period_label}: different windows, shown together. ` +
      (missing.length ? `Not plotted (no FDI figure): ${missing.join(', ')}.` : '');
  };

  const isoOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<SVGElement>('[data-iso]')?.dataset.iso ?? null : null);
  svg.addEventListener('pointermove', (e) => {
    const iso = isoOf(e.target);
    on.hover(iso);
    if (!iso || !cur) { tip.hidden = true; return; }
    const s = states.find((x) => x.iso === iso)!;
    tip.innerHTML = `<strong>${esc(s.state)}</strong>
      <span>Startups: ${formatValue('startups', cur.view, layerValue(s, 'startups', cur.view, cur.scale)!)} ${esc(meta.metrics.startups.unit[cur.view])}</span>
      <span>FDI: ${formatValue('fdi_usd_m', cur.view, layerValue(s, 'fdi_usd_m', cur.view, cur.scale)!)}${cur.view === 'per_capita' ? ' per resident' : ''}</span>`;
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(e.clientX - box.left + 14, 4), box.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${Math.max(e.clientY - box.top - tip.offsetHeight - 12, 4)}px`;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; on.hover(null); });
  svg.addEventListener('click', (e) => { const iso = isoOf(e.target); if (iso) on.select(iso); });

  return { update: render };
}

/** Plain-language takeaways for one state, built only from stored ranks, shares and median multiples. */
export function takeaways(s: StateRecord, st: AppState, data: Dataset): { big: string; text: string; tone: number }[] {
  const { meta } = data;
  const out: { big: string; text: string; tone: number }[] = [];
  const place = s.type === 'UT' ? 'UT' : 'state';

  const c = s.composite[st.view]?.[st.scale];
  if (c) out.push({ big: `#${c.rank}`, text: `of ${c.of} on the index, ${viewLabel(st.view).toLowerCase()} view`, tone: 0 });
  else out.push({ big: 'Not scored', text: `${s.composite.missing.map((m) => meta.metrics[m].label).join(' and ')} not reported for this ${place}: a gap, not a zero`, tone: 3 });

  // the metric where this state stands furthest above the median, per capita
  const multiples = (['startups', 'fdi_usd_m'] as MetricKey[])
    .map((m) => ({ m, sc: s.scores[m].per_capita }))
    .filter((d) => d.sc != null)
    .sort((a, b) => b.sc!.x_median - a.sc!.x_median);
  const best = multiples[0];
  if (best) {
    const x = best.sc!.x_median;
    const label = best.m === 'startups' ? 'startups per million residents' : 'FDI equity per resident';
    out.push(x >= 1
      ? { big: `${num(x)}×`, text: `the median ${label}`, tone: 1 }
      : { big: `${num(x)}×`, text: `the median ${label}: below the middle of the table on both official metrics`, tone: 1 });
  }

  // share of the national total, whichever is larger
  const shares = (['startups', 'fdi_usd_m'] as MetricKey[])
    .map((m) => ({ m, p: s.scores[m].absolute?.share_pct }))
    .filter((d): d is { m: MetricKey; p: number } => d.p != null)
    .sort((a, b) => b.p - a.p);
  if (shares[0] && shares[0].p >= 0.5) {
    out.push({
      big: `${num(shares[0].p)}%`,
      text: shares[0].m === 'startups' ? 'of all DPIIT-recognised startups in India' : `of all FDI equity reported, ${meta.metrics.fdi_usd_m.period_label}`,
      tone: 2,
    });
  }

  // scale versus density: where absolute and per-capita ranks pull apart
  const a = s.scores.startups.absolute, p = s.scores.startups.per_capita;
  if (a?.rank && p?.rank && Math.abs(a.rank - p.rank) >= 6) {
    out.push({
      big: `#${a.rank} → #${p.rank}`,
      text: a.rank < p.rank ? 'startups by count, then per capita: big on scale, thinner on density' : 'startups by count, then per capita: small in total, dense for its size',
      tone: 3,
    });
  }
  return out.slice(0, 4);
}
