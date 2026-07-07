// @skervik/core — deterministic Classic development-card deck (S1.2.3).
//
// Mirrors `boardgen.ts`'s approach: the deck is shuffled once from the
// match seed, from a FIXED reserved stream-index band (not
// `state.eventIndex`) — `shuffledDevDeck` is a pure, idempotent function of
// `seed` alone, so `validate.ts`'s buy branch can recompute "the Nth drawn
// card" on demand from `(seed, N)` without ever storing the full deck order
// in `GameState`. Storing the order would let anyone holding the serialized
// state predict every future draw before it happens — the same reasoning
// that keeps the raw `seed` itself out of `GameState`
// (`docs/wiki/fair-rng-commit-reveal.md`). Only a remaining-count travels on
// state (`GameState.devDeckRemaining`).

import { type Seed, shuffle } from './rng.js';
import { CLASSIC_PROFILE, type DevCardProfile } from './ruleProfile.js';
import type { DevCardHoldings, DevCardKind } from './types.js';

/**
 * Back-compat alias for the Classic dev-card sub-profile — the single source of
 * truth now lives on {@link CLASSIC_PROFILE} (`ruleProfile.ts`, S2.1.1); this
 * re-derives it so existing importers (`devcards.test.ts`, `verify.ts`,
 * `validate.ts`, `@skervik/core` re-export) keep working with byte-identical
 * values. 25 cards: 14 knight, 2 road-building, 2 year-of-plenty, 2 monopoly,
 * 5 victory-point (Classic spec).
 */
export const CLASSIC_DEV_CARD_PROFILE: DevCardProfile = CLASSIC_PROFILE.devCards;

/**
 * Reserved RNG stream-index band for the dev-card deck shuffle (S1.2.3,
 * `docs/wiki/rng-stream-map.md` §2.5) — a ONE-TIME shuffle at game start,
 * same "reserved band, not `eventIndex`" reasoning as `BOARD_GEN_STREAM`
 * (`boardgen.ts`). Placed well clear of board-gen's own worst-case ceiling
 * (`TOKEN_SHUFFLE_BASE + (TOKEN_RETRY_BOUND-1)*TOKEN_SHUFFLE_STRIDE + 16 =
 * 1_007_316`, see `boardgen.ts`) so the two reserved bands never overlap.
 * The 25-item shuffle consumes `SHUFFLE .. SHUFFLE + 23`.
 */
export const DEV_DECK_STREAM = {
  SHUFFLE: 1_010_000,
} as const;

/**
 * The deterministic shuffle order of a dev-card deck for `seed` — pure,
 * callable any number of times. `validate.ts`'s buy branch calls it once per
 * buy and indexes into the result; the 25-item Fisher-Yates is cheap enough
 * that re-deriving it per call is simpler and safer than caching a mutable
 * module-level shuffle (ADR-0003: no ambient mutable state). `deck` is the
 * deck to shuffle; it defaults to Classic (`CLASSIC_PROFILE.devCards.deck`) so
 * every existing caller stays byte-identical, and the engine passes the
 * resolved profile's deck for other modes (S2.1.1).
 */
export function shuffledDevDeck(
  seed: Seed,
  deck: readonly DevCardKind[] = CLASSIC_PROFILE.devCards.deck,
): readonly DevCardKind[] {
  return shuffle(deck, seed, DEV_DECK_STREAM.SHUFFLE);
}

/**
 * The "public projection" of one player's dev-card holdings (S1.2.3): the
 * single total count another player's client is allowed to see — never the
 * per-kind breakdown, which stays visible only to the holder's own client.
 * `GameState.devCards` itself carries the full identity-bearing breakdown
 * (server-authoritative, like every other field), the same shared-state
 * shape `PlayerState.resources` already uses today; a future per-viewer
 * redaction layer (server package, not yet built) calls this for every
 * OTHER player's entry when assembling one client's view — the holder's own
 * entry is sent unredacted.
 */
export function publicDevCardCount(holdings: DevCardHoldings): number {
  return Object.values(holdings.held).reduce<number>(
    (sum, count) => sum + (count ?? 0),
    0,
  );
}
