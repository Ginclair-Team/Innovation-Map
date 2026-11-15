// Dump a PDF's text, page by page, with rows reconstructed from glyph positions.
// Usage: node scripts/pdf-text.mjs <file.pdf> [firstPage] [lastPage]
// Used only for the one-off source audit; the site build never reads PDFs.
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [file, first = '1', last = '9999'] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/pdf-text.mjs <file.pdf> [firstPage] [lastPage]');
  process.exit(1);
}
const data = new Uint8Array(await readFile(file));
const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
const lo = Math.max(1, Number(first));
const hi = Math.min(doc.numPages, Number(last));
console.log(`# ${file} — ${doc.numPages} pages`);
for (let p = lo; p <= hi; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const rows = new Map();
  for (const it of tc.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const y = Math.round(it.transform[5] / 3) * 3;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: it.transform[4], s: it.str });
  }
  console.log(`\n===== page ${p} (${tc.items.length} text items) =====`);
  for (const y of [...rows.keys()].sort((a, b) => b - a)) {
    const cells = rows.get(y).sort((a, b) => a.x - b.x);
    console.log(cells.map((c) => `${c.s}`).join(' | '));
  }
}
