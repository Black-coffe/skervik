// @skervik/core — S2.1.2 balanced-deck primitive tests. Proves the deck IS the
// 2d6 distribution (the fairness contract), that a full 36-draw cycle yields
// each sum its exact natural count (variance-smoothing = the product goal),
// that `drawBalancedRoll` is deterministic, and that each reshuffle round is a
// distinct permutation. A separate determinism test (below) proves a Balanced
// match folds twice byte-identically.

import { describe, expect, it } from 'vitest';

import {
  BALANCED_ROLL_DECK,
  drawBalancedRoll,
  ROLL_DECK_STREAM,
  shuffledRollDeck,
} from './balancedDeck.js';
import { reduce } from './reduce.js';
import type { Seed } from './rng.js';
import type {
  DiceRolledEvent,
  GameEvent,
  GameState,
  MatchStartedEvent,
} from './types.js';

const SEED: Seed = 'skervik-s2.1.2-balanced-deck-seed';

/** The exact 2d6 sum histogram — the fairness contract the deck must reproduce. */
const TWO_D6_HISTOGRAM: Readonly<Record<number, number>> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};

function sumHistogram(
  pairs: readonly (readonly [number, number])[],
): Record<number, number> {
  const hist: Record<number, number> = {};
  for (const [a, b] of pairs) {
    hist[a + b] = (hist[a + b] ?? 0) + 1;
  }
  return hist;
}

describe('BALANCED_ROLL_DECK — the 36 2d6 outcome pairs', () => {
  it('is exactly 36 ordered (dieA,dieB) pairs for a,b in 1..6', () => {
    expect(BALANCED_ROLL_DECK).toHaveLength(36);
    for (const [a, b] of BALANCED_ROLL_DECK) {
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(6);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(6);
    }
    // Every distinct (a,b) appears exactly once.
    const keys = new Set(BALANCED_ROLL_DECK.map(([a, b]) => `${a},${b}`));
    expect(keys.size).toBe(36);
  });

  it('has a sum-histogram equal to the 2d6 histogram (the fairness contract)', () => {
    expect(sumHistogram(BALANCED_ROLL_DECK)).toEqual(TWO_D6_HISTOGRAM);
  });
});

describe('drawBalancedRoll — without-replacement draw over a seed-shuffled cycle', () => {
  it('is deterministic: same (seed, drawCount) yields the identical draw', () => {
    for (let n = 0; n < 40; n++) {
      expect(drawBalancedRoll(SEED, n)).toEqual(drawBalancedRoll(SEED, n));
    }
  });

  it('yields a genuine (dieA,dieB,total) with total === dieA + dieB', () => {
    for (let n = 0; n < 72; n++) {
      const { dieA, dieB, total } = drawBalancedRoll(SEED, n);
      expect(dieA).toBeGreaterThanOrEqual(1);
      expect(dieA).toBeLessThanOrEqual(6);
      expect(dieB).toBeGreaterThanOrEqual(1);
      expect(dieB).toBeLessThanOrEqual(6);
      expect(total).toBe(dieA + dieB);
    }
  });

  it('produces each sum its EXACT natural count over a full 36-draw cycle', () => {
    // A single round is a permutation of the 36 pairs, so its sums are the deck
    // histogram exactly — no cold streak of no-7s, no hot streak (product goal).
    const cycle: [number, number][] = [];
    for (let n = 0; n < 36; n++) {
      const { dieA, dieB } = drawBalancedRoll(SEED, n);
      cycle.push([dieA, dieB]);
    }
    expect(sumHistogram(cycle)).toEqual(TWO_D6_HISTOGRAM);
    // And the 36 drawn pairs are a genuine permutation (each pair once).
    expect(new Set(cycle.map(([a, b]) => `${a},${b}`)).size).toBe(36);
  });

  it('reshuffles into a DIFFERENT permutation on the next round', () => {
    const round0 = shuffledRollDeck(SEED, 0);
    const round1 = shuffledRollDeck(SEED, 1);
    // Same multiset (both are the 36 pairs) but a different order.
    expect(new Set(round0.map(([a, b]) => `${a},${b}`))).toEqual(
      new Set(round1.map(([a, b]) => `${a},${b}`)),
    );
    const identical = round0.every(
      ([a, b], i) => a === round1[i]![0] && b === round1[i]![1],
    );
    expect(identical).toBe(false);
    // drawBalancedRoll crosses the cycle boundary via round = floor(n/36).
    expect(drawBalancedRoll(SEED, 36)).toEqual({
      dieA: round1[0]![0],
      dieB: round1[0]![1],
      total: round1[0]![0] + round1[0]![1],
    });
  });

  it('reserves a stream band clear of the dev-deck and board-gen bands', () => {
    // Dev deck = 1_010_000..1_010_023; board gen worst case ≈ 1_007_316.
    expect(ROLL_DECK_STREAM.SHUFFLE_BASE).toBeGreaterThan(1_010_100);
    // Each 36-item shuffle consumes 35 slots; stride must clear that per round.
    expect(ROLL_DECK_STREAM.SHUFFLE_STRIDE).toBeGreaterThanOrEqual(35);
  });
});

describe('a Balanced match folds twice byte-identically (determinism)', () => {
  it('replay is a pure function of the log — two folds match exactly', () => {
    const GENESIS: GameState = {
      matchId: '',
      phase: 'lobby',
      turn: 0,
      currentPlayerId: '',
      players: [],
      eventIndex: 0,
      seedHash: '',
    };
    const matchStarted: MatchStartedEvent = {
      type: 'match.started',
      index: 0,
      matchId: 'balanced-determinism',
      seedHash: 'opaque',
      playerIds: ['a', 'b'],
      profileId: 'balanced',
    };
    const events: GameEvent[] = [matchStarted];
    // Chain several honest balanced rolls (contiguous indices from 1).
    for (let k = 0; k < 8; k++) {
      const { dieA, dieB, total } = drawBalancedRoll(SEED, k);
      const dice: DiceRolledEvent = {
        type: 'dice.rolled',
        index: k + 1,
        playerId: 'a',
        dieA,
        dieB,
        total,
        ...(total === 7 ? { playersToDiscard: [] } : {}),
      };
      events.push(dice);
    }

    const foldOnce = events.reduce(reduce, GENESIS);
    const foldTwice = events.reduce(reduce, GENESIS);
    expect(JSON.stringify(foldTwice)).toBe(JSON.stringify(foldOnce));
    // The counter advanced once per balanced roll.
    expect(foldOnce.balancedRollsDrawn).toBe(8);
  });
});
