import { defineConfig } from 'vite';

// Production is deployed at https://slashie.net/keep, so the built app's own assets
// are served under /keep/. The data + images live at the slashie.net root, which is
// same-origin in production (no CORS/proxy needed) and reached via the proxy in dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/keep/' : '/',
  server: {
    proxy: {
      // Dev only: slashie.net sends no CORS headers, so route /slashie → slashie.net
      // server-side to make its JSON and images same-origin during development.
      '/slashie': {
        target: 'https://slashie.net',
        changeOrigin: true,
        secure: true,
        // slashie.net's host guards every URL with a JS cookie-challenge: the first
        // hit returns 409 with an inline <script> that sets `humans_21909=1` and
        // reloads. A real browser passes it once and reuses the cookie, but the proxy
        // forwards image/JSON requests that never run that script — so they'd loop on
        // 409 forever. Present the solved-challenge cookie on every upstream request.
        // (Dev only; in production the site is same-origin and the browser solves it.)
        headers: { Cookie: 'humans_21909=1' },
        rewrite: (path) => path.replace(/^\/slashie/, ''),
      },
    },
  },
}));
