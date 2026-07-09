// S2.2.5 — sweep library shape + determinism, at a LOW seed count (this must
// NOT be the long sweep — Constraint 7). The real 100-seed sweep is the
// `sim` CLI script, run once and pasted into the story file, never part of
// `pnpm -r test`.
import { describe, expect, it } from 'vitest';

import {
  buildReport,
  computeAllDiscordantPairs,
  runSweep,
  SWEEP_PROFILES,
} from './index.js';

describe('balance-sim sweep — shape & determinism (S2.2.5, low seed count)', () => {
  it('runs all twelve configured profiles and returns one result per profile', () => {
    const results = runSweep(2);
    expect(results).toHaveLength(SWEEP_PROFILES.length);
    expect(results.map((r) => r.label)).toEqual(SWEEP_PROFILES.map((p) => p.label));
  });

  it('is deterministic — two runs at the same seed count produce byte-identical JSON (AC5)', () => {
    const a = JSON.stringify(buildReport(2, runSweep(2)));
    const b = JSON.stringify(buildReport(2, runSweep(2)));
    expect(a).toBe(b);
  });

  it('every profile accounts for every seed: n === completed + stalledSeeds.length (never a silent drop)', () => {
    const results = runSweep(2);
    for (const r of results) {
      expect(r.completed + r.stalledSeeds.length).toBe(r.n);
    }
  });

  // S2.2.5a — the corrected metric's book-keeping must also never drop a match.
  it('every completed match lands in exactly one anchor bucket (histogram + anchorMissing)', () => {
    for (const r of runSweep(2)) {
      const binned = ['0', '1', '2', '3'].reduce(
        (sum, k) => sum + (r.trailingCountHistogram[k] ?? 0),
        0,
      );
      expect(binned + r.anchorMissingMatches).toBe(r.completed);
      expect(r.zeroTrailingMatches).toBe(r.trailingCountHistogram['0'] ?? 0);
    }
  });

  it('the sensitivity denominator accounts for every completed match (ties dropped, not credited)', () => {
    for (const r of runSweep(2)) {
      expect(r.sensitivityN + r.sensitivityTiesDropped).toBe(r.completed);
    }
  });

  it("anchor cuts scale with each profile's own vpToWin (blitz 4/>=2, classic 5/>=3)", () => {
    const results = runSweep(2);
    const byLabel = new Map(results.map((r) => [r.label, r]));

    const classic = byLabel.get('classic')!;
    expect([classic.vpToWin, classic.anchorVp, classic.deficitThreshold]).toEqual([
      10, 5, 3,
    ]);

    const blitz = byLabel.get('blitz')!;
    expect([blitz.vpToWin, blitz.anchorVp, blitz.deficitThreshold]).toEqual([8, 4, 2]);
  });
});

describe('computeAllDiscordantPairs — S-2: no silent baseline substitution', () => {
  it('throws when the requested subset omits the classic baseline', () => {
    const results = runSweep(2, ['blitz', 'balanced']);
    expect(() => computeAllDiscordantPairs(results)).toThrow(/classic/);
  });

  it('pairs against classic when it is present', () => {
    const pairs = computeAllDiscordantPairs(runSweep(2, ['classic', 'blitz']));
    expect(pairs.map((p) => p.profileLabel)).toEqual(['blitz']);
    expect(pairs[0]?.baselineLabel).toBe('classic');
  });
});
