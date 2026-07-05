import type { GameState, TradeOffer } from '@skervik/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { devFixtureState } from '../dev/devFixture.js';
import {
  selectIsIncomingToMe,
  selectIsMyOutgoing,
  selectIsMyTurn,
  selectOpenOffer,
  selectSeatOrder,
  useUiStore,
} from './store.js';

const EMPTY = { timber: 0, clay: 0, fleece: 0, barley: 0, iron: 0 };

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

const OFFER_FROM_2: TradeOffer = {
  proposerId: 'player-2',
  give: { ...EMPTY, fleece: 3 },
  get: { ...EMPTY, iron: 1 },
  targets: ['player-1', 'player-3', 'player-4'],
  depth: 0,
};

describe('open-offer selectors', () => {
  it('selectOpenOffer returns the offer or undefined', () => {
    expect(selectOpenOffer(devFixtureState)).toBeUndefined();
    const withOffer: GameState = { ...devFixtureState, openTradeOffer: OFFER_FROM_2 };
    expect(selectOpenOffer(withOffer)).toBe(OFFER_FROM_2);
  });

  it('selectIsIncomingToMe is true only for a target who is not the proposer', () => {
    const withOffer: GameState = { ...devFixtureState, openTradeOffer: OFFER_FROM_2 };
    expect(selectIsIncomingToMe(withOffer, 'player-1')).toBe(true);
    expect(selectIsIncomingToMe(withOffer, 'player-2')).toBe(false); // the proposer
    expect(selectIsMyOutgoing(withOffer, 'player-2')).toBe(true);
    expect(selectIsMyOutgoing(withOffer, 'player-1')).toBe(false);
  });
});

describe('dispatchIntent — the S1.6.4→S1.6.5 stub seam', () => {
  beforeEach(() => {
    useUiStore.setState({ tradeLog: [], pendingSeal: null });
  });

  it('records a propose as a trace entry and enters pending-seal (no gameState mutation)', () => {
    const before = useUiStore.getState().gameState;
    useUiStore.getState().dispatchIntent({
      type: 'intent.proposeTrade',
      playerId: 'player-1',
      give: { ...EMPTY, fleece: 2 },
      get: { ...EMPTY, iron: 1 },
    });
    const s = useUiStore.getState();
    expect(s.tradeLog).toHaveLength(1);
    expect(s.tradeLog[0]).toMatchObject({ kind: 'proposed', actorId: 'player-1' });
    expect(s.pendingSeal).toMatchObject({ intentType: 'intent.proposeTrade' });
    // The stub is NOT the authority: it never touches the authoritative state.
    expect(s.gameState).toBe(before);
  });

  it('cancel/reject clear the pending-seal marker', () => {
    const store = useUiStore.getState();
    store.dispatchIntent({
      type: 'intent.proposeTrade',
      playerId: 'player-1',
      give: { ...EMPTY, fleece: 2 },
      get: { ...EMPTY, iron: 1 },
    });
    expect(useUiStore.getState().pendingSeal).not.toBeNull();
    store.dispatchIntent({ type: 'intent.cancelTrade', playerId: 'player-1' });
    const s = useUiStore.getState();
    expect(s.pendingSeal).toBeNull();
    expect(s.tradeLog.at(-1)).toMatchObject({ kind: 'cancelled' });
  });

  it('sendReaction appends a bounded reaction trace entry', () => {
    useUiStore.getState().sendReaction('tooExpensive');
    expect(useUiStore.getState().tradeLog.at(-1)).toMatchObject({
      kind: 'reaction',
      reaction: 'tooExpensive',
    });
  });
});
