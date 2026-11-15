// Metric chips, Absolute | Per capita, Linear | Log, and the legend.
import { LAYERS, RAMP } from './config';
import { esc, formatValue, layerLabel } from './model';
import type { AppState, Dataset, LayerKey, Scale, View } from './types';

export interface ControlsApi { update(st: AppState): void }

export function createControls(
  root: HTMLElement,
  legend: HTMLElement,
  data: Dataset,
  on: { layer(l: LayerKey): void; view(v: View): void; scale(s: Scale): void },
): ControlsApi {
  const { meta } = data;
  const sub = (l: LayerKey) => (l === 'composite' ? meta.composite.qualifier.split(',')[0] : meta.metrics[l].period_label);

  root.innerHTML = `
    <div class="chips" role="group" aria-label="Metric shown on the map">
      ${LAYERS.map((l) => `
        <button type="button" class="chip" data-layer="${l}" aria-pressed="false">
          <span class="chip-label">${esc(layerLabel(meta, l))}${l !== 'composite' && meta.metrics[l].partial ? '<span class="badge">partial</span>' : ''}</span>
          <span class="chip-sub">${esc(sub(l))}</span>
        </button>`).join('')}
    </div>
    <div class="toggles">
      <div class="segmented" role="group" aria-label="Normalisation">
        <button type="button" data-view="absolute" aria-pressed="false">Absolute</button>
        <button type="button" data-view="per_capita" aria-pressed="false">Per capita</button>
      </div>
      <div class="segmented" role="group" aria-label="Colour scale">
        <button type="button" data-scale="linear" aria-pressed="false">Linear</button>
        <button type="button" data-scale="log" aria-pressed="false">Log</button>
      </div>
    </div>`;

  root.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.layer) on.layer(b.dataset.layer as LayerKey);
    if (b.dataset.view) on.view(b.dataset.view as View);
    if (b.dataset.scale) on.scale(b.dataset.scale as Scale);
  });

  legend.innerHTML = `
    <div class="legend-bar" style="background:linear-gradient(90deg, ${RAMP.join(', ')})" aria-hidden="true"></div>
    <div class="legend-ends"><span id="legend-lo"></span><span id="legend-mid"></span><span id="legend-hi"></span></div>
    <p class="legend-na"><span class="swatch-hatch" aria-hidden="true"></span><span id="legend-na-text"></span></p>`;
  const $ = (id: string) => legend.querySelector<HTMLElement>(`#${id}`)!;

  return {
    update(st) {
      root.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === st.layer)));
      root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === st.view)));
      root.querySelectorAll<HTMLButtonElement>('[data-scale]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scale === st.scale)));

      if (st.layer === 'composite') {
        $('legend-lo').textContent = '0';
        $('legend-hi').textContent = '100';
        $('legend-mid').textContent = `scored among ${meta.composite.cohort_size} of ${data.states.length}`;
        const n = meta.composite.excluded.length;
        $('legend-na-text').textContent = `Not scored: a component is not reported (${n})`;
      } else {
        const m = meta.metrics[st.layer];
        const r = m.ranges[st.view];
        $('legend-lo').textContent = formatValue(st.layer, st.view, r.min);
        $('legend-hi').textContent = formatValue(st.layer, st.view, r.max);
        $('legend-mid').textContent = st.scale === 'log' ? 'log scale' : 'linear scale';
        const n = data.states.length - m.coverage;
        $('legend-na-text').textContent = n ? `Data unavailable (${n})` : 'Data unavailable (none for this metric)';
      }
    },
  };
}
