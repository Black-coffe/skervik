// @skervik/server — the ONLY way migrations run (S2.6.1, ADR-0012 Fork 4 /
// invariant #4: no auto-migrate on server boot). `runMigrations` wraps
// drizzle's migrator, dispatched by driver so the SAME generated `.sql` set
// (invariant #2) applies to a PGlite instance (tests, Fork 5) or a real
// Postgres pool (prod, via the `migrate` npm script below). The CLI is the
// ONLY `DATABASE_URL` reader in this story — `boot.ts` does not read it
// (invariant #9).
import { fileURLToPath } from 'node:url';

import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';

import { createPgDb, type SkervikDb } from './client.js';

/**
 * Migrations folder, resolved relative to THIS file (not `process.cwd()`) so
 * it works identically from `src/` (tests, via vitest) and from `dist/` (the
 * built `migrate` script) — `dist/db/migrate.js` sits at the same depth as
 * `src/db/migrate.ts`, so `../migrations` resolves correctly from either.
 */
const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

/**
 * Applies every pending migration in `migrationsFolder` to `db`, dispatching
 * to the driver-appropriate migrator (`node-postgres` vs `pglite`) by
 * checking which one is live. Idempotent — already-applied migrations are
 * skipped (drizzle tracks them in its own `__drizzle_migrations` table).
 */
export async function runMigrations(
  db: SkervikDb,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  // `SkervikDb` is a union of the two driver-specific database classes;
  // `instanceof` dispatches to the matching migrator without importing both
  // `$client` shapes into this signature.
  if (db instanceof PgliteDatabase) {
    await migratePglite(db, { migrationsFolder });
  } else {
    await migratePg(db, { migrationsFolder });
  }
}

/**
 * The `migrate` npm script entry: read `DATABASE_URL`, connect to real
 * Postgres, run every pending migration, exit. Never invoked by `boot.ts`.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is not set — the migrate script needs it to connect.');
  }
  const db = createPgDb(databaseUrl);
  await runMigrations(db);
  console.log('[skervik/server] migrations applied.');
}

// Only run when executed directly (`node dist/db/migrate.js`), not when
// imported by a test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error('[skervik/server] migration failed:', error);
    process.exitCode = 1;
  });
}
