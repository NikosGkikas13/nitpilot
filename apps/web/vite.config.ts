import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** Where `npm run dev -w apps/server` listens. Vite forwards the server's paths there, so the browser sees one origin. */
const SERVER = 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  build: {
    // Never inline files as data: URLs: the server's Content-Security-Policy only allows our own files
    // (apps/server/src/http/spa.ts), so an inlined font would be blocked.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': SERVER,
      '/auth': SERVER,
      '/github': SERVER,
      '/ws': { target: SERVER, ws: true },
      // Still rendered by the server: the transcript until Task 10, device approval until Task 23.
      '/c/': SERVER,
      '/cli/': SERVER,
    },
  },
  test: {
    environment: 'jsdom',
    // Only the unit tests: e2e/*.spec.ts are Playwright's (npm run test:e2e).
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
