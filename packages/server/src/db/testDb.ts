// @skervik/server — test-only helper (S2.6.1, ADR-0012 Fork 5): spins a fresh
// in-memory PGlite instance, runs the REAL generated migrations against it,
// and returns a typed `db` — the "fresh PGlite per suite" pattern every
// repository test in this directory shares. NOT part of the DB public
// surface; imported only by `*.test.ts` files.
import { PGlite } from '@electric-sql/pglite';

import { createPgliteDb, type SkervikDb } from './client.js';
import { runMigrations } from './migrate.js';

export interface TestDb {
  readonly db: SkervikDb;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = createPgliteDb(client);
  await runMigrations(db);
  return { db, close: () => client.close() };
}
