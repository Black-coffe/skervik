// @skervik/server — the DB connection factory (S2.6.1, ADR-0012 Fork 1/4).
// Two driver paths, ONE typed shape over the schema barrel: `createPgDb` (real
// Postgres, `node-postgres`) for prod/the migrate CLI, `createPgliteDb`
// (in-process WASM Postgres) for hermetic tests. Repositories are constructed
// with whichever `db` they're handed, so they never know which driver is
// live (invariant #1/#2 — same schema, same generated migrations, either
// driver).
import type { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { Pool } from 'pg';

import * as schema from './schema/index.js';

/** The typed `db` shape repositories depend on, regardless of driver. */
export type SkervikDb = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

/** Real Postgres, for prod boot and the `migrate` CLI (Invariant 9: not called from `boot.ts` yet). */
export function createPgDb(databaseUrl: string): NodePgDatabase<typeof schema> {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzlePg(pool, { schema });
}

/**
 * In-process WASM Postgres, for hermetic tests (ADR-0012 Fork 5). Accepts an
 * existing {@link PGlite} instance (a test can hold onto it to close it), or
 * mints a fresh in-memory one.
 */
export function createPgliteDb(client?: PGlite): PgliteDatabase<typeof schema> {
  return client !== undefined
    ? drizzlePglite(client, { schema })
    : drizzlePglite({ schema });
}
