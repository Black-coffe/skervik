// S2.2.5 diagnostics (team-lead-requested, EXPLORATORY, not pre-registered) —
// within a single profile's own sweep, splits its completed matches into a
// "shorter half" and "longer half" by that profile's OWN median `turns`, and
// reports the comeback rate in each half. Answers: does match length alone
// (independent of any catch-up flag) predict a comeback, within one profile?
// This is descriptive, not a hypothesis test — no p-value is attached here by
// design (the caller must not treat it as one).
import { median } from './metrics.js';
import type { ProfileSweepResult } from './sweep.js';

export interface LengthSplit {
  readonly label: string;
  /** Seeds included (both `turnsBySeed` and `comebackBySeed` present — excludes stalls). */
  readonly n: number;
  /** This profile's OWN median `turns` over its completed matches — the split point. */
  readonly medianTurns: number;
  readonly shorterN: number;
  readonly shorterComebackRate: number;
  readonly longerN: number;
  readonly longerComebackRate: number;
}

/** Splits `result`'s own completed matches at its own median turn count. */
export function splitByMedianTurns(result: ProfileSweepResult): LengthSplit {
  const pairs: Array<{ turns: number; comeback: boolean }> = [];
  const len = Math.min(result.turnsBySeed.length, result.comebackBySeed.length);
  for (let i = 0; i < len; i += 1) {
    const turns = result.turnsBySeed[i];
    const comeback = result.comebackBySeed[i];
    if (
      turns === null ||
      turns === undefined ||
      comeback === null ||
      comeback === undefined
    ) {
      continue; // a stall — excluded
    }
    pairs.push({ turns, comeback });
  }

  const medianTurns = median(pairs.map((p) => p.turns));
  const shorter = pairs.filter((p) => p.turns <= medianTurns);
  const longer = pairs.filter((p) => p.turns > medianTurns);
  const rate = (group: readonly { comeback: boolean }[]): number =>
    group.length > 0 ? group.filter((p) => p.comeback).length / group.length : 0;

  return {
    label: result.label,
    n: pairs.length,
    medianTurns,
    shorterN: shorter.length,
    shorterComebackRate: rate(shorter),
    longerN: longer.length,
    longerComebackRate: rate(longer),
  };
}

export function computeAllLengthSplits(
  results: readonly ProfileSweepResult[],
): readonly LengthSplit[] {
  return results.map(splitByMedianTurns);
}
