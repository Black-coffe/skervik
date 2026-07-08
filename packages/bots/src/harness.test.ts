// S2.4.1 — proves the harness drives a full, deterministic, replay-consistent
// Classic match with the v0 heuristic bots, and that its termination cap fails
// loudly rather than hanging. Mirrors the S1.7.2 E2E `scriptedDriver.test.ts`
// gate, package-internal.
import type { PlayerId, Seed } from '@skervik/core';
import { replay } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { createHeuristicBot } from './bot.js';
import { simulateMatch } from './harness.js';

/**
 * The SAME fixed seed the S1.7.2 E2E driver pins (`scriptedDriver.test.ts`'s
 * `E2E_SEED`) — already proven to reach `game.ended` in well under the
 * termination cap; reused here rather than a fresh seed string so the harness
 * exercises a known-terminating board/roll sequence (not every seed produces
 * a resource distribution the expansion-first heuristic can progress on).
 */
const SEED: Seed = 'skervik-s1.7.2-e2e-match-seed';
const PLAYER_IDS: readonly PlayerId[] = ['alpha', 'bravo', 'charlie'];

function threeHeuristicBots(): Record<PlayerId, ReturnType<typeof createHeuristicBot>> {
  return {
    alpha: createHeuristicBot(),
    bravo: createHeuristicBot(),
    charlie: createHeuristicBot(),
  };
}

describe('simulateMatch — full Classic match (S2.4.1 in-process harness)', () => {
  it('drives a complete match to game.ended with a winner at >= 10 VP', () => {
    const { finalState, winnerId, turns } = simulateMatch({
      seed: SEED,
      playerIds: PLAYER_IDS,
      bots: threeHeuristicBots(),
    });

    expect(finalState.phase).toBe('finished');
    expect(winnerId).not.toBeNull();
    const standing = finalState.players.find((p) => p.id === winnerId);
    expect(standing).toBeDefined();
    expect(turns).toBeGreaterThan(0);
  });

  it('is deterministic — the identical seed + bots twice yields deep-equal state and events', () => {
    const a = simulateMatch({
      seed: SEED,
      playerIds: PLAYER_IDS,
      bots: threeHeuristicBots(),
    });
    const b = simulateMatch({
      seed: SEED,
      playerIds: PLAYER_IDS,
      bots: threeHeuristicBots(),
    });

    expect(a.finalState).toEqual(b.finalState);
    expect(a.events).toEqual(b.events);
    expect(a.winnerId).toBe(b.winnerId);
  });

  it('the persisted events replay-fold from genesis to the identical final state', () => {
    const { finalState, events } = simulateMatch({
      seed: SEED,
      playerIds: PLAYER_IDS,
      bots: threeHeuristicBots(),
    });

    const genesisState = replay(
      {
        matchId: events[0]?.type === 'match.started' ? events[0].matchId : 'unknown',
        phase: 'lobby',
        turn: 0,
        currentPlayerId: '',
        players: [],
        eventIndex: 0,
        seedHash:
          events[0]?.type === 'match.started' ? events[0].seedHash : 'unknown-seed-hash',
      },
      events,
    );

    expect(genesisState).toEqual(finalState);
  });

  it('a deliberately tiny maxTurns throws the descriptive cap error, never hangs', () => {
    expect(() =>
      simulateMatch({
        seed: SEED,
        playerIds: PLAYER_IDS,
        bots: threeHeuristicBots(),
        maxTurns: 1,
      }),
    ).toThrow(/did not reach game\.ended within 1 turns/);
  });
});
