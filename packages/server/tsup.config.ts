import { defineConfig } from 'tsup';

// Server is an application, not a library — no .d.ts output needed.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
});
