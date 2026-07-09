// S2.2.5 — the balance-sim sweep: runs a FIXED, uniform-strength 4-hard-bot
// cohort through every `SWEEP_PROFILES` entry, over the SAME seed set (paired
// comparison, Constraint 4), and folds the four story metrics per profile.
// This is the library the `sim-cli.ts` CLI and the forcing tests both call —
// it produces no I/O, no console output, no wall-clock.
import {
  computePublicVictoryPoints,
  deriveValue,
  type ExperimentalProfileId,
  loadRuleProfile,
  type PlayerId,
  type RuleProfileId,
  type Seed,
} from '@skervik/core';

import { type Bot, createHeuristicBot } from '../bot.js';
import { type SimResult, simulateMatch } from '../harness.js';
import {
  anchorSnapshot,
  anchorThresholds,
  mean,
  median,
  midpointPublicVp,
  percentile,
  type ProportionInterval,
  soleLastPlacePlayer,
  wilsonInterval,
} from './metrics.js';
import { type ProfileSweepSpec, SWEEP_PROFILES } from './profiles.js';

/** Fixed 4-player cohort, uniform strength — isolates the RULE's effect from bot-skill asymmetry. */
export const SWEEP_PLAYER_IDS: readonly PlayerId[] = [
  'seat-1',
  'seat-2',
  'seat-3',
  'seat-4',
];

/** Uniform difficulty for every seat in the sweep (story: "all seats difficulty: 'hard'"). */
export const SWEEP_BOT_DIFFICULTY = 'hard';

/**
 * Named salt for the `deriveValue`-derived seed set — recorded in the report
 * header for reproducibility.
 *
 * S2.2.5a rotated this from `'balance-sim-salt'` to `…-v2`. The metric that
 * produced S2.2.5's H2/H3 results was confounded and has been replaced; a
 * hypothesis may not be re-tested on the same data after the metric that
 * produced its result was changed to fix that result. H2′/H3′ are therefore
 * pre-registered against a FRESH seed set. Any number in this repo derived
 * under `'balance-sim-salt'` is void — see the story's `## Retraction`.
 */
export const SWEEP_SEED_SALT = 'balance-sim-salt-v2';

/** Derives `n` reproducible match seeds, the `harness.test.ts` `deriveValue('sweep-salt', i)` pattern. */
export function sweepSeeds(n: number): readonly Seed[] {
  return Array.from(
    { length: n },
    (_, i) => `sim-${i}-${deriveValue(SWEEP_SEED_SALT, i).toFixed(9)}`,
  );
}

/**
 * Bot noise seeds are `(difficulty, matchSeed, playerId)` ONLY — the SAME
 * derivation `harness.test.ts`'s `fieldOf` uses — and never see `profileId`,
 * so the same match seed produces the same bot behavior across every profile
 * (Constraint 4).
 */
function fieldOf(seed: Seed): Readonly<Record<PlayerId, Bot>> {
  const bots: Record<PlayerId, Bot> = {};
  for (const id of SWEEP_PLAYER_IDS) {
    bots[id] = createHeuristicBot({
      difficulty: SWEEP_BOT_DIFFICULTY,
      seed: `${SWEEP_BOT_DIFFICULTY}-${seed}-${id}`,
    });
  }
  return bots;
}

