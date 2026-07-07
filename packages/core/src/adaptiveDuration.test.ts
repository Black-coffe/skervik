// @skervik/core — S2.1.3: the adaptive-duration calculator.
//
// Proves the CONTRACT, not the minute values (the coefficients are v1
// placeholders, calibrated later against telemetry — see the module doc):
// (1) `estimateMatchMinutes` is monotonic in playerCount and vpToWin and the
// two calibration anchors hold (4p Classic within the ceiling, 6p Classic
// over it); (2) `computeAdaptiveDuration` leaves a fitting profile unchanged;
// (3) it lowers `vpToWin` step by step — via the proven Blitz-style
// deep-merge — until the estimate fits or the floor is hit; (4) when even the
// floor doesn't fit, it reports `warningCode: 'exceeds_ceiling_at_vp_floor'`
// and never lowers `vpToWin` below the floor; (5) out-of-range player counts
// are rejected; (6) the function is pure/deterministic and never touches a
// preset object.

import { describe, expect, it } from 'vitest';

import {
  ADAPTIVE_CEILING_MINUTES,
  ADAPTIVE_MAX_PLAYERS,
  ADAPTIVE_MIN_PLAYERS,
  ADAPTIVE_VP_FLOOR,
  computeAdaptiveDuration,
  estimateMatchMinutes,
} from './adaptiveDuration.js';
import { BLITZ_PROFILE, CLASSIC_PROFILE } from './ruleProfile.js';

describe('estimateMatchMinutes', () => {
  it('is monotonically increasing in playerCount (fixed vpToWin)', () => {
    let previous = estimateMatchMinutes(CLASSIC_PROFILE, ADAPTIVE_MIN_PLAYERS);
    for (let n = ADAPTIVE_MIN_PLAYERS + 1; n <= ADAPTIVE_MAX_PLAYERS; n++) {
      const current = estimateMatchMinutes(CLASSIC_PROFILE, n);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it('is monotonically increasing in vpToWin (fixed playerCount)', () => {
    const lower = estimateMatchMinutes(BLITZ_PROFILE, 4); // vpToWin: 8
    const higher = estimateMatchMinutes(CLASSIC_PROFILE, 4); // vpToWin: 10
    expect(higher).toBeGreaterThan(lower);
  });

  it('calibration anchor: 4 players × Classic (10 VP) is WITHIN the 60-min ceiling', () => {
    expect(estimateMatchMinutes(CLASSIC_PROFILE, 4)).toBeLessThanOrEqual(
      ADAPTIVE_CEILING_MINUTES,
    );
  });

  it('calibration anchor: 6 players × Classic (10 VP) is OVER the 60-min ceiling', () => {
    expect(estimateMatchMinutes(CLASSIC_PROFILE, 6)).toBeGreaterThan(
      ADAPTIVE_CEILING_MINUTES,
    );
  });

  it('is pure: same inputs produce the same output', () => {
    const a = estimateMatchMinutes(CLASSIC_PROFILE, 5);
    const b = estimateMatchMinutes(CLASSIC_PROFILE, 5);
    expect(a).toBe(b);
  });
});

describe('computeAdaptiveDuration', () => {
  it("('classic', 4) returns the base profile UNCHANGED", () => {
    const result = computeAdaptiveDuration('classic', 4);
    expect(result.profile).toBe(CLASSIC_PROFILE);
    expect(result.adjustments).toEqual([]);
    expect(result.withinCeiling).toBe(true);
    expect(result.estimatedMinutes).toBe(result.baselineMinutes);
    expect(result.warningCode).toBeUndefined();
  });

  it("('classic', 6) lowers vpToWin below 10 until the estimate fits", () => {
    const result = computeAdaptiveDuration('classic', 6);
    expect(result.profile.victory.vpToWin).toBeLessThan(10);
    expect(result.profile.victory.vpToWin).toBeGreaterThanOrEqual(ADAPTIVE_VP_FLOOR);
    expect(result.estimatedMinutes).toBeLessThanOrEqual(ADAPTIVE_CEILING_MINUTES);
    expect(result.withinCeiling).toBe(true);
    expect(result.adjustments).toEqual([
      { knob: 'vpToWin', from: 10, to: result.profile.victory.vpToWin },
    ]);
    expect(result.warningCode).toBeUndefined();
  });

  it("('classic', 6) returns a correct deep-merge: every other field === base", () => {
    const result = computeAdaptiveDuration('classic', 6);
    expect(result.profile).not.toBe(CLASSIC_PROFILE);
    expect(result.profile.id).toBe(CLASSIC_PROFILE.id);
    expect(result.profile.board).toBe(CLASSIC_PROFILE.board);
    expect(result.profile.devCards).toBe(CLASSIC_PROFILE.devCards);
    expect(result.profile.build).toBe(CLASSIC_PROFILE.build);
    expect(result.profile.bankTrade).toBe(CLASSIC_PROFILE.bankTrade);
    expect(result.profile.robber).toBe(CLASSIC_PROFILE.robber);
    expect(result.profile.victory.longestRoadMin).toBe(
      CLASSIC_PROFILE.victory.longestRoadMin,
    );
    expect(result.profile.victory.largestArmyMin).toBe(
      CLASSIC_PROFILE.victory.largestArmyMin,
    );
    // The source preset must never be mutated by the adjustment.
    expect(CLASSIC_PROFILE.victory.vpToWin).toBe(10);
  });

  it('never lowers vpToWin below ADAPTIVE_VP_FLOOR, and warns when the floor still exceeds the target', () => {
    // A deliberately tiny target forces the loop all the way to the floor.
    const result = computeAdaptiveDuration('classic', 6, 20);
    expect(result.profile.victory.vpToWin).toBe(ADAPTIVE_VP_FLOOR);
    expect(result.withinCeiling).toBe(false);
    expect(result.warningCode).toBe('exceeds_ceiling_at_vp_floor');
    expect(result.estimatedMinutes).toBeGreaterThan(result.targetMinutes);
  });

  it('rejects an out-of-range playerCount', () => {
    expect(() => computeAdaptiveDuration('classic', ADAPTIVE_MIN_PLAYERS - 1)).toThrow(
      /playerCount/i,
    );
    expect(() => computeAdaptiveDuration('classic', ADAPTIVE_MAX_PLAYERS + 1)).toThrow(
      /playerCount/i,
    );
  });

  it('never returns a user-facing English string — only a structured warningCode', () => {
    const result = computeAdaptiveDuration('classic', 6, 20);
    expect(typeof result.warningCode).toBe('string');
    expect(result.warningCode).toMatch(/^[a-z_]+$/);
  });

  it('is pure/deterministic: repeated calls with the same inputs agree', () => {
    const a = computeAdaptiveDuration('classic', 6);
    const b = computeAdaptiveDuration('classic', 6);
    expect(a).toEqual(b);
  });
});
