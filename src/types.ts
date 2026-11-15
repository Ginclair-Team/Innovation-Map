export type MetricKey = 'startups' | 'fdi_usd_m' | 'funding_usd_m';
export type LayerKey = MetricKey | 'composite';
export type View = 'absolute' | 'per_capita';
export type Scale = 'linear' | 'log';

export interface Figure {
  value: number | null;
  unit?: string;
  year: string | null;
  status: string;
  source_id: string | null;
  original_cell_text?: string;
  original_state_name?: string;
  locator?: string;
  provisional?: boolean;
  period_type?: string;
  read_from?: string;
  note?: string;
  per_capita?: { value: number; unit: string };
}

export interface Score { rank: number | null; of: number | null; linear: number; log: number; x_median: number; share_pct?: number }
export interface CompositeCell { score: number; rank: number; of: number }

export interface StateRecord {
  state: string;
  iso: string;
  lgd: number;
  type: 'State' | 'UT';
  metrics: Record<MetricKey, Figure>;
  population: Figure;
  context: {
    fdi_fy2025_26_usd_m: Figure;
    sisfs: {
      startups_supported: number | null;
      funds_approved_rs_crore: number | null;
      year: string | null;
      source_id: string | null;
      status: string;
      note?: string;
    };
  };
  scores: Record<MetricKey, Record<View, Score | null>>;
  composite: {
    absolute: Record<Scale, CompositeCell> | null;
    per_capita: Record<Scale, CompositeCell> | null;
    coverage: string;
    in_cohort: boolean;
    missing: MetricKey[];
  };
}

export interface MetricMeta {
  label: string;
  long_label: string;
  period_label: string;
  unit: Record<View, string>;
  partial: boolean;
  ranked: boolean;
  source_ids: string[];
  stated_total: number | null;
  coverage: number;
  medians: Record<View, number>;
  ranges: Record<View, { min: number; max: number }>;
  top5?: { isos: string[]; share_pct: number };
  state_not_indicated?: { value: number; unit: string; source_id: string; year: string };
}

export interface Meta {
  generated_at: string;
  data_checked_at: string;
  methodology_version: string;
  default_view: View;
  scale_presets: Record<View, Scale>;
  composite: {
    name: string;
    qualifier: string;
    components: MetricKey[];
    weights: Record<string, number>;
    cohort_size: number;
    excluded: { iso: string; state: string; missing: MetricKey[] }[];
    medians: Record<View, Record<Scale, number>>;
  };
  metrics: Record<MetricKey, MetricMeta>;
  population: { label: string; source_id: string; stated_total: number };
  context: Record<string, { label: string; unit?: string; source_id: string }>;
}

export interface Dataset { meta: Meta; states: StateRecord[] }

export interface Source {
  name: string;
  publisher: string;
  url: string;
  table: string;
  publication_date?: string;
  accessed_at: string;
  extraction?: string;
  notes?: string;
}
export type Sources = Record<string, Source>;

export interface AppState {
  layer: LayerKey;
  view: View;
  scale: Scale;
  scaleManual: boolean;
  selected: string | null;
}
