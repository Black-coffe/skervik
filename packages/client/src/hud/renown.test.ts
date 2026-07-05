import type { GameState } from '@skervik/core';
import { CLASSIC_VICTORY_PROFILE } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { devFixtureState } from '../dev/devFixture.js';
import {
  cityCount,
  handSize,
  myHiddenVictoryPointCards,
  publicRenown,
  settlementCount,
} from './renown.js';

const BASE_STATE: GameState = {
  matchId: 'test-match',
  phase: 'main',
  turn: 3,
  currentPlayerId: 'p1',
  players: [
    { id: 'p1', name: 'p1', victoryPoints: 0, resources: {} },
    { id: 'p2', name: 'p2', victoryPoints: 0, resources: {} },
  ],
  playerOrder: ['p1', 'p2'],
  eventIndex: 0,
  seedHash: 'hash',
  buildings: {
    settlements: { v1: 'p1', v2: 'p1', v3: 'p2' },
    roads: {},
    cities: { v4: 'p1' },
  },
};

describe('renown — settlement/city counts', () => {
  it('counts only the owning player’s settlements/cities', () => {
    expect(settlementCount(BASE_STATE, 'p1')).toBe(2);
    expect(settlementCount(BASE_STATE, 'p2')).toBe(1);
    expect(cityCount(BASE_STATE, 'p1')).toBe(1);
    expect(cityCount(BASE_STATE, 'p2')).toBe(0);
  });

  it('returns 0 for a state with no buildings yet', () => {
    const { buildings: _buildings, ...rest } = BASE_STATE;
    const empty: GameState = rest;
    expect(settlementCount(empty, 'p1')).toBe(0);
    expect(cityCount(empty, 'p1')).toBe(0);
  });
});

describe('publicRenown — the CRUX: no hidden VP leak', () => {
  it('sums settlements(1) + cities(2), with no awards held', () => {
    // p1: 2 settlements * 1 + 1 city * 2 = 4
    expect(publicRenown(BASE_STATE, 'p1')).toBe(4);
    // p2: 1 settlement * 1 = 1
    expect(publicRenown(BASE_STATE, 'p2')).toBe(1);
  });

  it('adds the longest-road award VP (from CLASSIC_VICTORY_PROFILE) when held', () => {
    const withRoad: GameState = { ...BASE_STATE, longestRoadHolder: 'p2' };
    expect(publicRenown(withRoad, 'p2')).toBe(1 + CLASSIC_VICTORY_PROFILE.longestRoadVP);
  });

  it('adds the largest-army award VP when held', () => {
    const withArmy: GameState = { ...BASE_STATE, largestArmyHolder: 'p1' };
    expect(publicRenown(withArmy, 'p1')).toBe(4 + CLASSIC_VICTORY_PROFILE.largestArmyVP);
  });

  it('adds BOTH awards when the same player holds them both', () => {
    const withBoth: GameState = {
      ...BASE_STATE,
      longestRoadHolder: 'p1',
      largestArmyHolder: 'p1',
    };
    expect(publicRenown(withBoth, 'p1')).toBe(
      4 + CLASSIC_VICTORY_PROFILE.longestRoadVP + CLASSIC_VICTORY_PROFILE.largestArmyVP,
    );
  });

  it('NEVER includes a hidden victory-point dev card in ANY player’s public renown', () => {
    // p2 holds 3 hidden VP dev cards — publicRenown for p2 must stay 1, not 4.
    const withHiddenVp: GameState = {
      ...BASE_STATE,
      devCards: { p2: { held: { victoryPoint: 3 }, boughtThisTurn: {} } },
    };
    expect(publicRenown(withHiddenVp, 'p2')).toBe(1);
    // Sanity: a caller reading state.devCards directly WOULD see the hidden
    // count — proving publicRenown deliberately ignores it, not that the
    // field is absent.
    expect(withHiddenVp.devCards?.p2?.held.victoryPoint).toBe(3);
  });
});

describe('myHiddenVictoryPointCards — own-card exception', () => {
  it('reads the given player’s own hidden VP dev-card count', () => {
    const state: GameState = {
      ...BASE_STATE,
      devCards: { p1: { held: { victoryPoint: 2 }, boughtThisTurn: {} } },
    };
    expect(myHiddenVictoryPointCards(state, 'p1')).toBe(2);
  });

  it('returns 0 when no dev cards have landed on state yet', () => {
    expect(myHiddenVictoryPointCards(BASE_STATE, 'p1')).toBe(0);
  });
});

describe('handSize', () => {
  it('sums every resource count', () => {
    expect(handSize({ timber: 2, clay: 1, iron: 0 })).toBe(3);
  });

  it('returns 0 for an empty hand', () => {
    expect(handSize({})).toBe(0);
  });
});

describe('renown against the real dev fixture', () => {
  it('never leaves a negative renown or hand size for any real player', () => {
    for (const player of devFixtureState.players) {
      expect(publicRenown(devFixtureState, player.id)).toBeGreaterThanOrEqual(0);
      expect(handSize(player.resources)).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives player-1 (the fixture’s one city owner) more renown than settlements alone', () => {
    // player-1 owns 1 city (2 VP) + whatever settlements remain (S1.6.2 fixture).
    const settlements = settlementCount(devFixtureState, 'player-1');
    const cities = cityCount(devFixtureState, 'player-1');
    expect(cities).toBe(1);
    expect(publicRenown(devFixtureState, 'player-1')).toBe(settlements * 1 + cities * 2);
  });
});
