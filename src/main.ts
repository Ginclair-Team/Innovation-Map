import '@fontsource-variable/inter';
import './style.css';
import './infographic.css';
import type { Topology } from 'topojson-specification';
import { CREDIT, LAYERS } from './config';
import { createControls } from './controls';
import { createDetail } from './detail-card';
import { createLeaders, createScatter, createStats } from './insights';
import { createMap } from './map';
import { renderMethodology } from './methodology';
import { describe, esc } from './model';
import { createTable } from './rankings-table';
import type { AppState, Dataset, LayerKey, Sources, View } from './types';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
};

async function boot() {
  const base = import.meta.env.BASE_URL;
  const [data, sources, topo] = await Promise.all([
    getJson<Dataset>(`${base}data/states.json`),
    getJson<Sources>(`${base}data/sources.json`),
    getJson<Topology>(`${base}data/india-states.topo.json`),
  ]);
  const { meta } = data;
  const isos = new Set(data.states.map((s) => s.iso));

  // ---- state, restored from the URL hash so a view can be shared ----
  const st: AppState = { layer: 'composite', view: meta.default_view, scale: meta.scale_presets[meta.default_view], scaleManual: false, selected: null };
  const h = new URLSearchParams(location.hash.slice(1));
  if ((LAYERS as readonly string[]).includes(h.get('m') ?? '')) st.layer = h.get('m') as LayerKey;
  if (h.get('v') === 'absolute' || h.get('v') === 'per_capita') { st.view = h.get('v') as View; st.scale = meta.scale_presets[st.view]; }
  if (h.get('scale') === 'linear' || h.get('scale') === 'log') { st.scale = h.get('scale') as 'linear' | 'log'; st.scaleManual = true; }
  if (isos.has(h.get('s') ?? '')) st.selected = h.get('s');

  let opener: HTMLElement | null = null;
  const select = (iso: string | null, from?: HTMLElement, moveFocus = false) => {
    st.selected = iso;
    if (from) opener = from;
    render();
    if (iso && moveFocus) detail.focus();
    if (!iso && opener?.isConnected) opener.focus();
    if (!iso) opener = null;
  };

  const map = createMap($<HTMLElement>('#map') as unknown as SVGSVGElement, $('#tooltip'), topo, data, (iso) => select(iso));
  const controls = createControls($('#controls'), $('#legend'), data, {
    layer(l) { st.layer = l; render(); },
    view(v) { st.view = v; if (!st.scaleManual) st.scale = meta.scale_presets[v]; render(); },
    scale(s) { st.scale = s; st.scaleManual = true; render(); },
  });
  const detail = createDetail($('#detail'), data, sources, {
    close: () => select(null),
    select: (iso) => select(iso, undefined, true),
  });
  const table = createTable($('#rankings'), data, (iso, from) => select(iso, from, true));
  renderMethodology($('#method-body'), data, sources);

  // ---- infographic layer; hovering anything that names a state lights it up on the map ----
  const handlers = {
    select: (iso: string, from?: HTMLElement) => select(iso, from, !!from),
    hover: (iso: string | null) => map.highlight(iso),
  };
  createStats($('#stats'), data, handlers);
  const leaders = createLeaders($('#leaders'), data, handlers);
  const scatter = createScatter($('#scatter'), data, handlers);
  for (const sel of ['#stats', '#leaders', '#rankings', '#detail']) {
    const node = $(sel);
    node.addEventListener('pointerover', (e) => map.highlight((e.target as Element).closest<HTMLElement>('[data-iso]')?.dataset.iso ?? null));
    node.addEventListener('pointerleave', () => map.highlight(null));
    node.addEventListener('focusin', (e) => map.highlight((e.target as Element).closest<HTMLElement>('[data-iso]')?.dataset.iso ?? null));
    node.addEventListener('focusout', () => map.highlight(null));
  }

  // ---- jump list: the reliable way to reach small UTs ----
  const jump = $<HTMLSelectElement>('#jump');
  jump.innerHTML = '<option value="">Jump to a state or UT</option>' +
    [...data.states].sort((a, b) => a.state.localeCompare(b.state)).map((s) => `<option value="${s.iso}">${esc(s.state)}</option>`).join('');
  jump.addEventListener('change', () => select(jump.value || null, jump, !!jump.value));

  // ---- explore mode ----
  const exploreBtn = $<HTMLButtonElement>('#explore');
  const zoomTools = $('#zoom-tools');
  exploreBtn.addEventListener('click', () => {
    const on = exploreBtn.getAttribute('aria-pressed') !== 'true';
    exploreBtn.setAttribute('aria-pressed', String(on));
    exploreBtn.textContent = on ? 'Exit explore mode' : 'Explore: zoom and pan';
    zoomTools.hidden = !on;
    map.setExplore(on);
  });
  $('#zoom-in').addEventListener('click', () => map.zoomBy(1.5));
  $('#zoom-out').addEventListener('click', () => map.zoomBy(1 / 1.5));
  $('#zoom-reset').addEventListener('click', () => map.reset());

  // ---- methodology drawer ----
  const dlg = $<HTMLDialogElement>('#method');
  document.querySelectorAll<HTMLElement>('[data-open-method]').forEach((b) => b.addEventListener('click', () => dlg.showModal()));
  $('#method-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.selected && !dlg.open) select(null);
  });

  // ---- footer ----
  const m = meta.metrics;
  $('#foot-years').textContent =
    `Data periods: Startups ${m.startups.period_label} · FDI ${m.fdi_usd_m.period_label} · Funding ${m.funding_usd_m.period_label} (partial coverage). ` +
    `Sources last checked ${meta.data_checked_at}. ${meta.composite.name}, ${meta.methodology_version}.`;
  const credit = $<HTMLAnchorElement>('#credit');
  credit.textContent = CREDIT.label;
  credit.href = CREDIT.url;

  function render() {
    map.update(st);
    controls.update(st);
    detail.update(st);
    table.update(st);
    leaders.update(st);
    scatter.update(st);
    $('#map-title').textContent = describe(meta, st);
    jump.value = st.selected ?? '';
    const p = new URLSearchParams({ m: st.layer, v: st.view });
    if (st.scaleManual) p.set('scale', st.scale);
    if (st.selected) p.set('s', st.selected);
    history.replaceState(null, '', `#${p}`);
  }
  render();
  document.documentElement.classList.add('is-ready');
}

boot().catch((err) => {
  console.error(err);
  const box = document.querySelector('#load-error');
  if (box) { box.textContent = 'The data could not be loaded. Reload the page to try again.'; (box as HTMLElement).hidden = false; }
});
