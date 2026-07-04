import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * The Hub web app is a static SPA served by the gateway. `base: '/app/'` so the
 * gateway mounts it under /app and its asset URLs resolve there. In dev, requests
 * to the gateway JSON API (/v1, /account session endpoints) are proxied to the
 * local gateway on :8080.
 */
export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  server: {
    proxy: {
      '/v1': 'http://127.0.0.1:8080',
      '/account': 'http://127.0.0.1:8080',
      '/oauth': 'http://127.0.0.1:8080',
    },
  },
});
