// Methodology + sources drawer. Every count, date and amount in this text is read from
// states.json / sources.json, so the prose cannot drift from the data.
import { esc, formatValue } from './model';
import type { Dataset, MetricKey, Sources } from './types';

const date = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(m ?? 1) - 1];
  return d ? `${d} ${month} ${y}` : m ? `${month} ${y}` : `${y}`;
};

export function renderMethodology(root: HTMLElement, data: Dataset, sources: Sources): void {
  const { meta, states } = data;
  const m = meta.metrics;
  const n = states.length;
  const names = (key: MetricKey, has: boolean) => states.filter((s) => (s.metrics[key].value != null) === has).map((s) => s.state);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');
  const w = Object.values(meta.composite.weights).map((x) => `${Math.round(x * 100)}%`).join(' / ');
  const ni = m.fdi_usd_m.state_not_indicated!;
  const usedBy = (id: string) => {
    const uses: string[] = [];
    (Object.keys(m) as MetricKey[]).forEach((k) => { if (m[k].source_ids.includes(id)) uses.push(m[k].long_label); });
    if (meta.population.source_id === id) uses.push('Population (per-capita denominator)');
    if (meta.context.fdi_fy2025_26_usd_m.source_id === id) uses.push(meta.context.fdi_fy2025_26_usd_m.label);
    if (meta.context.sisfs.source_id === id && !uses.length) uses.push(meta.context.sisfs.label);
    else if (meta.context.sisfs.source_id === id) uses.push('Seed Fund Scheme context');
    return uses.length ? uses.join(' · ') : 'Map boundaries';
  };

  root.innerHTML = `
    <section>
      <h3>What this is</h3>
      <p>A map of where three things show up across India's ${n} states and union territories: startups recognised by DPIIT, foreign direct investment in equity, and private funding raised by tech startups. Two of those come from official tables with near-complete coverage. The third does not, and the map says so instead of filling the gaps.</p>
      <p>It is an independent, experimental reading of public data. It measures recorded activity, not talent, not potential, and not the quality of anyone's policy. A low number here means little was recorded, which is not the same as little happening.</p>
    </section>

    <section>
      <h3>The three metrics</h3>
      <h4>${esc(m.startups.long_label)} <span class="period">${esc(m.startups.period_label)}</span></h4>
      <p>Entities recognised as startups by DPIIT under Startup India, counted cumulatively up to the snapshot date. Coverage: ${m.startups.coverage} of ${n}. The source total is ${formatValue('startups', 'absolute', m.startups.stated_total!)} and the rows on this site add up to exactly that.</p>
      <p class="caveat">DPIIT recognition is self-selected registration, not a census of all startups. It misses ventures that never applied, and it counts recognitions ever granted, not firms still operating.</p>

      <h4>${esc(m.fdi_usd_m.long_label)} <span class="period">${esc(m.fdi_usd_m.period_label)}</span></h4>
      <p>Cumulative FDI equity inflow by state, from DPIIT's quarterly fact sheet. Coverage: ${m.fdi_usd_m.coverage} of ${n}. ${esc(list(names('fdi_usd_m', false)))} have no row in the source table; they are shown as unavailable, not as zero.</p>
      <p class="caveat">DPIIT only began reporting by state in October 2019, so this is a recent window, not all-time. It is equity only: reinvested earnings and other capital are not attributed to states. It covers every sector, so it is investment context, not startup capital. Figures are provisional and get revised. ${formatValue('fdi_usd_m', 'absolute', ni.value)} is reported as "State Not Indicated"; it appears as a footnote and is never assigned to a state. FDI is also booked where a company is registered, which flatters states that host head offices.</p>

      <h4>${esc(m.funding_usd_m.long_label)} <span class="period">${esc(m.funding_usd_m.period_label)}</span> <span class="badge">partial coverage</span></h4>
      <p>There is no free, official, all-state table of startup funding. The full datasets are paid products. What is public is a handful of state reports from one publisher, Tracxn. Coverage: ${m.funding_usd_m.coverage} of ${n} (${esc(list(names('funding_usd_m', true)))}).</p>
      <p class="caveat">These are the publisher's rounded headline figures for tech companies only, under its own definitions, for its "2025" window. The state pages do not print a cutoff date, so do not read this as a guaranteed full calendar year. One figure (Karnataka) was read from a press report of the publisher's report, and outlets disagree on it; the state card shows that. City totals are not promoted to state totals, and Delhi-NCR figures are not used at all because NCR spans Delhi and parts of Haryana and Uttar Pradesh. With coverage this thin, Funding is not ranked and is not part of the index.</p>
    </section>

    <section>
      <h3>How the colours are computed</h3>
      <ol>
        <li><strong>Raw value first.</strong> Colour comes from the value, not the rank. In per-capita view the raw value is divided by population before anything else happens.</li>
        <li><strong>Min-max to 0-100</strong> within the metric and view, across the States/UTs that report it.</li>
        <li><strong>Linear or log.</strong> These distributions are brutally skewed: a few states hold most of the total. On a linear scale everyone outside the top handful turns the same pale colour. Log scale makes the middle of the table visible. The default is ${esc(meta.scale_presets.absolute)} for absolute and ${esc(meta.scale_presets.per_capita)} for per capita; the toggle is yours.</li>
      </ol>
      <p><strong>Per capita</strong> uses projected population for 1 March 2026 from the National Commission on Population's technical group. It is a projection from the 2011 Census, not a count, and for a few small UTs it may be well off. Startups are shown per million residents; FDI and funding in US dollars per resident.</p>
    </section>

    <section>
      <h3>The index</h3>
      <p><strong>${esc(meta.composite.name)} (${esc(meta.composite.qualifier)}), ${esc(meta.methodology_version)}.</strong> The weighted mean of two 0-100 scores, Startups and FDI, at fixed weights of ${w}. The scores are scaled within one fixed cohort: the ${meta.composite.cohort_size} States/UTs that report both.</p>
      <ul>
        <li>A state missing either component gets no index score. Weights are never re-spread across whatever happens to be available. Left out: ${esc(list(meta.composite.excluded.map((e) => e.state)))}.</li>
        <li>Because ${n - meta.composite.cohort_size} jurisdictions are left out, this is not an all-India ranking.</li>
        <li>Funding is excluded by design. If it is ever added, the index gets a new name and version rather than quietly changing.</li>
        <li>Equal weights are a starting choice, not a finding. The linear/log toggle moves ranks; that sensitivity is the point of showing it.</li>
        <li>The two components are not added as money. They are separately scaled signals.</li>
      </ul>
    </section>

    <section>
      <h3>Missing data and mismatched dates</h3>
      <p>No figure on this site is estimated, interpolated or backfilled. If a source has no row for a state, the state is hatched on the map and reads "Data unavailable" in the table and the card. A gap is never treated as zero.</p>
      <p>The metrics cover different periods: Startups ${esc(m.startups.period_label)}, FDI ${esc(m.fdi_usd_m.period_label)}, Funding ${esc(m.funding_usd_m.period_label)}. This is a latest-available panel, not a snapshot of one moment. Sources were last checked on ${date(meta.data_checked_at)}; that is when we looked, not how fresh the underlying data is.</p>
    </section>

    <section>
      <h3>Sources</h3>
      <ul class="sources">
        ${Object.entries(sources).map(([id, s]) => `
          <li id="src-${esc(id)}">
            <p class="src-use">${esc(usedBy(id))}</p>
            <p class="src-name"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}<span class="sr-only"> (opens in a new tab)</span></a></p>
            <p class="src-meta">${esc(s.publisher)}</p>
            <p class="src-meta">${esc(s.table)}</p>
            <p class="src-meta">${s.publication_date ? `Published ${date(s.publication_date)} · ` : ''}Retrieved ${date(s.accessed_at)}</p>
            ${s.extraction ? `<p class="src-note">${esc(s.extraction)}</p>` : ''}
            ${s.notes ? `<p class="src-note">${esc(s.notes)}</p>` : ''}
          </li>`).join('')}
      </ul>
    </section>

    <section>
      <h3>Map boundaries</h3>
      <p>Map boundaries as per official Government of India sources (Local Government Directory / Bharatmaps); shown for data visualization only. Shapes are simplified for file size. Nothing was edited, merged or moved.</p>
    </section>`;
}
