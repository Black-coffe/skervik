// S2.2.5 diagnostics — sanity checks for the statistical helpers against
// known reference values, so the McNemar p-value / Wilson CI in the story
// file's diagnostics can be trusted without re-deriving them by hand.
// S2.2.5a adds the FORCING tests for the corrected comeback metric.
import type { PlayerId } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import {
  anchorThresholds,
  chiSquarePValue1df,
  lastPlacePlayers,
  normalCdf,
  soleLastPlacePlayer,
  trailingPlayers,
  wilsonInterval,
} from './metrics.js';

const PLAYERS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4'];

function vpMap(...points: readonly number[]): ReadonlyMap<PlayerId, number> {
  return new Map(PLAYERS.map((id, i) => [id, points[i] ?? 0]));
}

describe('normalCdf', () => {
  it('is 0.5 at z=0', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });

  it('matches the standard 1.96 / 0.975 two-sided-95% reference point', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });

  it('is antisymmetric around 0.5', () => {
    expect(normalCdf(-1.5) + normalCdf(1.5)).toBeCloseTo(1, 6);
  });
});

describe('chiSquarePValue1df', () => {
  it('is 1 at chiSquare=0 (no evidence against the null)', () => {
    expect(chiSquarePValue1df(0)).toBe(1);
  });

  it('matches the standard p=0.05 <-> chiSquare=3.841 threshold (1 df)', () => {
    expect(chiSquarePValue1df(3.841)).toBeCloseTo(0.05, 2);
  });

  it('matches the standard p=0.01 <-> chiSquare=6.635 threshold (1 df)', () => {
    expect(chiSquarePValue1df(6.635)).toBeCloseTo(0.01, 2);
  });
});

describe('wilsonInterval', () => {
  it('centers on the point estimate at p=0.5 and stays symmetric', () => {
    const ci = wilsonInterval(50, 100);
    expect(ci.point).toBeCloseTo(0.5, 6);
    expect(ci.high - ci.point).toBeCloseTo(ci.point - ci.low, 6);
  });

  it('stays within [0,1] even at the extremes', () => {
    const ci = wilsonInterval(0, 100);
    expect(ci.low).toBeGreaterThanOrEqual(0);
    expect(ci.high).toBeLessThanOrEqual(1);
    const ciFull = wilsonInterval(100, 100);
    expect(ciFull.low).toBeGreaterThanOrEqual(0);
    expect(ciFull.high).toBeLessThanOrEqual(1);
  });

  it('n=0 is a degenerate zero-width interval at 0, not a division-by-zero crash', () => {
    expect(wilsonInterval(0, 0)).toEqual({ point: 0, low: 0, high: 0 });
  });
});

// ---------------------------------------------------------------------------
// S2.2.5a — the corrected comeback metric. These are FORCING tests: each one
// fails against the metric S2.2.5 shipped, which is the point.
// ---------------------------------------------------------------------------

describe('trailingPlayers — AC1: a tie is not a comeback', () => {
  // THE EXACT DEFECT, FORCED. `lastPlacePlayers` returns all four players tied
  // at the minimum, so `trailing.includes(winnerId)` was TRUE for whoever won:
  // a four-way tie scored a "comeback" with probability 1, in a match with no
  // leader to come back from. `trailingPlayers` returns EMPTY: nobody is behind.
  it('a four-way tie at T* yields an EMPTY trailing set (the old rule returned all four)', () => {
    const tied = vpMap(5, 5, 5, 5);

    expect(trailingPlayers(tied, PLAYERS, 3)).toEqual([]);

    // The old rule, kept only to demonstrate what it did: every player "last".
    expect(lastPlacePlayers(tied, PLAYERS)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('no winner can be a comeback out of a four-way tie, whoever wins', () => {
    const tied = vpMap(5, 5, 5, 5);
    const trailing = trailingPlayers(tied, PLAYERS, 3);

    for (const winnerId of PLAYERS) {
      expect(trailing.includes(winnerId)).toBe(false);
      // ...whereas the old rule scored a comeback for EVERY one of them.
      expect(lastPlacePlayers(tied, PLAYERS).includes(winnerId)).toBe(true);
    }
  });

  it('a near-tie inside the deficit threshold also trails nobody', () => {
    // leader 5, others 3/4/5 — max deficit 2 < 3, so nobody is trailing,
    // even though `lastPlacePlayers` happily names p2 "last place".
    const near = vpMap(5, 3, 4, 5);
    expect(trailingPlayers(near, PLAYERS, 3)).toEqual([]);
    expect(lastPlacePlayers(near, PLAYERS)).toEqual(['p2']);
  });

  it('names exactly the players at least `deficitThreshold` behind the leader', () => {
    // leader 6; deficits 0/4/3/2 -> p2 and p3 trail at >=3, p4 does not.
    const spread = vpMap(6, 2, 3, 4);
    expect(trailingPlayers(spread, PLAYERS, 3)).toEqual(['p2', 'p3']);
  });
});

describe('anchorThresholds — AC2: both cuts scale with vpToWin', () => {
  // The whole point of the correction: the treatment variable (`vpToWin`) must
  // not move the metric. Anchor `ceil(V/2)` and deficit `ceil(V/4)` both scale
  // with V, so a shorter match is measured at a proportionally equivalent point
  // in the RACE rather than at a compressed VP distribution.
  it('blitz (V=8) anchors at 4 VP with a deficit of >=2', () => {
    expect(anchorThresholds(8)).toEqual({ anchorVp: 4, deficitThreshold: 2 });
  });

  it('classic (V=10) anchors at 5 VP with a deficit of >=3', () => {
    expect(anchorThresholds(10)).toEqual({ anchorVp: 5, deficitThreshold: 3 });
  });

  it('__vp9_test__ (V=9) anchors at 5 VP with a deficit of >=3 — identical cuts to classic', () => {
    // Integer VP make exact proportionality impossible (V/4 = 2, 2.25, 2.5),
    // so `ceil` collapses V=9 onto V=10's cuts. Documented, not tuned: this is
    // WHY H3' is a near-perfectly controlled comparison — see the story file.
    expect(anchorThresholds(9)).toEqual(anchorThresholds(10));
  });

  it('both cuts are monotone non-decreasing in vpToWin', () => {
    for (let v = 2; v < 20; v += 1) {
      const lo = anchorThresholds(v);
      const hi = anchorThresholds(v + 1);
      expect(hi.anchorVp).toBeGreaterThanOrEqual(lo.anchorVp);
      expect(hi.deficitThreshold).toBeGreaterThanOrEqual(lo.deficitThreshold);
    }
  });
});

describe('soleLastPlacePlayer — the sensitivity outcome drops ties', () => {
  it('returns the unique minimum', () => {
    expect(soleLastPlacePlayer(vpMap(5, 2, 4, 3), PLAYERS)).toBe('p2');
  });

  it('returns null on ANY tie for last, so the match leaves the denominator', () => {
    expect(soleLastPlacePlayer(vpMap(5, 2, 2, 3), PLAYERS)).toBeNull();
    expect(soleLastPlacePlayer(vpMap(5, 5, 5, 5), PLAYERS)).toBeNull();
  });
});
