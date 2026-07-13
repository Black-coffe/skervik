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

/**
 * The neutral display name a soft-deleted account is scrubbed to (S2.6.4 GDPR
 * erasure) — `display_name` PII is replaced by this constant so a retained
 * `match_players` row no longer identifies the person, while match integrity
 * (the row itself, other seats, the winner) stays intact.
 */
export const TOMBSTONE_DISPLAY_NAME = '[deleted]';

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

  /**
   * "Live user" read by id: the {@link findByUsername} soft-delete filter, keyed
   * by the primary key. GDPR self-service (S2.6.4) resolves the caller's own
   * `userId` (from their session token) to a row through this, so a post-erasure
   * token — its `userId` now `deleted_at IS NOT NULL` — resolves to `null` and is
   * treated as unauthenticated (no bespoke token-revocation infra; the soft-delete
   * filter IS the mechanism). Distinct from {@link findById}, which deliberately
   * ignores soft-delete for foreign-key display (e.g. a match's `winner_id`).
   */
  async findLiveById(id: string): Promise<UserRow | null> {
    const [row] = await this.#db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    return row ?? null;
  }

  /**
   * GDPR right-to-erasure (S2.6.4): soft-delete + anonymize the account —
   * `deleted_at = now()`, scrub `display_name` to {@link TOMBSTONE_DISPLAY_NAME},
   * `email = null`. NEVER a cascade-delete: the user's `match_players` rows and
   * the matches they played are RETAINED (audit trail / other players' history),
   * now pointing at a PII-free tombstone. Idempotent: the write is gated on
   * `deleted_at IS NULL`, so a second call updates nothing and returns the
   * already-tombstoned row (a non-existent id returns `null`).
   */
  async softDeleteAndAnonymize(userId: string): Promise<UserRow | null> {
    const [updated] = await this.#db
      .update(users)
      .set({ deletedAt: new Date(), displayName: TOMBSTONE_DISPLAY_NAME, email: null })
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .returning();
    // A row here means we just tombstoned it; otherwise it was already deleted
    // (or never existed) — return the current tombstone (or null) unchanged.
    return updated ?? this.findById(userId);
  }
}