export interface ProfileSweepResult {
  readonly id: string;
  readonly label: string;
  readonly isolates: string;
  /** Seeds attempted. */
  readonly n: number;
  /** Seeds that reached `game.ended` within the harness cap. */
  readonly completed: number;
  /** Seeds that did NOT terminate (harness threw) — reported, never silently dropped. */
  readonly stalledSeeds: readonly Seed[];
  readonly medianTurns: number;
  readonly p90Turns: number;
  readonly maxTurns: number;
  /** This profile's OWN `victory.vpToWin` — the treatment variable H2′/H3′ vary. */
  readonly vpToWin: number;
  /**
   * The `vpToWin` whose cuts this arm's anchor was actually SCORED at — the
   * baseline's by default, this profile's own only under `selfScored`.
   *
   * S2.2.5a-follow-up: this is the difference between a controlled contrast and
   * an artifact. `ceil(V/2)` is 4 for `blitz` and 5 for `classic`, so an arm
   * scored at its own cuts is measured at a DIFFERENT point of the very same
   * game (the v1 bot is `vpToWin`-blind, so the event prefix is byte-identical
   * until someone wins). Blitz's `T*` then lands ~17 turns earlier, fewer VP
   * have accrued, more players sit below the deficit cutoff, and the marginal
   * comeback rate rises with no change in catch-up dynamics at all — χ²=627 of
   * pure anchor placement. Scored at a SHARED `scoredAtVpToWin`, the trailing
   * sets coincide on 4996/4996 seeds and the effect reverses.
   */
  readonly scoredAtVpToWin: number;
  /** `ceil(scoredAtVpToWin/2)` — the leader public VP that defines the anchor turn `T*`. */
  readonly anchorVp: number;
  /** `ceil(scoredAtVpToWin/4)` — the deficit behind the leader at `T*` that makes a player "trailing". */
  readonly deficitThreshold: number;
  /**
   * PRIMARY OUTCOME (S2.2.5a): share of COMPLETED matches in which the winner
   * was TRAILING at the anchor turn `T*`.
   *
   * Matches with ZERO trailing players stay in this denominator and can never
   * be in the numerator (see {@link zeroTrailingMatches}); the audit fields
   * below exist so a reader can check that the profiles' trailing-count
   * WEIGHTS, not their within-stratum rates, are not doing the work — the
   * exact failure mode that voided the S2.2.5 metric.
   */
  readonly comebackRate: number;
  /** 95% Wilson score interval on {@link comebackRate} (over `completed`, `n` = completed). */
  readonly comebackRateCI: ProportionInterval;
  /** Median `T*` over completed matches — reported so a profile's anchor position is auditable. */
  readonly medianAnchorTurn: number;
  readonly p90AnchorTurn: number;
  /**
   * CONFOUND AUDIT (1): how many completed matches had exactly k trailing
   * players at `T*`, for k in 0..3 (a 4-player cohort's leader never trails).
   * These are the STRATUM WEIGHTS.
   */
  readonly trailingCountHistogram: Readonly<Record<string, number>>;
  /**
   * CONFOUND AUDIT (2): the comeback rate WITHIN each trailing-count stratum.
   * If these agree across profiles while only {@link trailingCountHistogram}
   * differs, the headline difference is a weighting artifact and NO verdict may
   * be drawn. Under a null (winner uniform over 4 seats), stratum k's rate is
   * k/4.
   */
  readonly comebackByTrailingCount: Readonly<
    Record<
      string,
      { readonly matches: number; readonly comebacks: number; readonly rate: number }
    >
  >;
  /** CONFOUND AUDIT (3): matches with NO trailing player — excluded from the numerator by construction. */
  readonly zeroTrailingMatches: number;
  /** Completed matches where the leader never reached `ceil(vpToWin/2)` public VP (hidden-VP win) — never dropped silently. */
  readonly anchorMissingMatches: number;
  /**
   * Descriptive companion, weighting-free: the denominator is every (match,
   * player) pair where that player was trailing at `T*`, and the numerator is
   * the pairs where that player went on to win. Under a null of "trailing does
   * not matter" this is ~0.25 by symmetry, which makes it directly
   * interpretable — unlike a marginal rate, whose scale depends on how many
   * players happen to be trailing.
   */
  readonly trailingSlots: number;
  readonly pWinGivenTrailing: number;
  readonly pWinGivenTrailingCI: ProportionInterval;
  /**
   * SENSITIVITY OUTCOME (the reviewer's cheap option): the winner was the
   * UNIQUE last-place player at the OLD, endogenous midpoint anchor. Ties are
   * DROPPED from the denominator, not credited to everyone tied.
   * `sensitivityN = completed - sensitivityTiesDropped`. If this disagrees with
   * {@link comebackRate}, the anchor still leaks and neither may be reported as
   * a verdict.
   */
  readonly sensitivityComebackRate: number;
  readonly sensitivityComebackRateCI: ProportionInterval;
  readonly sensitivityN: number;
  readonly sensitivityTiesDropped: number;
  /** Per-seed sensitivity outcome, aligned with the shared seed order; `null` = stalled seed OR dropped tie. */
  readonly sensitivityBySeed: ReadonlyArray<boolean | null>;
  readonly meanFinalVpGap: number;
  /** Win share by seat index (0..3), over completed matches. */
  readonly seatWinRate: readonly number[];
  readonly eventTilesInterval: number;
  /**
   * Per-seed PRIMARY comeback outcome, ALIGNED WITH the sweep's own seed order
   * (same index as the shared seed list) — `null` for a stalled seed. Feeds the
   * paired (McNemar-style) discordant-pair comparison against Classic
   * (`pairing.ts`) — a marginal comebackRate delta alone can't tell whether
   * two profiles disagree on the SAME seeds or merely have the same rate by
   * coincidence.
   */
  readonly comebackBySeed: ReadonlyArray<boolean | null>;
  /** Per-seed count of trailing players at `T*` — `null` for a stalled seed or a missing anchor. */
  readonly trailingCountBySeed: ReadonlyArray<number | null>;
  /**
   * Per-seed `SimResult.turns` (applied-step count), ALIGNED WITH the same
   * seed order as {@link comebackBySeed} — `null` for a stalled seed. Feeds
   * the within-profile match-length-vs-comeback split (`lengthSplit.ts`,
   * team-lead-requested exploratory diagnostic): whether SHORTER matches of
   * THIS profile show a higher comeback rate than longer ones.
   */
  readonly turnsBySeed: ReadonlyArray<number | null>;
  /**
   * Robin-Hood/poverty-token diagnostics (team-lead-requested, post-hoc):
   * total `poverty.tokensGranted` EVENTS across completed seeds, the total
   * token-units those events granted (sum of `grants` values — an event can
   * grant >1 player a token at once), and the total `bank.trade` events
   * carrying `povertyDiscount: true` (the ONLY way a granted token is ever
   * spent, `reduce.ts:729`). If `povertyDiscountTrades` is 0 while
   * `povertyTokensGrantedEvents` is >0, the grant half of the mechanic ran
   * but the spend half never did.
   */
  readonly povertyTokensGrantedEvents: number;
  readonly povertyTokensGrantedTotal: number;
  readonly povertyDiscountTrades: number;
  /**
   * Histogram of `povertyTokens` held per (player, completed-match) instance
   * at `phase:'finished'` — key is the token count as a string, value is how
   * many (player, match) pairs ended holding that many. A player who never
   * received a grant counts as holding `0`.
   */
  readonly povertyTokensAtEndHistogram: Readonly<Record<string, number>>;
}

