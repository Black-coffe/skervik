// S2.4.1 — the `Bot` seam: structural proof the bot holds no authority (no
// seed parameter, so it structurally cannot predict future rolls/draws), plus
// a smoke check that the heuristic bot answers with the same shape v0 always
// has. The brain-MOVE parity itself is proven by the S1.7.2 server E2E test
// staying green unchanged (see the story's report) — that test drives the
// exact same `decideAction` this bot wraps.
import type { GameState } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { createHeuristicBot } from './bot.js';

describe('createHeuristicBot — the Bot seam', () => {
  it('has a stable id label', () => {
    expect(createHeuristicBot().id).toBe('v0');
  });

  it('decide() is a pure function of (state, playerId) only — no seed param', () => {
    // Function.length counts declared (non-default/rest) parameters — a
    // structural guarantee the bot cannot be handed the server's secret seed.
    expect(createHeuristicBot().decide.length).toBe(2);
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
  });
});
