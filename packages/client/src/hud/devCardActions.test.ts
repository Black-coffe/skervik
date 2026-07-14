import type { DevCardHoldings, GameState, PlayerState } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import {
  canBuyDevCard,
  canPlayVenture,
  DEV_CARD_BUY_COST,
  myHoldings,
  playableCount,
} from './devCardActions.js';

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

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    matchId: 'test-match',
    phase: 'main',
    turn: 3,
    currentPlayerId: MY_ID,
    players: [player(MY_ID), player(OPPONENT_ID)],
    eventIndex: 0,
    seedHash: 'test-seed-hash',
    ...overrides,
  };
}

function holdings(
  held: DevCardHoldings['held'],
  boughtThisTurn: DevCardHoldings['boughtThisTurn'] = {},
): DevCardHoldings {
  return { held, boughtThisTurn };
}

describe('DEV_CARD_BUY_COST', () => {
  it('is the Classic buy cost — fleece:1, barley:1, iron:1', () => {
    expect(DEV_CARD_BUY_COST).toEqual({ fleece: 1, barley: 1, iron: 1 });
  });
});

describe('myHoldings', () => {
  it('returns the empty shape when the player has no devCards entry', () => {
    expect(myHoldings(baseState(), MY_ID)).toEqual({ held: {}, boughtThisTurn: {} });
  });

  it('returns the stored holdings when present', () => {
    const h = holdings({ knight: 2 }, { knight: 1 });
    const state = baseState({ devCards: { [MY_ID]: h } });
    expect(myHoldings(state, MY_ID)).toBe(h);
  });
});

describe('playableCount', () => {
  it('held 2 / bought 1 -> 1', () => {
    const state = baseState({
      devCards: { [MY_ID]: holdings({ knight: 2 }, { knight: 1 }) },
    });
    expect(playableCount(state, MY_ID, 'knight')).toBe(1);
  });

  it('held 1 / bought 1 -> 0 (clamped, never negative)', () => {
    const state = baseState({
      devCards: { [MY_ID]: holdings({ knight: 1 }, { knight: 1 }) },
    });
    expect(playableCount(state, MY_ID, 'knight')).toBe(0);
  });

  it('missing kind -> 0', () => {
    const state = baseState({
      devCards: { [MY_ID]: holdings({ knight: 2 }) },
    });
    expect(playableCount(state, MY_ID, 'monopoly')).toBe(0);
  });
});

describe('canBuyDevCard', () => {
  const afford = { fleece: 1, barley: 1, iron: 1 };

  it('true in main phase, my turn, affordable, deck not empty', () => {
    const state = baseState({
      phase: 'main',
      currentPlayerId: MY_ID,
      devDeckRemaining: 5,
    });
    expect(canBuyDevCard(state, afford, MY_ID)).toBe(true);
  });

  it('true when devDeckRemaining is absent (fresh match, full deck)', () => {
    const state = baseState({ phase: 'main', currentPlayerId: MY_ID });
    expect(canBuyDevCard(state, afford, MY_ID)).toBe(true);
  });

  it('false off-phase (roll)', () => {
    const state = baseState({ phase: 'roll', currentPlayerId: MY_ID });
    expect(canBuyDevCard(state, afford, MY_ID)).toBe(false);
  });

  it('false off-turn (not my turn)', () => {
    const state = baseState({ phase: 'main', currentPlayerId: OPPONENT_ID });
    expect(canBuyDevCard(state, afford, MY_ID)).toBe(false);
  });

  it('false when unaffordable (missing a required resource)', () => {
    const state = baseState({ phase: 'main', currentPlayerId: MY_ID });
    expect(canBuyDevCard(state, { fleece: 1, barley: 0, iron: 1 }, MY_ID)).toBe(false);
  });

  it('false when the deck is (advisorily) empty', () => {
    const state = baseState({
      phase: 'main',
      currentPlayerId: MY_ID,
      devDeckRemaining: 0,
    });
    expect(canBuyDevCard(state, afford, MY_ID)).toBe(false);
  });
});

describe('canPlayVenture', () => {
  it('false when a Venture was already played this turn', () => {
    const state = baseState({
      phase: 'main',
      currentPlayerId: MY_ID,
      devCardPlayedThisTurn: true,
      devCards: { [MY_ID]: holdings({ yearOfPlenty: 1 }) },
    });
    expect(canPlayVenture(state, MY_ID, 'yearOfPlenty')).toBe(false);
  });

  it('false off-turn', () => {
    const state = baseState({
      phase: 'main',
      currentPlayerId: OPPONENT_ID,
      devCards: { [MY_ID]: holdings({ yearOfPlenty: 1 }) },
    });
    expect(canPlayVenture(state, MY_ID, 'yearOfPlenty')).toBe(false);
  });

  it('false for a card bought entirely this turn (held == boughtThisTurn)', () => {
    const state = baseState({
      phase: 'main',
      currentPlayerId: MY_ID,
      devCards: { [MY_ID]: holdings({ yearOfPlenty: 1 }, { yearOfPlenty: 1 }) },
    });
    expect(canPlayVenture(state, MY_ID, 'yearOfPlenty')).toBe(false);
  });

  it('true for a yearOfPlenty held since last turn, in main, on my turn', () => {
    const state = baseState({
      phase: 'main',
      currentPlayerId: MY_ID,
      devCards: { [MY_ID]: holdings({ yearOfPlenty: 1 }) },
    });
    expect(canPlayVenture(state, MY_ID, 'yearOfPlenty')).toBe(true);
  });
});