/**
 * Runs one profile's sweep over the shared `seeds` set, scoring its anchor at
 * `scoreAtVpToWin`'s cuts.
 *
 * `scoreAtVpToWin` is REQUIRED and explicit rather than defaulted to the
 * profile's own `vpToWin`: an arm that scores itself cannot be compared to an
 * arm scored differently, and making the caller name the cuts is what stops
 * that from happening silently. {@link runSweep} supplies the baseline's.
 */
export function runSweepForProfile(
  spec: ProfileSweepSpec,
  seeds: readonly Seed[],
  scoreAtVpToWin: number,
): ProfileSweepResult {
  // Cast: `ProfileSweepSpec.id` is untyped `string` (shipping ids + measurement
  // ids share one field) — the registry key, not the type, is what resolves it
  // (same precedent as every internal test profile's `X as RuleProfileId`).
  const profile = loadRuleProfile(spec.id as RuleProfileId | ExperimentalProfileId);
  const { vpToWin } = profile.victory;
  const { anchorVp, deficitThreshold } = anchorThresholds(scoreAtVpToWin);

  const turnsList: number[] = [];
  const anchorTurns: number[] = [];
  const stalledSeeds: Seed[] = [];
  const vpGaps: number[] = [];
  const seatWins = SWEEP_PLAYER_IDS.map(() => 0);
  const comebackBySeed: Array<boolean | null> = [];
  const trailingCountBySeed: Array<number | null> = [];
  const sensitivityBySeed: Array<boolean | null> = [];
  const turnsBySeed: Array<number | null> = [];
  // Pre-seeded 0..3 in a fixed key order: a 4-seat cohort's leader never trails,
  // and `JSON.stringify` preserves insertion order, so byte-identical output must
  // not depend on which stratum a run happens to observe first (AC: determinism).
  const trailingCountHistogram: Record<string, number> = {
    '0': 0,
    '1': 0,
    '2': 0,
    '3': 0,
  };
  const comebacksByTrailingCount: Record<string, number> = {
    '0': 0,
    '1': 0,
    '2': 0,
    '3': 0,
  };
  let comebacks = 0;
  let completed = 0;
  let zeroTrailingMatches = 0;
  let anchorMissingMatches = 0;
  let trailingSlots = 0;
  let sensitivityComebacks = 0;
  let sensitivityTiesDropped = 0;
  let povertyTokensGrantedEvents = 0;
  let povertyTokensGrantedTotal = 0;
  let povertyDiscountTrades = 0;
  const povertyTokensAtEndHistogram: Record<string, number> = {};

  for (const seed of seeds) {
    let result: SimResult;
    try {
      result = simulateMatch({
        seed,
        playerIds: SWEEP_PLAYER_IDS,
        bots: fieldOf(seed),
        profileId: spec.id,
      });
    } catch {
      // Non-termination (cap hit) or a deadlock — reported below, never dropped silently.
      stalledSeeds.push(seed);
      comebackBySeed.push(null);
      trailingCountBySeed.push(null);
      sensitivityBySeed.push(null);
      turnsBySeed.push(null);
      continue;
    }

    completed += 1;
    turnsList.push(result.turns);
    turnsBySeed.push(result.turns);

    for (const event of result.events) {
      if (event.type === 'poverty.tokensGranted') {
        povertyTokensGrantedEvents += 1;
        for (const amount of Object.values(event.grants)) {
          povertyTokensGrantedTotal += amount;
        }
      } else if (event.type === 'bank.trade' && event.povertyDiscount === true) {
        povertyDiscountTrades += 1;
      }
    }
    for (const id of SWEEP_PLAYER_IDS) {
      const held = String(result.finalState.povertyTokens?.[id] ?? 0);
      povertyTokensAtEndHistogram[held] = (povertyTokensAtEndHistogram[held] ?? 0) + 1;
    }

    // PRIMARY (S2.2.5a): was the winner trailing at the VP-relative anchor `T*`?
    // Scored at `scoreAtVpToWin`, NOT at this profile's own `vpToWin` — see
    // `ProfileSweepResult.scoredAtVpToWin`.
    const anchor = anchorSnapshot(result.events, SWEEP_PLAYER_IDS, scoreAtVpToWin);
    if (anchor === null) {
      // The leader never reached ceil(V/2) PUBLIC VP — only reachable if hidden
      // VP carried the win. Counted, never silently folded into the numerator.
      anchorMissingMatches += 1;
      comebackBySeed.push(null);
      trailingCountBySeed.push(null);
    } else {
      anchorTurns.push(anchor.turn);
      const trailingCount = anchor.trailing.length;
      const stratum = String(trailingCount);
      trailingCountHistogram[stratum] = (trailingCountHistogram[stratum] ?? 0) + 1;
      trailingSlots += trailingCount;
      if (trailingCount === 0) zeroTrailingMatches += 1;

      const isComeback =
        result.winnerId !== null && anchor.trailing.includes(result.winnerId);
      if (isComeback) {
        comebacks += 1;
        comebacksByTrailingCount[stratum] = (comebacksByTrailingCount[stratum] ?? 0) + 1;
      }
      comebackBySeed.push(isComeback);
      trailingCountBySeed.push(trailingCount);
    }

    // SENSITIVITY: unique last place at the OLD, endogenous midpoint — ties dropped.
    const midpoint = midpointPublicVp(result.events, result.finalState, SWEEP_PLAYER_IDS);
    const soleLast = soleLastPlacePlayer(midpoint, SWEEP_PLAYER_IDS);
    if (soleLast === null) {
      sensitivityTiesDropped += 1;
      sensitivityBySeed.push(null);
    } else {
      const isSensitivityComeback = result.winnerId === soleLast;
      if (isSensitivityComeback) sensitivityComebacks += 1;
      sensitivityBySeed.push(isSensitivityComeback);
    }

    const finalVps = SWEEP_PLAYER_IDS.map((id) =>
      computePublicVictoryPoints(result.finalState, id),
    );
    const winnerVp =
      result.winnerId !== null
        ? computePublicVictoryPoints(result.finalState, result.winnerId)
        : Math.max(...finalVps);
    vpGaps.push(winnerVp - Math.min(...finalVps));

    if (result.winnerId !== null) {
      const seatIdx = SWEEP_PLAYER_IDS.indexOf(result.winnerId);
      if (seatIdx >= 0) seatWins[seatIdx] = (seatWins[seatIdx] ?? 0) + 1;
    }
  }

  // Matches that actually produced an anchor — the primary metric's denominator.
  const anchoredMatches = completed - anchorMissingMatches;
  const sensitivityN = completed - sensitivityTiesDropped;
  const comebackByTrailingCount: Record<
    string,
    { matches: number; comebacks: number; rate: number }
  > = {};
  for (const stratum of ['0', '1', '2', '3']) {
    const matches = trailingCountHistogram[stratum] ?? 0;
    const stratumComebacks = comebacksByTrailingCount[stratum] ?? 0;
    comebackByTrailingCount[stratum] = {
      matches,
      comebacks: stratumComebacks,
      rate: matches > 0 ? stratumComebacks / matches : 0,
    };
  }

  return {
    id: spec.id,
    label: spec.label,
    isolates: spec.isolates,
    n: seeds.length,
    completed,
    stalledSeeds,
    medianTurns: median(turnsList),
    p90Turns: percentile(turnsList, 90),
    maxTurns: turnsList.length > 0 ? Math.max(...turnsList) : 0,
    vpToWin,
    scoredAtVpToWin: scoreAtVpToWin,
    anchorVp,
    deficitThreshold,
    comebackRate: anchoredMatches > 0 ? comebacks / anchoredMatches : 0,
    comebackRateCI: wilsonInterval(comebacks, anchoredMatches),
    medianAnchorTurn: median(anchorTurns),
    p90AnchorTurn: percentile(anchorTurns, 90),
    trailingCountHistogram,
    comebackByTrailingCount,
    zeroTrailingMatches,
    anchorMissingMatches,
    trailingSlots,
    pWinGivenTrailing: trailingSlots > 0 ? comebacks / trailingSlots : 0,
    pWinGivenTrailingCI: wilsonInterval(comebacks, trailingSlots),
    sensitivityComebackRate: sensitivityN > 0 ? sensitivityComebacks / sensitivityN : 0,
    sensitivityComebackRateCI: wilsonInterval(sensitivityComebacks, sensitivityN),
    sensitivityN,
    sensitivityTiesDropped,
    sensitivityBySeed,
    meanFinalVpGap: mean(vpGaps),
    seatWinRate: seatWins.map((w) => (completed > 0 ? w / completed : 0)),
    eventTilesInterval: profile.catchUp.eventTilesInterval,
    comebackBySeed,
    trailingCountBySeed,
    turnsBySeed,
    povertyTokensGrantedEvents,
    povertyTokensGrantedTotal,
    povertyDiscountTrades,
    povertyTokensAtEndHistogram,
  };
}

