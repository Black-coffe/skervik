// S2.2.5 diagnostics — lengthSplit unit coverage against a hand-built
// ProfileSweepResult fixture (no simulateMatch needed — this is a pure fold
// over turnsBySeed/comebackBySeed).
import { describe, expect, it } from 'vitest';

import { splitByMedianTurns } from './lengthSplit.js';
import type { ProfileSweepResult } from './sweep.js';

function fixture(
  turnsBySeed: ReadonlyArray<number | null>,
  comebackBySeed: ReadonlyArray<boolean | null>,
): ProfileSweepResult {
  return {
    id: 'fixture',
    label: 'fixture',
    isolates: 'test fixture',
    n: turnsBySeed.length,
    completed: turnsBySeed.filter((t) => t !== null).length,
    stalledSeeds: [],
    medianTurns: 0,
    p90Turns: 0,
    maxTurns: 0,
    comebackRate: 0,
    comebackRateCI: { point: 0, low: 0, high: 0 },
    meanFinalVpGap: 0,
    seatWinRate: [0, 0, 0, 0],
    eventTilesInterval: 3,
    comebackBySeed,
    turnsBySeed,
    povertyTokensGrantedEvents: 0,
    povertyTokensGrantedTotal: 0,
    povertyDiscountTrades: 0,
    povertyTokensAtEndHistogram: {},
  };
}

describe('splitByMedianTurns', () => {
  it('splits at the median, comeback-only in the shorter half -> shorter rate 1, longer rate 0', () => {
    // turns: 10,20,30,40 (median 25) with comebacks only on the two <=25 (10,20).
    const result = fixture([10, 20, 30, 40], [true, true, false, false]);
    const split = splitByMedianTurns(result);
    expect(split.n).toBe(4);
    expect(split.medianTurns).toBe(25);
    expect(split.shorterN).toBe(2);
    expect(split.shorterComebackRate).toBe(1);
    expect(split.longerN).toBe(2);
    expect(split.longerComebackRate).toBe(0);
  });

  it('excludes stalled seeds (null on either array) from the split entirely', () => {
    const result = fixture([10, null, 30, 40], [true, null, false, true]);
    const split = splitByMedianTurns(result);
    expect(split.n).toBe(3); // the null-turns seed is dropped
  });

  it('an empty (all-stalled) profile returns a degenerate zero split without crashing', () => {
    const result = fixture([null, null], [null, null]);
    const split = splitByMedianTurns(result);
    expect(split.n).toBe(0);
    expect(split.shorterN + split.longerN).toBe(0);
  });
});
