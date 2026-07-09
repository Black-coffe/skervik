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
  lastPlacePlayers,
  mean,
  median,
  midpointPublicVp,
  percentile,
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

/** Named salt for the `deriveValue`-derived seed set — recorded in the report header for reproducibility. */
export const SWEEP_SEED_SALT = 'balance-sim-salt';

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
  /** Share of COMPLETED matches where the midpoint-last-place player(s) included the winner. */
  readonly comebackRate: number;
  readonly meanFinalVpGap: number;
  /** Win share by seat index (0..3), over completed matches. */
  readonly seatWinRate: readonly number[];
  readonly eventTilesInterval: number;
  /**
   * Per-seed comeback outcome, ALIGNED WITH the sweep's own seed order (same
   * index as the shared seed list) — `null` for a stalled seed. Feeds the
   * paired (McNemar-style) discordant-pair comparison against Classic
   * (`pairing.ts`) — a marginal comebackRate delta alone can't tell whether
   * two profiles disagree on the SAME seeds or merely have the same rate by
   * coincidence.
   */
  readonly comebackBySeed: ReadonlyArray<boolean | null>;
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

/** Runs one profile's sweep over the shared `seeds` set. */
export function runSweepForProfile(
  spec: ProfileSweepSpec,
  seeds: readonly Seed[],
): ProfileSweepResult {
  const turnsList: number[] = [];
  const stalledSeeds: Seed[] = [];
  const vpGaps: number[] = [];
  const seatWins = SWEEP_PLAYER_IDS.map(() => 0);
  const comebackBySeed: Array<boolean | null> = [];
  let comebacks = 0;
  let completed = 0;
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
      continue;
    }

    completed += 1;
    turnsList.push(result.turns);

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

    const midpoint = midpointPublicVp(result.events, result.finalState, SWEEP_PLAYER_IDS);
    const trailingAtMidpoint = lastPlacePlayers(midpoint, SWEEP_PLAYER_IDS);
    const isComeback =
      result.winnerId !== null && trailingAtMidpoint.includes(result.winnerId);
    if (isComeback) comebacks += 1;
    comebackBySeed.push(isComeback);

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

  // Cast: `ProfileSweepSpec.id` is untyped `string` (shipping ids + measurement
  // ids share one field) — the registry key, not the type, is what resolves it
  // (same precedent as every internal test profile's `X as RuleProfileId`).
  const profile = loadRuleProfile(spec.id as RuleProfileId | ExperimentalProfileId);

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
    comebackRate: completed > 0 ? comebacks / completed : 0,
    meanFinalVpGap: mean(vpGaps),
    seatWinRate: seatWins.map((w) => (completed > 0 ? w / completed : 0)),
    eventTilesInterval: profile.catchUp.eventTilesInterval,
    comebackBySeed,
    povertyTokensGrantedEvents,
    povertyTokensGrantedTotal,
    povertyDiscountTrades,
    povertyTokensAtEndHistogram,
  };
}

/** Runs every {@link SWEEP_PROFILES} entry over the SAME `n`-seed set. */
export function runSweep(n: number): readonly ProfileSweepResult[] {
  const seeds = sweepSeeds(n);
  return SWEEP_PROFILES.map((spec) => runSweepForProfile(spec, seeds));
}
