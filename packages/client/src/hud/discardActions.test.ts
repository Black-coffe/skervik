import type { GameState, PlayerState } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import {
  isValidDiscardSelection,
  owesDiscard,
  requiredDiscardCount,
} from './discardActions.js';

const MY_ID = 'player-1';
const OPPONENT_ID = 'player-2';

function player(
  id: string,
  resources: Partial<PlayerState['resources']> = {},
): PlayerState {
  return {
    id,
    name: id,
    victoryPoints: 0,
    resources: { timber: 0, clay: 0, fleece: 0, barley: 0, iron: 0, ...resources },
  };
}

function baseState(overrides: Partial<GameState>): GameState {
  return {
    matchId: 'test-match',
    phase: 'robber',
    turn: 3,
    currentPlayerId: OPPONENT_ID,
    players: [player(MY_ID), player(OPPONENT_ID)],
    eventIndex: 0,
    seedHash: 'test-seed-hash',
    ...overrides,
  };
}

describe('owesDiscard', () => {
  it('is true when I am listed in playersToDiscard', () => {
    expect(owesDiscard(baseState({ playersToDiscard: [MY_ID] }), MY_ID)).toBe(true);
  });

  it('is true even on an opponent turn (not turn-gated)', () => {
    const state = baseState({
      currentPlayerId: OPPONENT_ID,
      playersToDiscard: [OPPONENT_ID, MY_ID],
    });
    expect(owesDiscard(state, MY_ID)).toBe(true);
  });

  it('is false when I am not listed', () => {
    expect(owesDiscard(baseState({ playersToDiscard: [OPPONENT_ID] }), MY_ID)).toBe(
      false,
    );
  });

  it('is false when the array is absent', () => {
    expect(owesDiscard(baseState({}), MY_ID)).toBe(false);
  });
});

describe('requiredDiscardCount', () => {
  it('is floor(handSize/2) — 8 cards -> 4', () => {
    const state = baseState({
      players: [player(MY_ID, { timber: 4, clay: 4 })], // handSize 8
      playersToDiscard: [MY_ID],
    });
    expect(requiredDiscardCount(state, MY_ID)).toBe(4);
  });

  it('rounds down — 9 cards -> 4', () => {
    const state = baseState({
      players: [player(MY_ID, { timber: 5, clay: 4 })], // handSize 9
      playersToDiscard: [MY_ID],
    });
    expect(requiredDiscardCount(state, MY_ID)).toBe(4);
  });

  it('13 cards -> 6', () => {
    const state = baseState({
      players: [player(MY_ID, { timber: 5, clay: 4, fleece: 4 })], // handSize 13
      playersToDiscard: [MY_ID],
    });
    expect(requiredDiscardCount(state, MY_ID)).toBe(6);
  });

  it('is 0 when not owing', () => {
    const state = baseState({
      players: [player(MY_ID, { timber: 8 })],
      playersToDiscard: [OPPONENT_ID],
    });
    expect(requiredDiscardCount(state, MY_ID)).toBe(0);
  });

  it('is 0 when the player is not found', () => {
    const state = baseState({ players: [], playersToDiscard: [MY_ID] });
    expect(requiredDiscardCount(state, MY_ID)).toBe(0);
  });
});

describe('isValidDiscardSelection', () => {
  const held = { timber: 5, clay: 4, fleece: 0, barley: 0, iron: 0 };

  it('accepts a selection that sums to exactly required and is within holdings', () => {
    expect(
      isValidDiscardSelection(
        { timber: 2, clay: 2, fleece: 0, barley: 0, iron: 0 },
        4,
        held,
      ),
    ).toBe(true);
  });

  it('rejects an under-count selection', () => {
    expect(
      isValidDiscardSelection(
        { timber: 1, clay: 1, fleece: 0, barley: 0, iron: 0 },
        4,
        held,
      ),
    ).toBe(false);
  });

  it('rejects an over-count selection', () => {
    expect(
      isValidDiscardSelection(
        { timber: 3, clay: 2, fleece: 0, barley: 0, iron: 0 },
        4,
        held,
      ),
    ).toBe(false);
  });

  it('rejects a selection exceeding what is held for a resource', () => {
    expect(
      isValidDiscardSelection(
        { timber: 0, clay: 0, fleece: 4, barley: 0, iron: 0 },
        4,
        held,
      ),
    ).toBe(false);
  });

  it('rejects a negative entry', () => {
    expect(
      isValidDiscardSelection(
        { timber: 6, clay: -2, fleece: 0, barley: 0, iron: 0 },
        4,
        held,
      ),
    ).toBe(false);
  });
});
