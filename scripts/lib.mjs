// Shared helpers for the data pipeline. No data values live here.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const path = (...p) => resolve(ROOT, ...p);

export const readJson = async (rel) => JSON.parse(await readFile(path(rel), 'utf8'));

/** Parse a CSV with `# key: value` header comments. Returns { meta, rows }. */
export async function readCsv(rel) {
  const text = (await readFile(path(rel), 'utf8')).replace(/^﻿/, '');
  const meta = {};
  const body = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#')) {
      const m = line.match(/^#\s*([a-z_0-9]+):\s*(.*)$/i);
      if (m) meta[m[1]] = m[2].trim();
    } else if (line.trim()) body.push(line);
  }
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    if (q) throw new Error(`${rel}: unterminated quote in line: ${line}`);
    out.push(cur);
    return out;
  };
  const header = parseLine(body[0]);
  const rows = body.slice(1).map((l) => {
    const cells = parseLine(l);
    if (cells.length !== header.length) {
      throw new Error(`${rel}: expected ${header.length} cells, got ${cells.length}: ${l}`);
    }
    return Object.fromEntries(header.map((h, i) => [h, cells[i].trim()]));
  });
  return { meta, rows };
}

/** "8,59,196.43" -> 859196.43. Throws on anything that is not a plain number. */
export function parseNumber(text, where) {
  const cleaned = String(text).replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error(`${where}: not a number: "${text}"`);
  return Number(cleaned);
}

export const normName = (s) => String(s).toUpperCase().replace(/\s+/g, ' ').trim();

/** Build a resolver that maps a printed name to an iso code, or 'SKIP' for known non-state rows. Throws otherwise. */
export function makeResolver(nameMap) {
  const aliases = new Map(Object.entries(nameMap.aliases).map(([k, v]) => [normName(k), v]));
  const skip = new Set(nameMap.non_state_rows.map(normName));
  const isos = new Set(nameMap.canonical.map((c) => c.iso));
  for (const [k, v] of aliases) if (!isos.has(v)) throw new Error(`state-name-map: alias "${k}" -> unknown iso "${v}"`);
  return (printed, file) => {
    const n = normName(printed);
    if (skip.has(n)) return 'SKIP';
    const iso = aliases.get(n);
    if (!iso) {
      throw new Error(
        `UNMATCHED STATE NAME in ${file}: "${printed}"\n` +
          `  Add it to scripts/state-name-map.json (aliases or non_state_rows). The build never guesses.`,
      );
    }
    return iso;
  };
}

// ---- scoring (used by the build to write scores and by validate to re-derive them) ----

export const round = (x, dp) => Number(x.toFixed(dp));

/** Min-max to 0-100. `log` uses log10 of the raw value. Input: [{iso, value}], all values finite. */
export function minMax(items, log) {
  const t = (v) => {
    if (!log) return v;
    if (!(v > 0)) throw new Error(`log scale needs positive values, got ${v}`);
    return Math.log10(v);
  };
  const xs = items.map((d) => t(d.value));
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const out = new Map();
  items.forEach((d, i) => out.set(d.iso, hi === lo ? 100 : ((xs[i] - lo) / (hi - lo)) * 100));
  return out;
}

/** Competition ranking (1,2,2,4) on value, descending. */
export function rankDesc(items) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const out = new Map();
  sorted.forEach((d, i) => {
    out.set(d.iso, i > 0 && sorted[i - 1].value === d.value ? out.get(sorted[i - 1].iso) : i + 1);
  });
  return out;
}

export function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const METRICS = ['startups', 'fdi_usd_m', 'funding_usd_m'];
export const COMPOSITE_METRICS = ['startups', 'fdi_usd_m'];
export const VIEWS = ['absolute', 'per_capita'];
export const SCALES = ['linear', 'log'];

/** Raw value of a metric in a view, or null. Per-capita is computed from raw values, before any scoring. */
export function viewValue(state, metric, view) {
  const m = state.metrics[metric];
  if (m.value == null) return null;
  if (view === 'absolute') return m.value;
  return m.per_capita ? m.per_capita.value : null;
}
