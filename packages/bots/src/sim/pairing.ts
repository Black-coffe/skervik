// S2.2.5 diagnostics (team-lead-requested) — a paired, McNemar-style
// discordant-pair comparison of the comeback outcome between a profile and
// the Classic baseline, on the SAME seed set. Two marginal comebackRate
// percentages can look similar (or different) by coincidence; this asks the
// statistically sharper question: on how many INDIVIDUAL seeds did the two
// profiles actually disagree, and in which direction?
import { chiSquarePValue1df } from './metrics.js';
import type { ProfileSweepResult } from './sweep.js';

export interface DiscordantPairs {
  readonly baselineLabel: string;
  readonly profileLabel: string;
  /** Seeds where BOTH the baseline and the profile completed — stalled seeds on either side are excluded. */
  readonly n: number;
  readonly bothComeback: number;
  readonly neitherComeback: number;
  /** Seeds where the PROFILE had a comeback but Classic, on the SAME seed, did not. */
  readonly profileOnlyComeback: number;
  /** Seeds where CLASSIC had a comeback but the profile, on the SAME seed, did not. */
  readonly baselineOnlyComeback: number;
  /**
   * Continuity-corrected McNemar chi-square on the discordant pairs,
   * `(|b - c| - 1)^2 / (b + c)` (1 degree of freedom; compare against 3.841
   * for p<0.05). `0` when there are no discordant pairs (undefined/no
   * signal either way).
   */
  readonly mcNemarChiSquare: number;
  /** Two-sided p-value for {@link mcNemarChiSquare} (1 df). `1` when there are no discordant pairs. */
  readonly pValue: number;
}

/** Compares `profile` against `baseline` (normally Classic) index-by-index over their shared seed order. */
export function computeDiscordantPairs(
  baseline: ProfileSweepResult,
  profile: ProfileSweepResult,
): DiscordantPairs {
  let n = 0;
  let bothComeback = 0;
  let neitherComeback = 0;
  let profileOnlyComeback = 0;
  let baselineOnlyComeback = 0;

  const len = Math.min(baseline.comebackBySeed.length, profile.comebackBySeed.length);
  for (let i = 0; i < len; i += 1) {
    const b = baseline.comebackBySeed[i];
    const p = profile.comebackBySeed[i];
    if (b === null || b === undefined || p === null || p === undefined) continue; // a stall on either side — excluded from the paired comparison
    n += 1;
    if (b && p) bothComeback += 1;
    else if (!b && !p) neitherComeback += 1;
    else if (p && !b) profileOnlyComeback += 1;
    else baselineOnlyComeback += 1;
  }

  const discordant = profileOnlyComeback + baselineOnlyComeback;
  const mcNemarChiSquare =
    discordant > 0
      ? (Math.abs(profileOnlyComeback - baselineOnlyComeback) - 1) ** 2 / discordant
      : 0;

  return {
    baselineLabel: baseline.label,
    profileLabel: profile.label,
    n,
    bothComeback,
    neitherComeback,
    profileOnlyComeback,
    baselineOnlyComeback,
    mcNemarChiSquare,
    pValue: chiSquarePValue1df(mcNemarChiSquare),
  };
}

/**
 * Compares every OTHER result in `results` against the one labelled
 * `'classic'` (falling back to the first entry if Classic isn't present in a
 * filtered run) — label-based, not index-based, so a `--profiles` subset run
 * (e.g. just `classic` + one candidate) still finds the right baseline
 * regardless of array order.
 */
export function computeAllDiscordantPairs(
  results: readonly ProfileSweepResult[],
): readonly DiscordantPairs[] {
  const baseline = results.find((r) => r.label === 'classic') ?? results[0];
  if (!baseline) return [];
  return results
    .filter((r) => r !== baseline)
    .map((profile) => computeDiscordantPairs(baseline, profile));
}
