// S2.2.5 Constraints 2 & 3 (forcing checks) — a measured "no effect" is
// worthless if the mechanic never fired. These prove each swept flag ACTUALLY
// triggers under simulateMatch's profileId option, at a small seed count
// (Constraint 7 — not the long sweep). Not the full sweep library test —
// `sweep.test.ts` covers the sweep's own shape/determinism.
import type { GameEvent, PlayerId, Seed } from '@skervik/core';
import { deriveValue, EXPERIMENTAL_PROFILE_IDS } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { type Bot, createHeuristicBot } from '../bot.js';
import { simulateMatch } from '../harness.js';

const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4'];

function hardField(seed: Seed): Record<PlayerId, Bot> {
  const bots: Record<PlayerId, Bot> = {};
  for (const id of PLAYER_IDS) {
    bots[id] = createHeuristicBot({ difficulty: 'hard', seed: `hard-${seed}-${id}` });
  }
  return bots;
}

/** A handful of deterministic seeds — a broad-enough spread that a rare condition still fires at least once. */
const FORCING_SEEDS: readonly Seed[] = Array.from(
  { length: 10 },
  (_, i) => `liveness-${i}-${deriveValue('sim-liveness-salt', i).toFixed(9)}`,
);

function hasEvent(events: readonly GameEvent[], type: string): boolean {
  return events.some((e) => e.type === type);
}

describe('balance-sim profile liveness (S2.2.5)', () => {
  it('AC2: profileId "balanced" produces finalState.balancedRollsDrawn > 0', () => {
    const seed = FORCING_SEEDS[0]!;
    const { finalState } = simulateMatch({
      seed,
      playerIds: PLAYER_IDS,
      bots: hardField(seed),
      profileId: 'balanced',
    });

    expect(finalState.balancedRollsDrawn ?? 0).toBeGreaterThan(0);
  });

  it('robinHoodTest fires at least one poverty.tokensGranted across the forcing seed set', () => {
    let fired = false;
    for (const seed of FORCING_SEEDS) {
      const { events } = simulateMatch({
        seed,
        playerIds: PLAYER_IDS,
        bots: hardField(seed),
        profileId: EXPERIMENTAL_PROFILE_IDS.robinHood,
      });
      if (hasEvent(events, 'poverty.tokensGranted')) {
        fired = true;
        break;
      }
    }
    expect(fired).toBe(true);
  });

  it('eventTilesRobinHoodTest produces finalState.sevensRolled > 0 (advances ONLY under eventTiles:true)', () => {
    let fired = false;
    for (const seed of FORCING_SEEDS) {
      const { finalState } = simulateMatch({
        seed,
        playerIds: PLAYER_IDS,
        bots: hardField(seed),
        profileId: EXPERIMENTAL_PROFILE_IDS.eventTilesRobinHood,
      });
      if ((finalState.sevensRolled ?? 0) > 0) {
        fired = true;
        break;
      }
    }
    expect(fired).toBe(true);
  });

  it('finalRoundTest fires at least one game.finalRoundStarted across the forcing seed set', () => {
    let fired = false;
    for (const seed of FORCING_SEEDS) {
      const { events } = simulateMatch({
        seed,
        playerIds: PLAYER_IDS,
        bots: hardField(seed),
        profileId: EXPERIMENTAL_PROFILE_IDS.finalRound,
      });
      if (hasEvent(events, 'game.finalRoundStarted')) {
        fired = true;
        break;
      }
    }
    expect(fired).toBe(true);
  });
});
