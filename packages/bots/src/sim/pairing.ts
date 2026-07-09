// S2.2.5 diagnostics (team-lead-requested) — a paired, McNemar-style
// discordant-pair comparison of the comeback outcome between a profile and
// the Classic baseline, on the SAME seed set. Two marginal comebackRate
// percentages can look similar (or different) by coincidence; this asks the
// statistically sharper question: on how many INDIVIDUAL seeds did the two
// profiles actually disagree, and in which direction?
import { chiSquarePValue1df } from './metrics.js';
import type { ProfileSweepResult } from './sweep.js';

/**
 * Which per-seed boolean outcome to pair on. S2.2.5a runs the same paired test
 * twice: once on the PRIMARY outcome (winner trailing at the VP-relative anchor
 * `T*`) and once on the SENSITIVITY outcome (winner was the unique last place at
 * the old midpoint). Agreement between them is the evidence that the anchor no
 * longer leaks the treatment; divergence means neither may be reported as a
 * verdict.
 */
export type PairedOutcome = (result: ProfileSweepResult) => ReadonlyArray<boolean | null>;

export const PRIMARY_OUTCOME: PairedOutcome = (r) => r.comebackBySeed;
export const SENSITIVITY_OUTCOME: PairedOutcome = (r) => r.sensitivityBySeed;

export interface DiscordantPairs {
  readonly baselineLabel: string;
  readonly profileLabel: string;
  /** Seeds where BOTH sides produced a non-`null` outcome — stalls (and, for the sensitivity outcome, dropped ties) are excluded. */
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
  outcome: PairedOutcome = PRIMARY_OUTCOME,
): DiscordantPairs {
  let n = 0;
  let bothComeback = 0;
  let neitherComeback = 0;
  let profileOnlyComeback = 0;
  let baselineOnlyComeback = 0;

  const baselineOutcome = outcome(baseline);
  const profileOutcome = outcome(profile);
  const len = Math.min(baselineOutcome.length, profileOutcome.length);
  for (let i = 0; i < len; i += 1) {
    const b = baselineOutcome[i];
    const p = profileOutcome[i];
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

export interface PairingOptions {
  /**
   * Permit a paired comparison between arms scored at DIFFERENT anchor cuts.
   *
   * Off by default, and it should stay off. Two arms scored at different
   * `scoredAtVpToWin` are measured at different points of the game, so their
   * McNemar statistic reflects anchor placement, not catch-up. The escape hatch
   * exists only so the story file can reproduce the S2.2.5a artifact
   * (`blitz` self-scored: χ²=627.34) from committed code.
   */
  readonly allowMismatchedCuts?: boolean;
}

/**
 * Compares every OTHER result in `results` against the one labelled
 * `'classic'` — label-based, not index-based, so a `--profiles` subset run
 * (e.g. just `classic` + one candidate) finds the right baseline regardless of
 * array order.
 *
 * THROWS when no `'classic'` row is present (S2.2.5a, reviewer finding S-2).
 * The old `?? results[0]` fallback silently re-baselined a subset run against
 * whichever profile happened to sort first, labelling the output `vs. Classic`
 * while comparing something else entirely — a wrong number that looks right.
 *
 * ALSO THROWS when an arm was scored at different anchor cuts from the baseline
 * (S2.2.5a-follow-up). That is the confound that produced this story's headline
 * artifact: an arm allowed to score itself is measured at its own point of the
 * race, so the comparison answers "where was the instrument placed?" rather than
 * "does this profile aid a trailing player?". Pass `allowMismatchedCuts` to
 * override, deliberately and visibly.
 */
export function computeAllDiscordantPairs(
  results: readonly ProfileSweepResult[],
  outcome: PairedOutcome = PRIMARY_OUTCOME,
  options: PairingOptions = {},
): readonly DiscordantPairs[] {
  if (results.length === 0) return [];
  const baseline = results.find((r) => r.label === 'classic');
  if (!baseline) {
    throw new Error(
      "computeAllDiscordantPairs needs the 'classic' baseline in `results`, but the " +
        `sweep ran only: ${results.map((r) => r.label).join(', ')}. Add 'classic' to ` +
        '--profiles: a paired comparison against a substitute baseline is not the ' +
        'comparison the report claims to print.',
    );
  }

  const others = results.filter((r) => r !== baseline);
  if (!options.allowMismatchedCuts) {
    const mismatched = others.filter(
      (r) => r.scoredAtVpToWin !== baseline.scoredAtVpToWin,
    );
    if (mismatched.length > 0) {
      throw new Error(
        `computeAllDiscordantPairs refuses to pair arms scored at different anchor cuts: ` +
          `baseline '${baseline.label}' was scored at vpToWin=${baseline.scoredAtVpToWin}, but ` +
          `${mismatched.map((r) => `'${r.label}' at vpToWin=${r.scoredAtVpToWin}`).join(', ')}. ` +
          'An arm scored at its own vpToWin is measured at a different point of the same ' +
          'game, so the McNemar statistic reports anchor placement, not catch-up (S2.2.5a: ' +
          "blitz self-scored gives chiSquare=627.34; scored at classic's cuts the effect " +
          'REVERSES). Drop `selfScored`, or pass `allowMismatchedCuts` if you are ' +
          'deliberately reproducing the artifact.',
      );
    }
  }

  return others.map((profile) => computeDiscordantPairs(baseline, profile, outcome));
}
