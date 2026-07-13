// @skervik/server — AC1 (S2.6.1): a fresh PGlite instance + `runMigrations`
// (the REAL generated files, not hand-built DDL) creates all three tables.
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createPgliteDb } from './client.js';
import { runMigrations } from './migrate.js';

describe('runMigrations', () => {
  let client: PGlite | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it('creates users, matches, and match_players against a fresh PGlite instance', async () => {
    client = new PGlite();
    const db = createPgliteDb(client);

    await runMigrations(db);

    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tableNames = result.rows.map((row) => row.table_name);
    expect(tableNames).toEqual(['match_players', 'matches', 'users']);
  });
});
