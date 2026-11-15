// SVG choropleth. Fill colour comes from the pre-computed score in states.json;
// a state without a score gets the hatched "unavailable" fill, never a colour.
import { geoArea, geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import type { Topology } from 'topojson-specification';
import { colorFor, describe, formatValue, layerLabel, layerRank, layerScore, layerValue, missingReason, valueSuffix } from './model';
import type { AppState, Dataset, StateRecord } from './types';

const W = 600;
const H = 660;
const NS = 'http://www.w3.org/2000/svg';
const HATCH = 'url(#hatch)';
const SMALL_AREA = 46; // px² below which a state also gets a marker dot

type StateFeature = Feature<Polygon | MultiPolygon, { iso: string; lgd: number }>;

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** d3-geo treats rings on a sphere; a ring wound the other way covers "everything else". Flip those. */
function fixWinding(f: StateFeature): StateFeature {
  if (geoArea(f) <= 2 * Math.PI) return f;
  const flip = (rings: Position[][]) => rings.map((r) => [...r].reverse());
  const g = f.geometry;
  const geometry = g.type === 'Polygon'
    ? { ...g, coordinates: flip(g.coordinates) }
    : { ...g, coordinates: g.coordinates.map(flip) };
  return { ...f, geometry } as StateFeature;
}

function largestPart(f: StateFeature): Feature<Polygon> {
  const g = f.geometry;
  if (g.type === 'Polygon') return f as Feature<Polygon>;
  let best = g.coordinates[0];
  let bestArea = -1;
  for (const coords of g.coordinates) {
    const a = geoArea({ type: 'Polygon', coordinates: coords });
    if (a > bestArea) { bestArea = a; best = coords; }
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: best } };
}

export interface MapApi {
  update(st: AppState): void;
  setExplore(on: boolean): void;
  zoomBy(factor: number): void;
  reset(): void;
  highlight(iso: string | null): void;
}

