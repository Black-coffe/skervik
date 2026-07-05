import type { GameState } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { devFixtureState } from '../dev/devFixture.js';
import { selectIsMyTurn, selectSeatOrder, useUiStore } from './store.js';

describe('useUiStore — initial state', () => {
  it('starts from the dev fixture GameState', () => {
    expect(useUiStore.getState().gameState).toBe(devFixtureState);
  });

  it('defaults myPlayerId to the first seat in playerOrder', () => {
    const expected = devFixtureState.playerOrder?.[0];
    expect(useUiStore.getState().myPlayerId).toBe(expected);
  });

  it('setGameState replaces the held GameState', () => {
    const next: GameState = { ...devFixtureState, turn: 99 };
    useUiStore.getState().setGameState(next);
    expect(useUiStore.getState().gameState.turn).toBe(99);
    // Restore, so other tests in this file (and any future ones) aren't
    // order-dependent on this mutation of the shared module-level store.
    useUiStore.getState().setGameState(devFixtureState);
  });
});

describe('selectSeatOrder', () => {
  it('returns playerOrder when present', () => {
    expect(selectSeatOrder(devFixtureState)).toEqual(devFixtureState.playerOrder);
  });

  it('falls back to players array order when playerOrder is absent', () => {
    const { playerOrder: _playerOrder, ...rest } = devFixtureState;
    const state: GameState = rest;
    expect(selectSeatOrder(state)).toEqual(state.players.map((p) => p.id));
  });
});

describe('selectIsMyTurn', () => {
  it('is true when currentPlayerId matches myPlayerId', () => {
    const state: GameState = { ...devFixtureState, currentPlayerId: 'player-2' };
    expect(selectIsMyTurn(state, 'player-2')).toBe(true);
    expect(selectIsMyTurn(state, 'player-1')).toBe(false);
  });
});
