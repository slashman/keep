import { defineConfig } from 'vite';

// slashie.net does not send CORS headers, so a browser cannot fetch its JSON
// or use its images as WebGL textures directly. In dev we proxy everything
// under /slashie to https://slashie.net so it all becomes same-origin.
export default defineConfig({
  server: {
    proxy: {
      '/slashie': {
        target: 'https://slashie.net',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/slashie/, ''),
      },
    },
  },
});
