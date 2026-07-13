// @skervik/server — `users` table (S2.6.1, ADR-0012 Fork 2). Durable account
// row for both guests and OAuth-authenticated players; `id` is APP-generated
// (invariant #5 — `crypto.randomUUID()` in the repository, never a DB
// default), so the same id is minted identically over PGlite and real
// Postgres. `deleted_at` is a soft-delete for GDPR self-service erasure
// (S2.6.4); repositories filter it out of "live user" reads.
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * How the account authenticated. App-validated `text` (invariant #8, NOT a
 * Postgres `enum` — altering an enum fights the append-only migration
 * invariant). `'guest'` covers the M1/M2 guest-auth path; OAuth providers land
 * as S2.6.2 wires real login.
 */
export type AuthProvider = 'google' | 'discord' | 'guest';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').unique(),
  authProvider: text('auth_provider').$type<AuthProvider>(),
  isGuest: boolean('is_guest').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
