// Read-only accessors over states.json. Nothing here computes a new figure:
// scores, ranks, per-capita values and medians are all read from the built data.
import { interpolateLab, piecewise } from 'd3-interpolate';
import { RAMP } from './config';
import type { AppState, LayerKey, Meta, MetricKey, Scale, StateRecord, View } from './types';

const ramp = piecewise(interpolateLab, RAMP);
export const colorFor = (score: number): string => ramp(Math.max(0, Math.min(1, score / 100)));

export function layerScore(s: StateRecord, layer: LayerKey, view: View, scale: Scale): number | null {
  if (layer === 'composite') return s.composite[view]?.[scale].score ?? null;
  return s.scores[layer][view]?.[scale] ?? null;
}

/** The figure a reader sees for this layer: the raw value, or the index score for the composite. */
export function layerValue(s: StateRecord, layer: LayerKey, view: View, scale: Scale): number | null {
  if (layer === 'composite') return s.composite[view]?.[scale].score ?? null;
  const m = s.metrics[layer];
  if (m.value == null) return null;
  return view === 'absolute' ? m.value : (m.per_capita?.value ?? null);
}

export function layerRank(s: StateRecord, layer: LayerKey, view: View, scale: Scale): { rank: number; of: number } | null {
  if (layer === 'composite') {
    const c = s.composite[view]?.[scale];
    return c ? { rank: c.rank, of: c.of } : null;
  }
  const sc = s.scores[layer][view];
  return sc && sc.rank != null && sc.of != null ? { rank: sc.rank, of: sc.of } : null;
}

const nf = (dp: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** Enough decimals to keep small values honest, none on large ones. */
export function num(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a < 1) return nf(a < 0.1 ? 3 : 2).format(v);
  if (a < 100) return nf(a < 10 ? 2 : 1).format(v);
  return nf(0).format(v);
}

export function formatValue(layer: LayerKey, view: View, v: number): string {
  if (layer === 'composite') return v.toFixed(1);
  if (layer === 'startups') return view === 'absolute' ? nf(0).format(v) : num(v);
  return view === 'absolute' ? `$${num(v)}M` : `$${num(v)}`;
}

export function unitLabel(meta: Meta, layer: LayerKey, view: View): string {
  if (layer === 'composite') return 'score, 0-100';
  return meta.metrics[layer].unit[view];
}

/** Unit to print right after a formatted value. Money already carries "$" and "M", so it only needs the denominator. */
export function valueSuffix(meta: Meta, layer: LayerKey, view: View): string {
  if (layer === 'composite') return '';
  if (layer === 'startups') return meta.metrics.startups.unit[view];
  return view === 'absolute' ? '' : 'per resident';
}

export function layerLabel(meta: Meta, layer: LayerKey, long = false): string {
  if (layer === 'composite') return long ? meta.composite.name : 'Index';
  return long ? meta.metrics[layer].long_label : meta.metrics[layer].label;
}

export function periodLabel(meta: Meta, layer: LayerKey): string {
  if (layer === 'composite') return meta.composite.components.map((m) => `${meta.metrics[m].label} ${meta.metrics[m].period_label}`).join(' + ');
  return meta.metrics[layer].period_label;
}

export const viewLabel = (view: View): string => (view === 'absolute' ? 'Absolute' : 'Per capita');

/** One line describing exactly what the map is showing right now. */
export function describe(meta: Meta, st: AppState): string {
  const parts = [layerLabel(meta, st.layer, true)];
  if (st.layer === 'composite') parts.push(`${viewLabel(st.view).toLowerCase()} inputs`);
  else parts.push(unitLabel(meta, st.layer, st.view));
  parts.push(periodLabel(meta, st.layer));
  if (st.scale === 'log') parts.push('log scale');
  return parts.join(' · ');
}

export const METRIC_KEYS: MetricKey[] = ['startups', 'fdi_usd_m', 'funding_usd_m'];

export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function missingReason(s: StateRecord, layer: LayerKey, meta: Meta): string {
  if (layer === 'composite') {
    const names = s.composite.missing.map((m) => meta.metrics[m].label).join(' and ');
    return `Not scored: ${names} not reported for this ${s.type === 'UT' ? 'UT' : 'state'}.`;
  }
  return s.metrics[layer].note ?? 'No figure in the source.';
}
