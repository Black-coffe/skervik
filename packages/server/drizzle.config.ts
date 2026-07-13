// @skervik/server — drizzle-kit config (S2.6.1, ADR-0012 Fork 4). Points
// drizzle-kit at the TS schema and the generated-migrations output dir; the
// SAME generated `.sql` files run against PGlite (tests) and real Postgres
// (prod) via drizzle's migrator — one migration source of truth (invariant #2).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema',
  out: './src/db/migrations',
});
