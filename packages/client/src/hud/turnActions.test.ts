import type { GameState } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { canEndTurn, canRoll } from './turnActions.js';

const MY_ID = 'player-1';
const OPPONENT_ID = 'player-2';

function baseState(overrides: Partial<GameState>): GameState {
  return {
    matchId: 'test-match',
    phase: 'roll',
    turn: 1,
    currentPlayerId: MY_ID,
    players: [],
    eventIndex: 0,
    seedHash: 'test-seed-hash',
    ...overrides,
  };
}

describe('canRoll', () => {
  it('is true in phase roll on my turn', () => {
    expect(canRoll(baseState({ phase: 'roll' }), MY_ID)).toBe(true);
  });

  it('is false in phase roll on an opponent turn', () => {
    expect(
      canRoll(baseState({ phase: 'roll', currentPlayerId: OPPONENT_ID }), MY_ID),
    ).toBe(false);
  });

  it('is false outside phase roll', () => {
    expect(canRoll(baseState({ phase: 'main' }), MY_ID)).toBe(false);
  });
});

describe('canEndTurn', () => {
  it('is true in phase main on my turn', () => {
    expect(canEndTurn(baseState({ phase: 'main' }), MY_ID)).toBe(true);
  });

  it('is false in phase main on an opponent turn', () => {
    expect(
      canEndTurn(baseState({ phase: 'main', currentPlayerId: OPPONENT_ID }), MY_ID),
    ).toBe(false);
  });

  it('is false outside phase main', () => {
    expect(canEndTurn(baseState({ phase: 'roll' }), MY_ID)).toBe(false);
  });
});
