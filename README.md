# India Innovation Density Map

A static, single-page choropleth of India's 36 states and union territories: DPIIT-recognised startups, FDI equity inflow, and (partial) tech startup funding, plus a two-metric experimental index.

**One rule above all others: no figure is invented, estimated or backfilled.** Every number traces to a row in `data/sources.json`. A state with no source figure shows "Data unavailable".

## Run it

```
npm install
npm run dev        # local dev server
npm run build      # validate data, type-check, build to dist/
npm run preview    # serve dist/
```

The site reads only `public/data/states.json`, `public/data/sources.json` and `public/data/india-states.topo.json`. `data/raw/` is not needed to build the site.

## Data pipeline

| Step | Command | What it does |
| --- | --- | --- |
| Fetch | `npm run data:fetch` | Downloads the source PDFs and the boundary archive, records SHA-256 hashes, prints the manual checklist |
| Build | `npm run data:build` | Joins the transcribed CSVs, reconciles each against the total printed in its source, writes `states.json`, then validates |
| Boundaries | `node scripts/build-boundaries.mjs` | Simplifies the LGD boundary file to TopoJSON (joined on LGD code) |
| Share card | `npm run og` | Draws `og-image.svg` from the built data and rasterises `public/og-image.png` |

The official tables are PDF-only. Each was transcribed once into a CSV under `data/raw/` with the source URL in a header comment. The build fails if a table's rows do not add up to the total its source prints, or if any state name is not in `scripts/state-name-map.json`.

### What each metric is

| Metric | Source | Period | Coverage |
| --- | --- | --- | --- |
| Startups | Lok Sabha USQ 1446, Annexure-I (DPIIT) | as on 30 Jun 2026 | 36/36 |
| FDI equity inflow | DPIIT Quarterly Fact Sheet, Annexure-C | Oct 2019 - Mar 2026 | 33/36 |
| Tech startup funding | Tracxn state reports (public pages) | publisher's 2025 | 4/36, not ranked |
| Population | NCP Technical Group projections, Table 21 | 1 Mar 2026, projected | 36/36 |

The index (`IID-2M v1.0`) is the equal-weight mean of Startups and FDI, each min-max scaled within the 33 States/UTs that report both. A state missing a component is not scored. Funding is not part of it.

## Refreshing

1. `npm run data:fetch -- --force` and work through the printed manual checklist.
2. Update the CSV, its header comment (including the stated total) and `data/sources.json`.
3. `npm run data:build`, then diff `data/states.json` before publishing. Never auto-publish changed ranks.

## Deploy (Vercel)

`vercel.json` is set up for a Vite static build. Import the repo in Vercel, or run `npx vercel --prod`. Set `SITE_URL` (e.g. `https://example.com`) if you use a custom domain, so `og:image` gets an absolute URL; otherwise Vercel's production URL is used.

The footer credit and its link live in `src/config.ts`.

## Boundaries

Boundaries come from the LGD-derived release at `ramSeraph/indian_admin_boundaries`, simplified for size only. Nothing is edited, merged or moved. Review the depiction against applicable Indian official guidance before publishing widely; the footer disclaimer does not by itself establish compliance.
