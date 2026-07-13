// @skervik/server — DURABLE guest identity backed by the `users` table
// (S2.6.2a, ADR-0012). Unlike {@link InMemoryGuestStore} (a `Map` that
// evaporates on restart), this inserts a real `users` row so the guest's
// `userId` survives reconnect + reload (resolved from a signed session token,
// see `sessionToken.ts`). Selected when `DATABASE_URL` is configured (`boot.ts`);
// the in-memory impl stays the no-DB default (Invariant 9 — no behavior change).
//
// `guestId` returned here IS the durable `users.id`. The row is `is_guest=true`,
// `auth_provider='guest'`; `display_name` is the sanitized chosen/generated
// name (NON-unique), and `username` is a generated UNIQUE slug (the handle) —
// on the astronomically-unlikely slug collision the insert is retried with a
// fresh slug. This is still NOT the in-game identity — the seat `PlayerId`
// stays the Colyseus `sessionId` (ADR-0009).
import { randomBytes } from 'node:crypto';

import type { UserRepository } from '../db/repositories/userRepository.js';
import {
  generateGuestName,
  type GuestIdentity,
  type GuestStore,
  sanitizeDisplayName,
} from './guestStore.js';

/** How many slug collisions we tolerate before giving up (each retry is ~1-in-2^48). */
const MAX_SLUG_ATTEMPTS = 5;

/** A fresh unique-handle candidate like `guest_a1b2c3d4e5f6`. */
function generateGuestSlug(): string {
  return `guest_${randomBytes(6).toString('hex')}`;
}

export class DbGuestStore implements GuestStore {
  readonly #users: UserRepository;

  constructor(users: UserRepository) {
    this.#users = users;
  }

  /**
   * Insert a durable guest `users` row and return `{ guestId: users.id,
   * displayName }`. The display name is sanitized (or generated when none is
   * usable), the same helpers {@link InMemoryGuestStore} uses. Retries on the
   * rare unique-slug collision; a persistent insert failure (e.g. DB down)
   * propagates — a durable store must not silently hand back a non-durable id.
   */
  async issueGuest(displayName?: string): Promise<GuestIdentity> {
    const name = sanitizeDisplayName(displayName) ?? generateGuestName();
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      try {
        const row = await this.#users.create({
          username: generateGuestSlug(),
          displayName: name,
          authProvider: 'guest',
          isGuest: true,
        });
        return { guestId: row.id, displayName: row.displayName };
      } catch (error) {
        // Retry only helps a UNIQUE(username) collision; other failures recur,
        // but the loop is tiny so we just re-throw the last one after the cap.
        lastError = error;
      }
    }
    throw new Error(
      `DbGuestStore.issueGuest: failed to insert a guest after ${MAX_SLUG_ATTEMPTS} attempts`,
      { cause: lastError },
    );
  }
}
