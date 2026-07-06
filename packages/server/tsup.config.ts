import { defineConfig } from 'tsup';

// Server is an application, not a library — no .d.ts output needed.
// `start.ts` is the real process entry (the `start` script runs `dist/start.js`);
// `index.ts` stays the library surface (factory + boot exports) tests import.
export default defineConfig({
  entry: ['src/index.ts', 'src/start.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
});
