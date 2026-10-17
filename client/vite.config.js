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
  },
});
