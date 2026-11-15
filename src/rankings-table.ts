// Sortable rankings table. It carries every datum the map shows, so the map is never the only way in.
import { LAYERS } from './config';
import { esc, formatValue, layerLabel, layerRank, layerValue, missingReason, unitLabel, viewLabel } from './model';
import type { AppState, Dataset, LayerKey, StateRecord } from './types';

type SortKey = 'state' | LayerKey;
export interface TableApi { update(st: AppState): void }

export function createTable(root: HTMLElement, data: Dataset, onSelect: (iso: string, opener: HTMLElement) => void): TableApi {
  const { meta } = data;
  let sortKey: SortKey = 'composite';
  let dir: 1 | -1 = -1;
  let lastLayer: LayerKey | null = null;
  let query = '';
  let st: AppState | null = null;

  root.innerHTML = `
    <div class="table-tools">
      <label class="search"><span class="sr-only">Filter states and UTs</span>
        <input type="search" id="table-filter" placeholder="Filter states and UTs" autocomplete="off"></label>
      <p class="table-caption" id="table-caption" aria-live="polite"></p>
    </div>
    <div class="table-scroll" tabindex="0" role="region" aria-labelledby="rankings-title">
      <table class="rankings" aria-describedby="table-caption">
        <thead><tr>
          <th scope="col" class="num col-rank" id="th-rank"></th>
          <th scope="col" class="col-state" data-key="state"><button type="button">State / UT<span class="arrow" aria-hidden="true"></span></button></th>
          ${LAYERS.filter((l) => l !== 'composite').map((l) => `<th scope="col" class="num" data-key="${l}"><button type="button">${esc(layerLabel(meta, l))}${meta.metrics[l as Exclude<LayerKey, 'composite'>].partial ? '<span class="badge">partial</span>' : ''}<span class="arrow" aria-hidden="true"></span></button><span class="th-unit" data-unit="${l}"></span></th>`).join('')}
          <th scope="col" class="num" data-key="composite"><button type="button">Index<span class="arrow" aria-hidden="true"></span></button><span class="th-unit">0-100</span></th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <p class="note table-foot" id="table-foot"></p>`;

  const tbody = root.querySelector('tbody')!;
  const filter = root.querySelector<HTMLInputElement>('#table-filter')!;

  const render = () => {
    if (!st) return;
    const s0 = st;
    const val = (s: StateRecord, key: SortKey) => (key === 'state' ? null : layerValue(s, key, s0.view, s0.scale));
    const rows = data.states
      .filter((s) => s.state.toLowerCase().includes(query))
      .sort((a, b) => {
        if (sortKey === 'state') return dir * a.state.localeCompare(b.state);
        const va = val(a, sortKey), vb = val(b, sortKey);
        if (va == null && vb == null) return a.state.localeCompare(b.state);
        if (va == null) return 1; // gaps always sink, in either direction
        if (vb == null) return -1;
        return dir * (va - vb) || a.state.localeCompare(b.state);
      });

    const cell = (s: StateRecord, l: LayerKey) => {
      const v = layerValue(s, l, s0.view, s0.scale);
      if (v == null) return `<td class="num na" title="${esc(missingReason(s, l, meta))}">${l === 'composite' ? 'Not scored' : 'Unavailable'}<span class="sr-only">. ${esc(missingReason(s, l, meta))}</span></td>`;
      // in-cell bar: the value as a share of the column maximum, from zero
      const max = l === 'composite' ? 100 : meta.metrics[l].ranges[s0.view].max;
      return `<td class="num has-bar${l === s0.layer ? ' is-layer' : ''}" style="--bar:${(v / max).toFixed(4)}"><span>${formatValue(l, s0.view, v)}</span></td>`;
    };

    tbody.innerHTML = rows.map((s) => {
      const r = layerRank(s, s0.layer, s0.view, s0.scale);
      return `<tr data-iso="${s.iso}"${s0.selected === s.iso ? ' class="is-selected"' : ''}>
        <td class="num col-rank">${r ? r.rank : '<span class="na">-</span>'}</td>
        <th scope="row" class="col-state"><button type="button" data-open="${s.iso}"${s0.selected === s.iso ? ' aria-current="true"' : ''}>${esc(s.state)}${s.type === 'UT' ? ' <span class="ut">UT</span>' : ''}</button></th>
        ${LAYERS.filter((l) => l !== 'composite').map((l) => cell(s, l)).join('')}${cell(s, 'composite')}
      </tr>`;
    }).join('') || `<tr><td colspan="6" class="empty-row">No state or UT matches "${esc(query)}".</td></tr>`;

    root.querySelectorAll<HTMLElement>('th[data-key]').forEach((th) => {
      th.setAttribute('aria-sort', th.dataset.key === sortKey ? (dir === 1 ? 'ascending' : 'descending') : 'none');
    });
    root.querySelectorAll<HTMLElement>('[data-unit]').forEach((n) => { n.textContent = unitLabel(meta, n.dataset.unit as LayerKey, s0.view); });
    root.querySelector('#th-rank')!.innerHTML = `Rank<span class="th-unit">${esc(layerLabel(meta, s0.layer))}</span>`;
    root.querySelector('#table-caption')!.textContent =
      `${rows.length} of ${data.states.length} shown · ${viewLabel(s0.view)} values · sorted by ${sortKey === 'state' ? 'name' : layerLabel(meta, sortKey)}, ${dir === 1 ? 'ascending' : 'descending'}`;
    const ni = meta.metrics.fdi_usd_m.state_not_indicated!;
    root.querySelector('#table-foot')!.textContent =
      `Not in any row: ${formatValue('fdi_usd_m', 'absolute', ni.value)} of FDI equity (${ni.year}) is reported as "State Not Indicated" and is not assigned to any state. ` +
      `Funding is partial coverage and carries no rank. Index scores exist only for the ${meta.composite.cohort_size} States/UTs that report both Startups and FDI.`;
  };

  root.querySelector('thead')!.addEventListener('click', (e) => {
    const th = (e.target as Element).closest<HTMLElement>('th[data-key]');
    if (!th) return;
    const key = th.dataset.key as SortKey;
    if (key === sortKey) dir = dir === 1 ? -1 : 1;
    else { sortKey = key; dir = key === 'state' ? 1 : -1; }
    render();
  });
  tbody.addEventListener('click', (e) => {
    const t = e.target as Element;
    const tr = t.closest<HTMLElement>('tr[data-iso]');
    if (!tr) return;
    onSelect(tr.dataset.iso!, tr.querySelector<HTMLElement>('[data-open]')!);
  });
  filter.addEventListener('input', () => { query = filter.value.trim().toLowerCase(); render(); });

  return {
    update(next) {
      // changing the metric re-sorts by it; changing anything else keeps the reader's sort
      if (next.layer !== lastLayer) { sortKey = next.layer; dir = -1; lastLayer = next.layer; }
      st = next;
      render();
    },
  };
}
