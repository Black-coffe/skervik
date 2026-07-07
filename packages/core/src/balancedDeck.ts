// @skervik/core — the balanced-deck randomness source (S2.1.2).
//
// Activates `RuleProfile.randomness: 'balanced_deck'` — the game's first
// alternative to independent 2d6 dice, turning the LOCKED product intent
// ("swingy dice RNG… explicitly designed out", CLAUDE.md) into a real draw.
//
// The load-bearing design decision: the balanced deck is literally the 36
// equiprobable 2d6 OUTCOME PAIRS — `[1,1],[1,2],…,[6,6]` — drawn WITHOUT
// replacement, NOT a synthesized sum. Each drawn card carries a genuine
// `(dieA, dieB)`, so the `dice.rolled` event shape stays byte-identical and
// every downstream consumer (`reduce`, production, robber-on-7, the client's
// two-dice render) needs zero change — only the SOURCE of the pair changes
// from independent rolls to a without-replacement draw. Over each 36-card
// cycle every sum appears exactly its natural count (7 six times, 2 and 12
// once each, …): the 2d6 distribution in expectation, but with the variance
// smoothed — no cold streak of no-7s, no hot streak of one number.
//
// Commit-reveal integrity (CLAUDE.md principle 5, same discipline as
// `devcards.ts`): the shuffled deck ORDER is NEVER stored in `GameState` —
// only a cumulative draw count travels (`GameState.balancedRollsDrawn`), and
// `drawBalancedRoll` re-derives the Nth draw from `(seed, N)` on demand.
// Storing the order would let a serialized state predict every future roll,
// the same reasoning that keeps the raw `seed` out of `GameState`. The
// verifier (`verify.ts`) recomputes every draw from the revealed seed + its
// own roll counter, so a dishonest server can neither hide nor forge a roll.
//
// Zero runtime deps (ADR-0003): pure data + pure functions over the existing
// seeded `shuffle` (`rng.ts`).

import { type Seed, shuffle } from './rng.js';

/**
 * The 36 ordered 2d6 outcome pairs `(a, b)` for `a, b ∈ 1..6` — the balanced
 * deck's undrawn contents. Its sum-histogram EQUALS the 2d6 histogram
 * (`{2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1}`) by construction: this
 * IS the fairness contract (asserted in `balancedDeck.test.ts`). Order here is
 * irrelevant to fairness — `shuffledRollDeck` permutes it per cycle — but is
 * fixed and canonical so the deck is a stable, testable constant.
 */
export const BALANCED_ROLL_DECK: readonly (readonly [number, number])[] =
  ((): readonly (readonly [number, number])[] => {
    const deck: (readonly [number, number])[] = [];
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        deck.push([a, b]);
      }
    }
    return deck;
  })();

/**
 * Reserved RNG stream-index band for the balanced roll-deck shuffles (S2.1.2,
 * `docs/wiki/rng-stream-map.md`). Each 36-roll cycle gets its OWN permutation,
 * keyed to its `round` so the deck reshuffles differently every time it is
 * exhausted (else every cycle would repeat and become predictable). Placed
 * well clear of the other reserved bands so they can never overlap:
 * - gameplay per-event stream: `< 1_000_000` (`rng.ts` ceiling guard).
 * - board-gen band: `1_000_000 .. ~1_007_316` worst case (`boardgen.ts`).
 * - dev-deck shuffle: `1_010_000 .. 1_010_023` (`devcards.ts`).
 * A 36-item Fisher-Yates consumes 35 stream slots (`streamIndex ..
 * streamIndex + 34`), so with `SHUFFLE_STRIDE = 1000` per round the rounds
 * never collide and there is ample headroom.
 */
export const ROLL_DECK_STREAM = {
  /** Stream index where round 0's shuffle begins. */
  SHUFFLE_BASE: 1_020_000,
  /** Per-reshuffle-round stride (≥ 35 slots consumed per round, generous margin). */
  SHUFFLE_STRIDE: 1000,
} as const;

/**
 * The deterministic shuffle order of the balanced roll deck for `(seed,
 * round)` — pure, callable any number of times, a fresh permutation per
 * `round`. `drawBalancedRoll` indexes into the result; re-deriving the
 * 36-item Fisher-Yates per call is cheap and keeps the order out of any
 * mutable module state (ADR-0003), the same shape as `shuffledDevDeck`.
 */
export function shuffledRollDeck(
  seed: Seed,
  round: number,
): readonly (readonly [number, number])[] {
  return shuffle(
    BALANCED_ROLL_DECK,
    seed,
    ROLL_DECK_STREAM.SHUFFLE_BASE + round * ROLL_DECK_STREAM.SHUFFLE_STRIDE,
  );
}

/**
 * Draws the `drawCount`-th balanced roll (0-based: `drawCount` is the number
 * of balanced rolls ALREADY drawn) from `seed`. Reshuffle is pure modular
 * arithmetic on the cumulative count — `round = floor(drawCount / 36)`,
 * `pos = drawCount % 36` — so there is no mid-cycle reset to get wrong. Yields
 * a genuine `(dieA, dieB, total)`, so the emitted `dice.rolled` is identical
 * in shape to a 2d6 roll. Pure/deterministic: same `(seed, drawCount)` in →
 * identical draw out, on any machine.
 */
export function drawBalancedRoll(
  seed: Seed,
  drawCount: number,
): { dieA: number; dieB: number; total: number } {
  const round = Math.floor(drawCount / 36);
  const pos = drawCount % 36;
  const pair = shuffledRollDeck(seed, round)[pos] as readonly [number, number];
  const [dieA, dieB] = pair;
  return { dieA, dieB, total: dieA + dieB };
}
