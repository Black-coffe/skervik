// S2.2.5 — sweep library shape + determinism, at a LOW seed count (this must
// NOT be the long sweep — Constraint 7). The real 100-seed sweep is the
// `sim` CLI script, run once and pasted into the story file, never part of
// `pnpm -r test`.
import { describe, expect, it } from 'vitest';

import { buildReport, runSweep, SWEEP_PROFILES } from './index.js';

describe('balance-sim sweep — shape & determinism (S2.2.5, low seed count)', () => {
  it('runs all ten configured profiles and returns one result per profile', () => {
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
});
