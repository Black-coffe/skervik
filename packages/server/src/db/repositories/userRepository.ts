// @skervik/server — `UserRepository` (S2.6.1, ADR-0012 Fork 1). The ONLY DB
// surface future callers (S2.6.2 guest/OAuth persistence, S2.6.4 GDPR
// read/delete) touch for `users` — no raw Drizzle query leaks into rooms or
// routes. `id` is minted here via `crypto.randomUUID()` (invariant #5), never
// a DB default, so PGlite and real Postgres mint identical ids.
import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import type { SkervikDb } from '../client.js';
import { type AuthProvider, users } from '../schema/index.js';

export interface CreateUserInput {
  readonly username: string;
  /** The user-chosen, NON-unique shown name (S2.6.2a). Required — always present. */
  readonly displayName: string;
  readonly email?: string;
  readonly authProvider?: AuthProvider;
  readonly isGuest?: boolean;
}

export interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly authProvider: AuthProvider | null;
  readonly isGuest: boolean;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

export class UserRepository {
  readonly #db: SkervikDb;

  constructor(db: SkervikDb) {
    this.#db = db;
  }

  async create(input: CreateUserInput): Promise<UserRow> {
    const [row] = await this.#db
      .insert(users)
      .values({
        id: randomUUID(),
        username: input.username,
        displayName: input.displayName,
        email: input.email ?? null,
        authProvider: input.authProvider ?? null,
        isGuest: input.isGuest ?? false,
      })
      .returning();
    if (row === undefined)
      throw new Error('UserRepository.create: insert returned no row');
    return row;
  }

  /**
   * Reads any user by id regardless of soft-delete state (an id lookup is
   * usually resolving a foreign key, e.g. `matches.winner_id` — a deleted
   * account may still need to display in match history).
   */
  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.#db.select().from(users).where(eq(users.id, id));
    return row ?? null;
  }

  /**
   * "Live user" read: excludes soft-deleted rows (`deleted_at IS NOT NULL`),
   * per the GDPR self-service erasure invariant (S2.6.4 consumes this filter
   * for login/lookup so an erased account can't authenticate).
   */
  async findByUsername(username: string): Promise<UserRow | null> {
    const [row] = await this.#db
      .select()
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)));
    return row ?? null;
  }
}
