// @skervik/server — anonymous GUEST identity store (S1.7.1).
//
// ⚠️ NOT A SECURITY BOUNDARY IN M1. A guest id is an opaque, unauthenticated,
// in-memory handle used only for lobby/HUD display. It is NEVER the
// authoritative game identity — that stays the unspoofable Colyseus
// `sessionId` (the seat), and the anti-spoof invariant (`validate` binds
// `intent.playerId` to the seat, S1.4.2/S1.5.2) is unchanged. A client that
// forges or omits a guest id can gain NOTHING at the table. Real accounts /
// signed tokens / a DB-backed store are post-M1; the seam below (the
// `GuestStore` interface + a stable `{ guestId, displayName }` return shape)
// is what a durable impl slots into later.
import { randomUUID } from 'node:crypto';

/** An issued anonymous guest identity — display metadata only, never a `PlayerId`. */
export interface GuestIdentity {
  readonly guestId: string;
  readonly displayName: string;
}

/**
 * The guest-identity seam (S1.7.1). `issueGuest` mints an anonymous identity;
 * the in-memory M1 impl is {@link InMemoryGuestStore}, and the DB-backed
 * {@link DbGuestStore} (S2.6.2a) implements the same interface without touching
 * callers. The return type is `GuestIdentity | Promise<GuestIdentity>` (mirrors
 * the `MatchMetadataStore` sync|async precedent): the in-memory impl stays
 * synchronous, while the DB impl awaits an insert. Callers `await` it either
 * way (`await` on a plain value is a no-op).
 */
export interface GuestStore {
  issueGuest(displayName?: string): GuestIdentity | Promise<GuestIdentity>;
}

/** Longest display name we keep — anything past this is clamped (not rejected). */
export const MAX_DISPLAY_NAME_LENGTH = 24;

/**
 * Normalize a client-supplied display name to something safe to show: strip
 * Unicode control characters (`\p{Cc}` — C0/C1), trim surrounding whitespace,
 * clamp to {@link MAX_DISPLAY_NAME_LENGTH}. Returns `null` when nothing usable
 * remains (empty / whitespace / control-only), so the caller falls back to a
 * generated name. Never throws — a hostile name is sanitized, not an error.
 */
export function sanitizeDisplayName(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/\p{Cc}/gu, '').trim();
  if (stripped.length === 0) return null;
  return stripped.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

/** A generated anonymous name like `Guest-4F9C` for a client that gave no usable one. */
export function generateGuestName(): string {
  return `Guest-${randomUUID().slice(0, 4).toUpperCase()}`;
}

/**
 * In-memory guest store for M1 (a plain `Map`, nothing survives a restart).
 * `issueGuest` mints an opaque `crypto.randomUUID()` id and records the
 * sanitized (or generated) display name. See the file header: this is display
 * metadata, NOT a security boundary.
 */
export class InMemoryGuestStore implements GuestStore {
  readonly #guests = new Map<string, { displayName: string }>();

  issueGuest(displayName?: string): GuestIdentity {
    const name = sanitizeDisplayName(displayName) ?? generateGuestName();
    const guestId = randomUUID();
    this.#guests.set(guestId, { displayName: name });
    return { guestId, displayName: name };
  }

  /** Test/introspection helper — how many guests have been issued this process. */
  get size(): number {
    return this.#guests.size;
  }
}
