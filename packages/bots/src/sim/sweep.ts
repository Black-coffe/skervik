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
  let comebacks = 0;
  let completed = 0;

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
      continue;
    }

    completed += 1;
    turnsList.push(result.turns);

    const midpoint = midpointPublicVp(result.events, result.finalState, SWEEP_PLAYER_IDS);
    const trailingAtMidpoint = lastPlacePlayers(midpoint, SWEEP_PLAYER_IDS);
    if (result.winnerId !== null && trailingAtMidpoint.includes(result.winnerId)) {
      comebacks += 1;
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
  };
}

/** Runs every {@link SWEEP_PROFILES} entry over the SAME `n`-seed set. */
export function runSweep(n: number): readonly ProfileSweepResult[] {
  const seeds = sweepSeeds(n);
  return SWEEP_PROFILES.map((spec) => runSweepForProfile(spec, seeds));
}
