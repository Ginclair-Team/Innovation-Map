// Downloads the source documents that can be downloaded, records their SHA-256,
// and prints the manual checklist for everything that cannot be automated.
//
//   node scripts/fetch-data.mjs            download anything missing
//   node scripts/fetch-data.mjs --force    re-download everything
//
// Nothing here writes a data value. The PDFs are archived for audit; the figures
// were transcribed once into the CSVs next to them and are checked against the
// printed totals by build-states-json.mjs.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FORCE = process.argv.includes('--force');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const DOWNLOADS = [
  {
    id: 'ls-usq-1446-2026',
    url: 'https://sansad.in/getFile/lsapps/loksabhaquestions/annex/188/AU1446_N4i3CT.pdf',
    file: 'data/raw/startups/LS_AU1446.pdf',
  },
  {
    id: 'ls-usq-328-2026',
    url: 'https://sansad.in/getFile/lsapps/loksabhaquestions/annex/188/AU328_ieUsLp.pdf',
    file: 'data/raw/fdi/LS_AU328.pdf',
  },
  {
    id: 'dpiit-fdi-factsheet-2026-03',
    url: 'https://www.dpiit.gov.in/static/uploads/2026/06/41192ca92c1de34eb064800fbffa0379.pdf',
    file: 'data/raw/fdi/DPIIT_FDI_Factsheet_Mar2026.pdf',
  },
  {
    id: 'ncp-population-projections-2011-2036',
    url: 'https://nhm.gov.in/New_Updates_2018/Report_Population_Projection_2019.pdf',
    file: 'data/raw/population/Report_Population_Projection_2019.pdf',
  },
  {
    id: 'lgd-state-boundaries',
    url: 'https://github.com/ramSeraph/indian_admin_boundaries/releases/download/states/LGD_States.geojsonl.7z',
    file: 'data/raw/boundaries/LGD_States.geojsonl.7z',
  },
];

const MANUAL = [
  'DPIIT FDI factsheets: the publication list (https://www.dpiit.gov.in/fdi-publications) is client-rendered.',
  '  Open it in a browser, find the newest "Quarterly Fact Sheet", and compare its Annexure-C period with',
  '  data/raw/fdi/fdi-statewise-oct2019-mar2026.csv. A factsheet to June 2026 is reported to exist; its PDF',
  '  URL was not located when this build ran.',
  'Startups: search sansad.in for a newer full State/UT-wise "entities recognised as startups" annexure.',
  'Funding (Tracxn state reports): pages rate-limit automated requests. Re-read each URL listed in',
  '  data/raw/funding/funding-tracxn-2025.csv by hand and look for newly published state reports.',
  'After any change: update the CSV, its header comment, data/sources.json, then run `npm run data:build`.',
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const manifest = {};
let failed = 0;
for (const d of DOWNLOADS) {
  const path = resolve(ROOT, d.file);
  try {
    if (FORCE || !existsSync(path)) {
      const res = await fetch(d.url, { headers: { 'user-agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buf);
      console.log(`downloaded  ${d.file}  (${buf.length} bytes)`);
    } else {
      console.log(`present     ${d.file}`);
    }
    const buf = await readFile(path);
    manifest[d.id] = { file: d.file, url: d.url, bytes: buf.length, sha256: sha256(buf) };
  } catch (err) {
    failed++;
    console.error(`FAILED      ${d.file}  <- ${d.url}\n            ${err.message}`);
  }
}

await writeFile(resolve(ROOT, 'data/raw/SHA256.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('\nwrote data/raw/SHA256.json');
console.log('\nManual checklist:\n' + MANUAL.map((l) => '  ' + l).join('\n'));
process.exit(failed ? 1 : 0);
