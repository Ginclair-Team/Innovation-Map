// State detail card: side panel on desktop, bottom sheet on mobile.
import { METRIC_KEYS, esc, formatValue, layerLabel, layerRank, layerValue, missingReason, num, valueSuffix, viewLabel } from './model';
import { takeaways } from './insights';
import type { AppState, Dataset, MetricKey, Sources, StateRecord, View } from './types';

export interface DetailApi { update(st: AppState): void; focus(): void }

export function createDetail(
  root: HTMLElement,
  data: Dataset,
  sources: Sources,
  on: { close(): void; select(iso: string): void },
): DetailApi {
  const { meta } = data;
  const byIso = new Map(data.states.map((s) => [s.iso, s]));
  const src = (id: string | null, text = 'Source') =>
    id && sources[id] ? `<a href="${esc(sources[id].url)}" target="_blank" rel="noopener">${esc(text)}<span class="sr-only"> (opens in a new tab): ${esc(sources[id].name)}</span></a>` : '';

  const rankText = (s: StateRecord, m: MetricKey | 'composite', view: View, st: AppState) => {
    const r = layerRank(s, m, view, st.scale);
    return r ? `#${r.rank} <span class="of">of ${r.of}</span>` : '<span class="of">not ranked</span>';
  };

  /** Where this state sits among all reporters: one tick per State/UT along the current scale. */
  const strip = (s: StateRecord, m: MetricKey, st: AppState) => {
    const ticks = data.states
      .map((o) => ({ o, sc: o.scores[m][st.view]?.[st.scale] }))
      .filter((d) => d.sc != null)
      .map((d) => `<span class="tick${d.o.iso === s.iso ? ' is-self' : ''}" style="left:${d.sc!.toFixed(2)}%"></span>`).join('');
    const r = meta.metrics[m].ranges[st.view];
    return `<div class="strip" aria-hidden="true"><div class="strip-track">${ticks}</div>
      <div class="strip-ends num"><span>${formatValue(m, st.view, r.min)}</span><span>${st.scale === 'log' ? 'log scale' : 'linear scale'}, every State/UT</span><span>${formatValue(m, st.view, r.max)}</span></div></div>`;
  };

  const takeawayBlock = (s: StateRecord, st: AppState) => `
    <section class="takeaways" aria-label="Key takeaways">
      ${takeaways(s, st, data).map((t) => `<div class="takeaway tone-${t.tone}"><span class="tk-big num">${esc(t.big)}</span><span class="tk-text">${esc(t.text)}</span></div>`).join('')}
    </section>`;

  const metricBlock = (s: StateRecord, m: MetricKey, st: AppState) => {
    const f = s.metrics[m];
    const mm = meta.metrics[m];
    const head = `<h3>${esc(mm.long_label)}${mm.partial ? '<span class="badge">partial coverage</span>' : ''}</h3>`;
    if (f.value == null) {
      return `<section class="metric is-na">${head}
        <p class="na-line">Data unavailable</p><p class="note">${esc(f.note ?? '')}</p></section>`;
    }
    const row = (view: View) => `
      <tr${view === st.view ? ' class="is-current"' : ''}>
        <th scope="row">${viewLabel(view)}</th>
        <td class="num">${formatValue(m, view, layerValue(s, m, view, st.scale)!)} <span class="unit">${esc(valueSuffix(meta, m, view))}</span></td>
        <td class="num rank">${rankText(s, m, view, st)}</td>
      </tr>`;
    return `<section class="metric">${head}
      <table class="mini"><thead><tr><th scope="col"><span class="sr-only">View</span></th><th scope="col" class="num">Value</th><th scope="col" class="num">Rank</th></tr></thead>
      <tbody>${row('absolute')}${row('per_capita')}</tbody></table>
      ${strip(s, m, st)}
      <p class="meta-line"><span class="year">${esc(f.year)}</span>${f.provisional ? ' · provisional' : ''} · ${src(f.source_id, f.read_from === 'press report quoting the publisher\'s report' ? 'Source (press report)' : 'Source')}</p>
      ${f.note && m === 'funding_usd_m' ? `<p class="note">${esc(f.note)}</p>` : ''}
    </section>`;
  };

  /** State vs national median, one pair of bars per metric, in the current view. */
  const medianChart = (s: StateRecord, st: AppState) => {
    const rows = METRIC_KEYS.filter((m) => meta.metrics[m].ranked).map((m) => {
      const v = layerValue(s, m, st.view, st.scale);
      const med = meta.metrics[m].medians[st.view];
      const max = Math.max(v ?? 0, med);
      const pct = (x: number) => `${Math.max((x / max) * 100, 0.8).toFixed(1)}%`;
      const stateBar = v == null
        ? `<div class="bar-row"><span class="bar-name">${esc(s.state)}</span><span class="bar-track"><span class="bar bar-na"></span></span><span class="bar-val na">Unavailable</span></div>`
        : `<div class="bar-row"><span class="bar-name">${esc(s.state)}</span><span class="bar-track"><span class="bar bar-state" style="width:${pct(v)}"></span></span><span class="bar-val num">${formatValue(m, st.view, v)}</span></div>`;
      return `<div class="bar-group"><p class="bar-title">${esc(meta.metrics[m].label)} <span class="unit">${esc(meta.metrics[m].unit[st.view])}</span></p>
        ${stateBar}
        <div class="bar-row"><span class="bar-name">Median</span><span class="bar-track"><span class="bar bar-median" style="width:${pct(med)}"></span></span><span class="bar-val num">${formatValue(m, st.view, med)}</span></div></div>`;
    });
    return `<section class="median"><h3>Against the national median <span class="unit">${viewLabel(st.view).toLowerCase()}</span></h3>${rows.join('')}
      <p class="note">Median of the States/UTs that report each metric.</p></section>`;
  };

  const compositeBlock = (s: StateRecord, st: AppState) => {
    const name = `${esc(meta.composite.name)} <span class="badge">${esc(meta.composite.qualifier)}</span>`;
    if (!s.composite.in_cohort) {
      return `<section class="composite is-na"><h3>${name}</h3><p class="na-line">Not scored</p>
        <p class="note">${esc(missingReason(s, 'composite', meta))} A state missing a component is left out of the index rather than scored on what remains. Coverage: ${esc(s.composite.coverage)}.</p></section>`;
    }
    const cell = (view: View) => {
      const c = s.composite[view]![st.scale];
      return `<div class="score${view === st.view ? ' is-current' : ''}"><span class="score-label">${viewLabel(view)}</span>
        <span class="score-num num">${c.score.toFixed(1)}</span><span class="score-rank num">#${c.rank} <span class="of">of ${c.of}</span></span></div>`;
    };
    return `<section class="composite"><h3>${name}</h3><div class="scores">${cell('absolute')}${cell('per_capita')}</div>
      <p class="note">Equal-weight mean of Startups and FDI, each scaled 0-100 across the ${meta.composite.cohort_size} States/UTs that report both. ${st.scale === 'log' ? 'Log' : 'Linear'} scale. Coverage: ${esc(s.composite.coverage)}.</p></section>`;
  };

  const contextBlock = (s: StateRecord) => {
    const fy = s.context.fdi_fy2025_26_usd_m;
    const ss = s.context.sisfs;
    const fyVal = fy.value == null
      ? `<span class="na">Data unavailable</span><span class="note-inline">${esc(fy.note ?? '')}</span>`
      : `<span class="num">$${num(fy.value)}M</span>${fy.status === 'rounded_zero' ? '<span class="note-inline">Printed as 0: under half a million dollars, not necessarily none.</span>' : ''} ${src(fy.source_id)}`;
    const ssVal = ss.funds_approved_rs_crore == null
      ? `<span class="na">Data unavailable</span><span class="note-inline">${esc(ss.note ?? '')}</span>`
      : `<span class="num">${num(ss.startups_supported!)} startups · ₹${num(ss.funds_approved_rs_crore)} crore approved</span> ${src(ss.source_id)}`;
    return `<section class="context"><h3>More context <span class="unit">not part of any score</span></h3>
      <dl>
        <dt>${esc(meta.context.fdi_fy2025_26_usd_m.label)}</dt><dd>${fyVal}</dd>
        <dt>${esc(meta.context.sisfs.label)}</dt><dd>${ssVal}</dd>
        <dt>${esc(meta.population.label)}</dt><dd><span class="num">${num(s.population.value!)}</span>${s.population.note ? `<span class="note-inline">${esc(s.population.note)}</span>` : ''} ${src(s.population.source_id)}</dd>
      </dl></section>`;
  };

  const emptyState = (st: AppState) => {
    const ranked = data.states
      .map((s) => ({ s, r: layerRank(s, st.layer, st.view, st.scale), v: layerValue(s, st.layer, st.view, st.scale) }))
      .filter((d) => d.v != null)
      .sort((a, b) => (a.r && b.r ? a.r.rank - b.r.rank : b.v! - a.v!))
      .slice(0, 5);
    return `<div class="card-empty">
      <p class="eyebrow">State detail</p>
      <h2 tabindex="-1">Pick a state or UT</h2>
      <p class="lede-sm">Click the map, a table row, or use the list above the map. Small UTs are easier to reach from the list.</p>
      <h3>Top five · ${esc(layerLabel(meta, st.layer, true))} <span class="unit">${viewLabel(st.view).toLowerCase()}</span></h3>
      <ol class="top5">${ranked.map((d) => `<li><button type="button" data-iso="${d.s.iso}"><span>${esc(d.s.state)}</span><span class="num">${formatValue(st.layer, st.view, d.v!)}</span></button></li>`).join('')}</ol>
      ${st.layer !== 'composite' && !meta.metrics[st.layer].ranked ? '<p class="note">Partial coverage: these are the only states with a citable figure. This is not a national ranking.</p>' : ''}
    </div>`;
  };

  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-close]')) on.close();
    const pick = t.closest<HTMLElement>('[data-iso]');
    if (pick) on.select(pick.dataset.iso!);
    if (t.closest('[data-grab]')) root.classList.toggle('is-expanded');
  });

  // bottom sheet: drag the handle up to expand, down to collapse or close
  let startY: number | null = null;
  root.addEventListener('pointerdown', (e) => { if ((e.target as Element).closest('[data-grab]')) startY = e.clientY; });
  root.addEventListener('pointerup', (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (Math.abs(dy) < 30) return;
    e.preventDefault();
    if (dy < 0) root.classList.add('is-expanded');
    else if (root.classList.contains('is-expanded')) root.classList.remove('is-expanded');
    else on.close();
    // the click that follows a drag must not toggle again
    root.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
  });

  let lastIso: string | null = null;
  return {
    update(st) {
      const s = st.selected ? byIso.get(st.selected) : null;
      root.classList.toggle('is-open', !!s);
      if (!s) { root.classList.remove('is-expanded'); root.innerHTML = emptyState(st); lastIso = null; return; }
      const scroll = lastIso === s.iso ? root.scrollTop : 0;
      lastIso = s.iso;
      root.innerHTML = `
        <button type="button" class="grab" data-grab aria-label="Expand or collapse the detail sheet"><span></span></button>
        <header class="card-head">
          <div><p class="eyebrow">${s.type === 'UT' ? 'Union Territory' : 'State'}</p><h2 tabindex="-1">${esc(s.state)}</h2></div>
          <button type="button" class="icon-btn" data-close aria-label="Close ${esc(s.state)} detail">✕</button>
        </header>
        ${takeawayBlock(s, st)}
        ${compositeBlock(s, st)}
        ${METRIC_KEYS.map((m) => metricBlock(s, m, st)).join('')}
        ${medianChart(s, st)}
        ${contextBlock(s)}`;
      root.scrollTop = scroll;
    },
    focus() { root.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true }); },
  };
}
