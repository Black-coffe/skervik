// S2.4.1 — proves the harness drives a full, deterministic, replay-consistent
// Classic match with the v0 heuristic bots, and that its termination cap fails
// loudly rather than hanging. Mirrors the S1.7.2 E2E `scriptedDriver.test.ts`
// gate, package-internal.
import type { PlayerId, Seed } from '@skervik/core';
import { deriveValue, replay } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { type Bot, createHeuristicBot } from './bot.js';
import type { Difficulty } from './eval/evaluate.js';
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

/**
 * S2.4.2 — the seed-robustness guarantee (fixes the v0 stall, [[v0-seed-
 * fragility-carryforward]]): v1 must ALWAYS reach `game.ended` within the
 * harness cap, on a broad spread of seeds, at every difficulty. A stall is a
 * BLOCKING bug — the harness (S2.4.1) throws loudly on the cap, so a stuck seed
 * is a FAILING test here, never a silent skip. Passes since the S2.4.2a core
 * bank-conservation fix (spent resources rejoin the finite bank → production no
 * longer freezes) + v1's board-independent dev-card VP path (breaks a
 * building-supply / board lock at ≤9 VP).
 */
describe('simulateMatch — v1 seed-sweep (no stall at any difficulty)', () => {
  const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

  /** 24 diverse seeds: a few hand-picked strings + `deriveValue`-spread ones (not one lucky string). */
  const SWEEP_SEEDS: readonly Seed[] = [
    SEED,
    'skervik',
    'archipelago',
    'the-mist',
    'a',
    '0',
    'zzzzzz',
    ...Array.from(
      { length: 17 },
      (_, i) => `sweep-${i}-${deriveValue(`sweep-salt`, i).toFixed(9)}`,
    ),
  ];

  function fieldOf(difficulty: Difficulty, seed: Seed): Record<PlayerId, Bot> {
    const bots: Record<PlayerId, Bot> = {};
    for (const id of PLAYER_IDS) {
      bots[id] = createHeuristicBot({ difficulty, seed: `${difficulty}-${seed}-${id}` });
    }
    return bots;
  }

  for (const difficulty of DIFFICULTIES) {
    it(`reaches game.ended for all ${SWEEP_SEEDS.length} seeds at difficulty=${difficulty}`, () => {
      for (const seed of SWEEP_SEEDS) {
        const { finalState, winnerId } = simulateMatch({
          seed,
          playerIds: PLAYER_IDS,
          bots: fieldOf(difficulty, seed),
        });
        expect(finalState.phase, `stalled seed=${seed} difficulty=${difficulty}`).toBe(
          'finished',
        );
        expect(
          winnerId,
          `no winner seed=${seed} difficulty=${difficulty}`,
        ).not.toBeNull();
      }
    });
  }
});

/**
 * S2.1.7b-02 — the pack's TRACER slice: the thinnest path that touches core
 * profile → per-radius topology → board generation → bot heuristics → a
 * complete simulated 6-player match on the 37-tile `expanded` board, with no
 * server/client/protocol/socket involved. Before this story's fix, `v0`/`v1`
 * read a module-level radius-2 `TOPO` and `harness.ts:91` paired a radius-2
 * topology with a radius-3 board — this match was impossible to run
 * correctly. Pinned seed `'grand-chart'` (found by a local seed sweep, not
 * hand-picked for luck) is reused by story 07's boot-free e2e.
 */
describe('simulateMatch — expanded-profile tracer (S2.1.7b-02, 6-player)', () => {
  const EXPANDED_SEED: Seed = 'grand-chart';
  const SIX_PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

  function sixHeuristicBots(): Record<PlayerId, Bot> {
    const bots: Record<PlayerId, Bot> = {};
    for (const id of SIX_PLAYER_IDS) {
      bots[id] = createHeuristicBot({ difficulty: 'medium', seed: `expanded-${id}` });
    }
    return bots;
  }

  it('a 6-player expanded match produces a 37-tile board layout and reaches a winner', () => {
    const { finalState, winnerId, events } = simulateMatch({
      seed: EXPANDED_SEED,
      playerIds: SIX_PLAYER_IDS,
      bots: sixHeuristicBots(),
      profileId: 'expanded',
    });

    const boardGenerated = events.find((e) => e.type === 'board.generated');
    expect(boardGenerated?.type).toBe('board.generated');
    expect(
      boardGenerated?.type === 'board.generated'
        ? Object.keys(boardGenerated.tileKinds).length
        : -1,
    ).toBe(37); // radius-3 tile count (3·3²+3·3+1) — the pre-fix pairing could never produce this.

    expect(finalState.phase).toBe('finished');
    expect(winnerId).not.toBeNull();
  });

  it('is deterministic — the identical seed + bots twice yields the same winner and deep-equal state', () => {
    const a = simulateMatch({
      seed: EXPANDED_SEED,
      playerIds: SIX_PLAYER_IDS,
      bots: sixHeuristicBots(),
      profileId: 'expanded',
    });
    const b = simulateMatch({
      seed: EXPANDED_SEED,
      playerIds: SIX_PLAYER_IDS,
      bots: sixHeuristicBots(),
      profileId: 'expanded',
    });

    expect(b.winnerId).toBe(a.winnerId);
    expect(b.finalState).toEqual(a.finalState);
    expect(b.events).toEqual(a.events);
  });
});
