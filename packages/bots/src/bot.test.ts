// S2.4.1/S2.4.2 — the `Bot` seam: structural proof the bot holds no authority
// (no seed parameter, so it structurally cannot predict future rolls/draws),
// plus a smoke check the heuristic bot answers with the shape a `Bot` always
// has. S2.4.2 moves the seam onto the scored v1 brain with a difficulty label;
// the deep strategy/difficulty behavior lives in `v1.test.ts`, the frozen-v0
// parity in the UNCHANGED S1.7.2 server E2E.
import type { GameState } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { createHeuristicBot } from './bot.js';

describe('createHeuristicBot — the Bot seam', () => {
  it('labels itself by v1 difficulty (default medium)', () => {
    expect(createHeuristicBot().id).toBe('v1-medium');
    expect(createHeuristicBot({ difficulty: 'hard' }).id).toBe('v1-hard');
    expect(createHeuristicBot({ difficulty: 'easy' }).id).toBe('v1-easy');
  });

  it('decide() is a pure function of (state, playerId) only — no seed param', () => {
    // Function.length counts declared (non-default/rest) parameters — a
    // structural guarantee the bot cannot be handed the server's secret seed.
    expect(createHeuristicBot().decide.length).toBe(2);
    expect(
      createHeuristicBot({ difficulty: 'hard', seed: 'bot-noise' }).decide.length,
    ).toBe(2);
  });

  it('returns null when the given seat has no legal move (not-my-turn / terminal states)', () => {
    const finishedState: GameState = {
      matchId: 'bot-smoke',
      phase: 'finished',
      turn: 1,
      currentPlayerId: 'alpha',
      players: [{ id: 'alpha', name: 'Alpha', victoryPoints: 0, resources: {} }],
      eventIndex: 0,
      seedHash: 'smoke-seed-hash',
    };
    expect(createHeuristicBot().decide(finishedState, 'alpha')).toBeNull();
    expect(
      createHeuristicBot({ difficulty: 'hard' }).decide(finishedState, 'alpha'),
    ).toBeNull();
  });
});
