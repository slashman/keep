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
        rewrite: (path) => path.replace(/^\/slashie/, ''),
      },
    },
  },
}));
