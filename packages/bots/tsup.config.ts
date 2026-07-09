import { defineConfig } from 'tsup';

// `index.ts` stays the library surface tests/the server import; `sim-cli.ts`
// is a second process entry (S2.2.5's `sim` script), the same
// `@skervik/server` `start.ts` precedent — compiled once, run via
// `node dist/sim-cli.js`.
export default defineConfig({
  entry: ['src/index.ts', 'src/sim-cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
});
