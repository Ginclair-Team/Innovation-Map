import { defineConfig } from 'vite';

// Absolute URLs are needed for og:image. Set SITE_URL, or let Vercel's production URL fill it in.
const site = (
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
).replace(/\/$/, '');

export default defineConfig({
  build: { target: 'es2020', sourcemap: false },
  plugins: [
    {
      name: 'site-url',
      transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', site),
    },
  ],
});