/** The paired comparison's baseline. Every arm is scored at THIS profile's cuts by default. */
export const SWEEP_BASELINE_LABEL = 'classic';

export interface SweepOptions {
  /**
   * Score every arm's anchor at this profile's `victory.vpToWin`. Defaults to
   * {@link SWEEP_BASELINE_LABEL} — the baseline every arm is compared against.
   */
  readonly scoreAtLabel?: string;
  /**
   * Opt IN to letting each arm score itself at its own `vpToWin`.
   *
   * This is the CONFOUNDED variant, and it is deliberately the one you have to
   * ask for. It reproduces the S2.2.5a artifact: `blitz` scored at `ceil(8/2)=4`
   * is measured ~17 turns earlier in the very same game than `classic` scored at
   * `ceil(10/2)=5`, and its comeback rate inflates from 11.3% to 34.8% with no
   * change in catch-up dynamics. It is retained ONLY so the story file's
   * demonstration of the artifact is reproducible from committed code.
   * `pairing.ts` refuses to McNemar arms whose cuts differ unless the caller
   * also passes `allowMismatchedCuts`.
   */
  readonly selfScored?: boolean;
}

/** Resolves the `vpToWin` whose cuts a given profile label scores at. */
function vpToWinOfLabel(label: string): number {
  const spec = SWEEP_PROFILES.find((s) => s.label === label);
  if (!spec) {
    throw new Error(
      `Unknown --score-at profile label '${label}'. Known labels: ` +
        `${SWEEP_PROFILES.map((s) => s.label).join(', ')}.`,
    );
  }
  return loadRuleProfile(spec.id as RuleProfileId | ExperimentalProfileId).victory
    .vpToWin;
}

