// Draws the share card (1200x630) from the built data and rasterises it.
//   public/data/states.json + public/data/india-states.topo.json -> og-image.svg -> public/og-image.png
// The card shows the index in the site's default view. No figure is typed in here.
import { writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { geoArea, geoMercator, geoPath } from 'd3-geo';
import { interpolateLab, piecewise } from 'd3-interpolate';
import { feature } from 'topojson-client';
import { path, readJson } from './lib.mjs';

const RAMP = ['#FBEBDD', '#F9D2BC', '#F4AE95', '#E98670', '#CC5F49', '#9A3F2D', '#5E2618'];
const CREDIT = 'ginclair.com/ginhouse';
const ramp = piecewise(interpolateLab, RAMP);

const data = await readJson('public/data/states.json');
const topo = await readJson('public/data/india-states.topo.json');
const { meta } = data;
const view = meta.default_view;
const scale = meta.scale_presets[view];
const byIso = new Map(data.states.map((s) => [s.iso, s]));

const flip = (rings) => rings.map((r) => [...r].reverse());
const features = feature(topo, topo.objects.states).features.map((f) => {
  if (geoArea(f) <= 2 * Math.PI) return f;
  const g = f.geometry;
  return { ...f, geometry: { ...g, coordinates: g.type === 'Polygon' ? flip(g.coordinates) : g.coordinates.map(flip) } };
});

const MAP = { x: 640, y: 24, w: 536, h: 582 };
const projection = geoMercator().fitExtent([[MAP.x, MAP.y], [MAP.x + MAP.w, MAP.y + MAP.h]], { type: 'FeatureCollection', features });
const gp = geoPath(projection);

const shapes = features.map((f) => {
  const c = byIso.get(f.properties.iso).composite[view];
  const fill = c ? ramp(c[scale].score / 100) : 'url(#hatch)';
  return `<path d="${gp(f)}" fill="${fill}" stroke="#FBF3E7" stroke-width="0.9"/>`;
}).join('');

const m = meta.metrics;
const stops = RAMP.map((c, i) => `<stop offset="${(i / (RAMP.length - 1)) * 100}%" stop-color="${c}"/>`).join('');
const font = `font-family="Inter, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#F3E9DC"/><rect width="1.6" height="6" fill="#CDB9A6"/></pattern>
    <linearGradient id="ramp" x1="0" x2="1" y1="0" y2="0">${stops}</linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#FBF3E7"/>
  <rect x="64" y="66" width="18" height="18" rx="4" fill="#9A3F2D"/><path d="M64 70a4 4 0 0 1 4-4h14L64 84z" fill="#F4AE95"/>
  <text x="94" y="81" ${font} font-size="20" font-weight="600" fill="#3E2416">Innovation Density</text>
  <text ${font} font-size="68" font-weight="700" fill="#3E2416" letter-spacing="-2.4">
    <tspan x="62" y="206">India Innovation</tspan><tspan x="62" y="282">Density Map</tspan>
  </text>
  <text ${font} font-size="24" fill="#5A3A28">
    <tspan x="64" y="340">Startups and foreign investment across</tspan><tspan x="64" y="372">Indian states and UTs, per capita.</tspan>
  </text>
  <rect x="64" y="424" width="360" height="14" rx="3" fill="url(#ramp)"/>
  <text x="64" y="462" ${font} font-size="17" fill="#5A3A28">0</text>
  <text x="424" y="462" ${font} font-size="17" fill="#5A3A28" text-anchor="end">100</text>
  <text x="244" y="462" ${font} font-size="17" fill="#7A5A48" text-anchor="middle">index score, ${scale} scale</text>
  <text x="64" y="518" ${font} font-size="17" fill="#7A5A48">Startups ${m.startups.period_label} · FDI equity ${m.fdi_usd_m.period_label}</text>
  <text x="64" y="544" ${font} font-size="17" fill="#7A5A48">Independent experimental index · ${meta.composite.cohort_size} of ${data.states.length} States/UTs scored</text>
  <text x="64" y="582" ${font} font-size="19" font-weight="600" fill="#3E2416">${CREDIT}</text>
  ${shapes}
</svg>`;

await writeFile(path('og-image.svg'), svg);
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng();
await writeFile(path('public/og-image.png'), png);
console.log(`wrote og-image.svg and public/og-image.png (${(png.length / 1024).toFixed(0)} KB)`);
