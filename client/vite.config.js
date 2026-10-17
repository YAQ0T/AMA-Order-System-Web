import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on all interfaces so you can open the dev server from a phone on the LAN.
    host: true,
    port: 5173,
    // In dev we proxy /api to the Node server, so the browser talks to one origin
    // and there is no CORS and no VITE_API_URL to set.
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:6001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // One ~500 KB bundle (150 KB gzipped) is fine for an app served on the
    // LAN, so do not warn about it on every start.
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      onwarn(warning, warn) {
        // zod ships /* @__PURE__ */ comments Rollup cannot place; harmless.
        if (warning.code === 'INVALID_ANNOTATION') return;
        warn(warning);
      },
    },
  },
});