export function createMap(
  svg: SVGSVGElement,
  tooltip: HTMLElement,
  topo: Topology,
  data: Dataset,
  onSelect: (iso: string) => void,
): MapApi {
  const byIso = new Map(data.states.map((s) => [s.iso, s]));
  const fc = feature(topo, topo.objects.states) as unknown as FeatureCollection<Polygon | MultiPolygon, { iso: string; lgd: number }>;
  const features = fc.features.map(fixWinding);
  for (const f of features) if (!byIso.has(f.properties.iso)) throw new Error(`Boundary ${f.properties.iso} has no data record`);

  const projection = geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], { type: 'FeatureCollection', features });
  const path = geoPath(projection);

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'group');
  svg.innerHTML = '';

  const defs = el('defs');
  const pattern = el('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pattern.append(el('rect', { width: 6, height: 6, fill: '#F3E9DC' }), el('rect', { width: 1.6, height: 6, fill: '#CDB9A6' }));
  defs.append(pattern);
  const root = el('g', { class: 'map-root' });
  const shapes = el('g', { class: 'shapes' });
  const markers = el('g', { class: 'markers' });
  const top = el('g', { class: 'top' });
  root.append(shapes, markers, top);
  svg.append(defs, root);

  const nodes = new Map<string, SVGElement[]>();
  let current: AppState | null = null;

  for (const f of features) {
    const iso = f.properties.iso;
    const p = el('path', { d: path(f) ?? '', class: 'state', 'data-iso': iso });
    shapes.append(p);
    nodes.set(iso, [p]);
    if (path.area(f) < SMALL_AREA) {
      const [cx, cy] = path.centroid(largestPart(f));
      const c = el('circle', { cx, cy, r: 5, class: 'state marker', 'data-iso': iso });
      markers.append(c);
      nodes.get(iso)!.push(c);
    }
  }
  const outline = el('path', { class: 'selected-outline', d: '' });
  top.append(outline);

  // ---- tooltip ----
  const showTip = (iso: string, x: number, y: number) => {
    if (!current) return;
    const s = byIso.get(iso)!;
    const { layer, view, scale } = current;
    const v = layerValue(s, layer, view, scale);
    const r = layerRank(s, layer, view, scale);
    const label = layerLabel(data.meta, layer);
    tooltip.innerHTML = '';
    const name = document.createElement('strong');
    name.textContent = s.state;
    const line = document.createElement('span');
    if (v == null) {
      line.className = 'tip-na';
      line.textContent = `${label}: data unavailable`;
    } else {
      line.textContent = `${label}: ${formatValue(layer, view, v)} ${valueSuffix(data.meta, layer, view)}`.trim();
    }
    tooltip.append(name, line);
    if (v != null) {
      const rk = document.createElement('span');
      rk.className = 'tip-rank';
      rk.textContent = r ? `Rank ${r.rank} of ${r.of}` : 'Partial coverage, not ranked';
      tooltip.append(rk);
    }
    tooltip.hidden = false;
    const box = svg.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const left = Math.min(Math.max(x - box.left + 14, 4), box.width - tw - 4);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(y - box.top - tooltip.offsetHeight - 12, 4)}px`;
  };
  const hideTip = () => { tooltip.hidden = true; };

  const isoOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<SVGElement>('[data-iso]')?.dataset.iso ?? null : null);
  svg.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const iso = isoOf(e.target);
    if (iso && !dragging) showTip(iso, e.clientX, e.clientY); else hideTip();
  });
  svg.addEventListener('pointerleave', hideTip);
  svg.addEventListener('click', (e) => {
    const iso = isoOf(e.target);
    if (iso && !moved) onSelect(iso);
  });

  // ---- explore mode: pan and zoom, off by default so the page scrolls normally ----
  let explore = false;
  let k = 1, tx = 0, ty = 0;
  let dragging = false;
  let moved = false;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { d: number; k: number } | null = null;

  const apply = () => {
    k = Math.min(8, Math.max(1, k));
    tx = Math.min(0, Math.max(W - W * k, tx));
    ty = Math.min(0, Math.max(H - H * k, ty));
    root.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`);
    svg.style.setProperty('--k', String(k));
  };
  const toSvg = (cx: number, cy: number) => {
    const b = svg.getBoundingClientRect();
    return { x: ((cx - b.left) / b.width) * W, y: ((cy - b.top) / b.height) * H };
  };
  const zoomAt = (factor: number, px: number, py: number) => {
    const nk = Math.min(8, Math.max(1, k * factor));
    tx = px - ((px - tx) / k) * nk;
    ty = py - ((py - ty) / k) * nk;
    k = nk;
    apply();
  };

  svg.addEventListener('pointerdown', (e) => {
    moved = false;
    if (!explore) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), k };
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!explore || !pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    const b = svg.getBoundingClientRect();
    const dx = ((e.clientX - prev.x) / b.width) * W;
    const dy = ((e.clientY - prev.y) / b.height) * H;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStart) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const mid = toSvg((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      zoomAt((pinchStart.k * (d / pinchStart.d)) / k, mid.x, mid.y);
      moved = true;
    } else if (pointers.size === 1) {
      if (Math.abs(dx) + Math.abs(dy) > 1.5) { moved = true; dragging = true; svg.setPointerCapture(e.pointerId); }
      tx += dx; ty += dy; apply();
    }
  });
  const endPointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) dragging = false;
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('wheel', (e) => {
    if (!explore) return;
    e.preventDefault();
    const p = toSvg(e.clientX, e.clientY);
    zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y);
  }, { passive: false });

  return {
    update(st) {
      current = st;
      svg.setAttribute('aria-label', `Map of Indian states and union territories coloured by ${describe(data.meta, st)}. The rankings table below carries the same data.`);
      for (const [iso, list] of nodes) {
        const s = byIso.get(iso) as StateRecord;
        const score = layerScore(s, st.layer, st.view, st.scale);
        // a score that is not a finite number never reaches the ramp
        const fill = score != null && Number.isFinite(score) ? colorFor(score) : HATCH;
        for (const n of list) {
          n.style.fill = fill;
          n.classList.toggle('unavailable', fill === HATCH);
          n.classList.toggle('is-selected', st.selected === iso);
          const title = score == null ? `${s.state}: ${missingReason(s, st.layer, data.meta)}` : s.state;
          n.setAttribute('aria-label', title);
        }
      }
      const sel = st.selected ? nodes.get(st.selected)?.[0] : null;
      outline.setAttribute('d', sel ? sel.getAttribute('d') ?? '' : '');
    },
    setExplore(on) {
      explore = on;
      svg.classList.toggle('exploring', on);
      if (!on) { k = 1; tx = 0; ty = 0; apply(); pointers.clear(); }
    },
    zoomBy(factor) { zoomAt(factor, W / 2, H / 2); },
    reset() { k = 1; tx = 0; ty = 0; apply(); },
    highlight(iso) {
      svg.classList.toggle('has-hover', !!iso);
      for (const [key, list] of nodes) for (const n of list) n.classList.toggle('is-hover', key === iso);
    },
  };
}