/**
 * Runs every {@link SWEEP_PROFILES} entry over the SAME `n`-seed set — or, if
 * `profileLabels` is given, only the entries whose `label` is in that list
 * (order-preserving, so `'classic'` stays the McNemar baseline in
 * `pairing.ts` regardless of which subset is requested). Lets a caller
 * pre-register a SINGLE profile-vs-Classic comparison at a larger seed count
 * without paying for all twelve profiles (e.g. `runSweep(5000, ['classic',
 * 'friendlyRobberTest'])`). `'classic'` must be in any requested subset —
 * `pairing.ts` throws without it rather than silently re-baselining (S2.2.5a,
 * reviewer finding S-2).
 *
 * **Every arm is scored at the BASELINE's cuts by default** (S2.2.5a-follow-up):
 * a between-profile comeback contrast is only valid when both arms are measured
 * at the same point of the race, and the safe thing is the default thing. Pass
 * `{ selfScored: true }` to let each arm score itself — the confounded variant.
 */
export function runSweep(
  n: number,
  profileLabels?: readonly string[],
  options: SweepOptions = {},
): readonly ProfileSweepResult[] {
  const seeds = sweepSeeds(n);
  const specs = profileLabels
    ? SWEEP_PROFILES.filter((spec) => profileLabels.includes(spec.label))
    : SWEEP_PROFILES;
  const scoreAtVpToWin = vpToWinOfLabel(options.scoreAtLabel ?? SWEEP_BASELINE_LABEL);
  return specs.map((spec) =>
    runSweepForProfile(
      spec,
      seeds,
      options.selfScored
        ? loadRuleProfile(spec.id as RuleProfileId | ExperimentalProfileId).victory
            .vpToWin
        : scoreAtVpToWin,
    ),
  );
}
