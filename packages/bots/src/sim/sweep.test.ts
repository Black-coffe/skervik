// S2.2.5 — sweep library shape + determinism, at a LOW seed count (this must
// NOT be the long sweep — Constraint 7). The real 100-seed sweep is the
// `sim` CLI script, run once and pasted into the story file, never part of
// `pnpm -r test`.
import { describe, expect, it } from 'vitest';

import {
  buildReport,
  computeAllDiscordantPairs,
  runSweep,
  SELF_SCORED_WARNING,
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

  it('scores EVERY arm at the classic baseline cuts by default (blitz included)', () => {
    const byLabel = new Map(runSweep(2).map((r) => [r.label, r]));

    const classic = byLabel.get('classic')!;
    expect([classic.vpToWin, classic.scoredAtVpToWin, classic.anchorVp]).toEqual([
      10, 10, 5,
    ]);

    // blitz's OWN vpToWin is 8, but it is measured at classic's cuts (5 / >=3),
    // not its own (4 / >=2) — the safe thing is the default thing.
    const blitz = byLabel.get('blitz')!;
    expect([
      blitz.vpToWin,
      blitz.scoredAtVpToWin,
      blitz.anchorVp,
      blitz.deficitThreshold,
    ]).toEqual([8, 10, 5, 3]);
  });

  it('self-scoring is opt-in, and then each arm uses its own cuts (blitz 4/>=2)', () => {
    const byLabel = new Map(
      runSweep(2, undefined, { selfScored: true }).map((r) => [r.label, r]),
    );
    const blitz = byLabel.get('blitz')!;
    expect([blitz.scoredAtVpToWin, blitz.anchorVp, blitz.deficitThreshold]).toEqual([
      8, 4, 2,
    ]);
  });

  it('--score-at can target a non-baseline profile explicitly', () => {
    const byLabel = new Map(
      runSweep(2, ['classic', 'blitz'], { scoreAtLabel: 'blitz' }).map((r) => [
        r.label,
        r,
      ]),
    );
    // BOTH arms now use blitz's cuts — still matched, still a valid contrast.
    expect(byLabel.get('classic')!.scoredAtVpToWin).toBe(8);
    expect(byLabel.get('blitz')!.scoredAtVpToWin).toBe(8);
  });

  it('rejects an unknown --score-at label rather than silently defaulting', () => {
    expect(() => runSweep(2, ['classic'], { scoreAtLabel: 'nope' })).toThrow(/nope/);
  });
});

/**
 * AC(a) for the matched-cut capability. The v1 bot is `vpToWin`-blind and blitz's
 * timers are inert in the sim, so `classic` and `blitz` share a byte-identical
 * event PREFIX on a shared seed until someone wins. Scored at the SAME cuts they
 * must therefore see the same anchor turn and the same trailing set — which is
 * exactly why the matched-cut contrast is a clean, apples-to-apples test, and why
 * the self-scored variant is not.
 */
describe('matched cuts: two profiles with different vpToWin see the SAME trailing set', () => {
  it('classic and blitz agree per-seed on the trailing count when scored at the same cuts', () => {
    const [classic, blitz] = runSweep(6, ['classic', 'blitz']);
    expect(classic!.scoredAtVpToWin).toBe(blitz!.scoredAtVpToWin);

    let compared = 0;
    for (let i = 0; i < classic!.trailingCountBySeed.length; i += 1) {
      const c = classic!.trailingCountBySeed[i];
      const b = blitz!.trailingCountBySeed[i];
      if (c === null || c === undefined || b === null || b === undefined) continue;
      compared += 1;
      expect(b).toBe(c);
    }
    expect(compared).toBeGreaterThan(0);
    expect(blitz!.medianAnchorTurn).toBe(classic!.medianAnchorTurn);
    expect(blitz!.trailingCountHistogram).toEqual(classic!.trailingCountHistogram);
  });

  it('...and DIVERGE once blitz is allowed to score itself (the artifact, forced)', () => {
    const [classic, blitz] = runSweep(6, ['classic', 'blitz'], { selfScored: true });
    // Blitz's anchor now fires earlier in the very same game, so it sees a
    // different (larger) trailing set. If this ever stops diverging, the
    // matched-cut capability has become a no-op and the guard below is vacuous.
    expect(blitz!.medianAnchorTurn).toBeLessThan(classic!.medianAnchorTurn);
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

/** AC(b): an arm may never score itself in a cross-profile contrast without saying so. */
describe('computeAllDiscordantPairs — an arm may not score itself in a cross-profile contrast', () => {
  it('THROWS when a self-scored arm has different anchor cuts from the baseline', () => {
    const results = runSweep(2, ['classic', 'blitz'], { selfScored: true });
    expect(() => computeAllDiscordantPairs(results)).toThrow(/different anchor cuts/);
  });

  it('names the offending arm and both vpToWin values in the message', () => {
    const results = runSweep(2, ['classic', 'blitz'], { selfScored: true });
    expect(() => computeAllDiscordantPairs(results)).toThrow(/'blitz' at vpToWin=8/);
  });

  it('permits the artifact only under an explicit allowMismatchedCuts opt-in', () => {
    const results = runSweep(2, ['classic', 'blitz'], { selfScored: true });
    const pairs = computeAllDiscordantPairs(results, undefined, {
      allowMismatchedCuts: true,
    });
    expect(pairs.map((p) => p.profileLabel)).toEqual(['blitz']);
  });

  it('does NOT throw when a self-scored arm happens to share the baseline cuts', () => {
    // hiddenVpTest is vpToWin:10, same as classic — self-scoring is harmless
    // here, so the guard must key on the CUTS, not on the selfScored flag.
    const results = runSweep(2, ['classic', 'hiddenVpTest'], { selfScored: true });
    expect(() => computeAllDiscordantPairs(results)).not.toThrow();
  });
});

describe('buildReport — labels the scoring mode instead of hiding it', () => {
  it('records the shared cuts for a matched run', () => {
    const report = buildReport(2, runSweep(2, ['classic', 'blitz']));
    expect(report.selfScored).toBe(false);
    expect(report.scoredAtVpToWin).toBe(10);
    expect(report.notes).not.toContain(SELF_SCORED_WARNING);
  });

  it('flags a self-scored run loudly and still emits its (confounded) pairs', () => {
    const report = buildReport(
      2,
      runSweep(2, ['classic', 'blitz'], { selfScored: true }),
    );
    expect(report.selfScored).toBe(true);
    expect(report.scoredAtVpToWin).toBeNull();
    expect(report.notes).toContain(SELF_SCORED_WARNING);
    expect(report.discordantPairs).toHaveLength(1);
  });
});
