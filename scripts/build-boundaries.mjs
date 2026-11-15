// Turns the LGD state boundary release into a small TopoJSON for display.
//   data/raw/boundaries/LGD_States.geojsonl.7z  ->  public/data/india-states.topo.json
//
// Geometry is simplified for file size only. No boundary is edited, merged, split or moved,
// and features are joined to the app on the LGD code carried by the source, never on names.
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import sevenZip from '7zip-min';
import mapshaper from 'mapshaper';
import { makeResolver, path, readJson } from './lib.mjs';

const ARCHIVE = path('data/raw/boundaries/LGD_States.geojsonl.7z');
const OUT_DIR = path('data/raw/boundaries/extracted');
const GEOJSONL = path('data/raw/boundaries/extracted/LGD_States.geojsonl');
const OUT = path('public/data/india-states.topo.json');
const SIMPLIFY = process.argv[2] ?? '1.2%';

if (!existsSync(GEOJSONL)) {
  if (!existsSync(ARCHIVE)) { console.error('Missing boundary archive. Run `npm run data:fetch` first.'); process.exit(1); }
  await mkdir(OUT_DIR, { recursive: true });
  await new Promise((res, rej) => sevenZip.unpack(ARCHIVE, OUT_DIR, (e) => (e ? rej(e) : res())));
}

const nameMap = await readJson('scripts/state-name-map.json');
const resolve = makeResolver(nameMap);
const byLgd = new Map(nameMap.canonical.map((c) => [c.lgd, c]));

const features = (await readFile(GEOJSONL, 'utf8')).split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
const seen = new Set();
for (const f of features) {
  const lgd = f.properties.State_LGD;
  const c = byLgd.get(lgd);
  if (!c) { console.error(`BOUNDARY BUILD FAILED: LGD code ${lgd} ("${f.properties.STNAME}") is not in state-name-map.json`); process.exit(1); }
  // the name must agree with the code as well - a mismatch means the source changed under us
  const iso = resolve(f.properties.STNAME, 'LGD_States.geojsonl');
  if (iso !== c.iso) { console.error(`BOUNDARY BUILD FAILED: "${f.properties.STNAME}" resolves to ${iso} but its LGD code ${lgd} is ${c.iso}`); process.exit(1); }
  if (seen.has(c.iso)) { console.error(`BOUNDARY BUILD FAILED: duplicate feature for ${c.iso}`); process.exit(1); }
  seen.add(c.iso);
  f.properties = { iso: c.iso, lgd };
}
if (seen.size !== 36) { console.error(`BOUNDARY BUILD FAILED: expected 36 features, got ${seen.size}`); process.exit(1); }

const input = { 'states.json': JSON.stringify({ type: 'FeatureCollection', features }) };
const cmd = `-i states.json -simplify ${SIMPLIFY} keep-shapes -clean -o format=topojson quantization=20000 out.topo.json`;
const result = await mapshaper.applyCommands(cmd, input);
const topo = JSON.parse(result['out.topo.json'].toString());
const objName = Object.keys(topo.objects)[0];
topo.objects = { states: topo.objects[objName] };
if (topo.objects.states.geometries.length !== 36) { console.error('BOUNDARY BUILD FAILED: simplification dropped a feature'); process.exit(1); }

await mkdir(path('public/data'), { recursive: true });
await writeFile(OUT, JSON.stringify(topo));
const kb = (await stat(OUT)).size / 1024;
console.log(`wrote public/data/india-states.topo.json  ${kb.toFixed(0)} KB  (simplify ${SIMPLIFY}, 36 features)`);
if (kb > 500) { console.error('BOUNDARY BUILD FAILED: output exceeds the 500 KB budget'); process.exit(1); }
