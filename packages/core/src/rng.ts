// @skervik/core — seeded PRNG + stream-index derivation (S0.5.3).
//
// This is the math foundation of the commit-reveal fair RNG
// (`docs/wiki/fair-rng-commit-reveal.md`): every random event in a match
// (dice, deck shuffle, ...) is derived from `seed + rngStreamIndex`, never
// drawn from a stateful generator. `seedHash = SHA256(seed)` (the commit
// step) is a server concern (M1 S1.4.3) — core only consumes the raw
// `seed` and stays crypto-free/isomorphic (ADR-0003).
//
// In-house implementation (no runtime dep): mulberry32 used in *counter*
// mode rather than chained-generator mode — each draw mixes the seed and
// the stream index into a fresh 32-bit state and runs a single mulberry32
// scramble round on it. This is what makes `deriveValue` independent of
// call order: there is no shared mutable generator state between calls.

/** The raw PRNG seed (revealed at match end, never before — see the wiki doc above). */
export type Seed = string;

/**
 * FNV-1a 32-bit hash of a string seed into an unsigned integer. Used only
 * to fold an arbitrary-length seed string into mulberry32's 32-bit state
 * space; not a cryptographic hash (that's the server's `seedHash`, M1).
 */
function hashSeed(seed: Seed): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Mixes a hashed seed and a stream index into a single 32-bit state.
 * `streamIndex` is scaled by a Weyl-sequence-style odd constant first so
 * consecutive indices (0, 1, 2, ...) land far apart in mulberry32's state
 * space, avoiding visibly correlated outputs between adjacent draws.
 */
function combine(seedHash: number, streamIndex: number): number {
  return (seedHash ^ Math.imul(streamIndex >>> 0, 0x9e3779b9)) >>> 0;
}

/**
 * A single mulberry32 scramble round, applied to an already-combined
 * 32-bit state (not advanced internally — the caller supplies a fresh
 * state per draw via {@link combine}). Returns a float in `[0, 1)`.
 */
function mulberry32Round(state: number): number {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Derives a single deterministic value in `[0, 1)` from a `seed` and a
 * `streamIndex` (typically `GameState.eventIndex` — see
 * `docs/wiki/fair-rng-commit-reveal.md`). Pure indexing into the stream,
 * not a stateful draw: `deriveValue(seed, 5)` is identical whether or not
 * `deriveValue(seed, 0..4)` was ever called, and identical across runs and
 * machines for the same `(seed, streamIndex)` pair.
 */
export function deriveValue(seed: Seed, streamIndex: number): number {
  return mulberry32Round(combine(hashSeed(seed), streamIndex));
}

/**
 * Rolls a single six-sided die deterministically from `(seed,
 * streamIndex)`. Returns an integer `1..6` (no float drift in game logic).
 */
export function rollDie(seed: Seed, streamIndex: number): number {
  return 1 + Math.floor(deriveValue(seed, streamIndex) * 6);
}

/**
 * Number of gameplay RNG stream slots reserved per event (S1.2.1 scheme,
 * `docs/wiki/rng-stream-map.md` §1): `validate.ts` owns the actual per-event
 * slot map (which slot means "die A", etc. — parallel to `boardgen.ts`
 * owning `BOARD_GEN_STREAM`); this constant only fixes the stride `K`.
 */
export const GAMEPLAY_STREAM_SLOTS = 8;

/** Where `BOARD_GEN_STREAM` starts reserving indices (`boardgen.ts`). Duplicated as a literal (not imported) to avoid a `rng.ts` -> `boardgen.ts` dependency cycle — `boardgen.ts` already imports `shuffle` from here. */
const GAMEPLAY_STREAM_CEILING = 1_000_000;

/**
 * Derives the gameplay RNG stream index for one draw within event
 * `eventIndex`: `eventIndex * GAMEPLAY_STREAM_SLOTS + slot`. Throws if the
 * result would ever reach `boardgen.ts`'s reserved band — a headroom guard,
 * not an expected rejection (unlike `validate`'s `RejectReason`s): with
 * `GAMEPLAY_STREAM_SLOTS = 8` this can only trip at `eventIndex >= 125_000`,
 * unreachable in any real Classic match (`docs/wiki/rng-stream-map.md` §1).
 */
export function gameplayStreamIndex(eventIndex: number, slot: number): number {
  if (
    eventIndex * GAMEPLAY_STREAM_SLOTS + GAMEPLAY_STREAM_SLOTS >
    GAMEPLAY_STREAM_CEILING
  ) {
    throw new Error(
      `gameplay RNG stream headroom exceeded at eventIndex=${eventIndex} — would collide ` +
        'with the board-gen reserved band (docs/wiki/rng-stream-map.md)',
    );
  }
  return eventIndex * GAMEPLAY_STREAM_SLOTS + slot;
}

/**
 * Deterministic Fisher-Yates shuffle of `items`, driven by `deriveValue`
 * draws starting at `streamIndex` (one stream slot consumed per swap, so
 * an `n`-item shuffle consumes slots `streamIndex .. streamIndex + n - 2`).
 * Returns a new array; never mutates `items` (ADR-0003).
 */
export function shuffle<T>(items: readonly T[], seed: Seed, streamIndex: number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const drawIndex = streamIndex + (result.length - 1 - i);
    const j = Math.floor(deriveValue(seed, drawIndex) * (i + 1));
    const swap = result[i] as T;
    result[i] = result[j] as T;
    result[j] = swap;
  }
  return result;
}
