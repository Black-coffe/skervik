import { cp } from 'node:fs/promises';

import { defineConfig } from 'tsup';

// Server is an application, not a library — no .d.ts output needed.
// `start.ts` is the real process entry (the `start` script runs `dist/start.js`);
// `index.ts` stays the library surface (factory + boot exports) tests import.
// `db/migrate` is the `migrate` npm script's entry (S2.6.1) — object-form entry
// keeps it at `dist/db/migrate.js` so `migrate.ts`'s own migrations-folder
// resolution (relative to itself) still lines up after the build. tsup only
// bundles JS, so `onSuccess` copies the generated `.sql`/`_journal.json`
// migration files (not importable, read from disk by the migrator) alongside it.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    start: 'src/start.ts',
    'db/migrate': 'src/db/migrate.ts',
  },
  format: ['esm'],
  dts: false,
  clean: true,
  onSuccess: async () => {
    await cp('src/db/migrations', 'dist/db/migrations', { recursive: true });
  },
});
