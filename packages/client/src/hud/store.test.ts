import type {
  GameState,
  ResourcesProducedEvent,
  TradeExecutedEvent,
  TradeOffer,
  TradeOfferedEvent,
} from '@skervik/core';
import { reduce } from '@skervik/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('when connected, dispatchIntent forwards the intent to the net layer', () => {
    const sendIntent = vi.fn();
    useUiStore.setState({
      connection: {
        sessionId: 'seat-x',
        roomId: 'room-x',
        sendIntent,
        disconnect: vi.fn(),
      },
    });
    const intent = { type: 'intent.cancelTrade', playerId: 'player-1' } as const;
    useUiStore.getState().dispatchIntent(intent);
    expect(sendIntent).toHaveBeenCalledWith(intent);
    useUiStore.setState({ connection: null });
  });
});

// --- S1.6.5 live-wire wiring -------------------------------------------------

const RP = (
  index: number,
  grants: ResourcesProducedEvent['grants'],
): ResourcesProducedEvent => ({
  type: 'resources.produced',
  index,
  grants,
  bank: {},
});

describe('applySnapshot / applyEventBatch — the live wire', () => {
  beforeEach(() => {
    useUiStore.setState({
      gameState: devFixtureState,
      myPlayerId: devFixtureState.playerOrder?.[0] ?? 'player-1',
      pendingSeal: null,
    });
  });

  it('applySnapshot seeds gameState and the real seat id', () => {
    useUiStore.getState().applySnapshot(devFixtureState, 'seat-42');
    expect(useUiStore.getState().gameState).toBe(devFixtureState);
    expect(useUiStore.getState().myPlayerId).toBe('seat-42');
  });

  it('applyEventBatch folds a real multi-event batch identically to server-side reduce', () => {
    const base = devFixtureState.eventIndex;
    const events = [
      RP(base, { 'player-2': { timber: 1 } }),
      RP(base + 1, { 'player-3': { clay: 2 } }),
    ];
    useUiStore.getState().applySnapshot(devFixtureState, 'seat-x');
    useUiStore.getState().applyEventBatch(events);

    const expected = events.reduce((s, e) => reduce(s, e), devFixtureState);
    expect(useUiStore.getState().gameState).toEqual(expected);
    expect(useUiStore.getState().gameState.eventIndex).toBe(base + 2);
  });

  it('drops a stale/re-delivered batch (first event index behind the applied count)', () => {
    const base = devFixtureState.eventIndex;
    useUiStore.getState().applySnapshot(devFixtureState, 'seat-x');
    useUiStore.getState().applyEventBatch([RP(base, { 'player-2': { timber: 1 } })]);
    const afterFirst = useUiStore.getState().gameState;

    // A batch whose first index (base) is behind the now-applied count (base+1).
    useUiStore.getState().applyEventBatch([RP(base, { 'player-4': { iron: 9 } })]);
    expect(useUiStore.getState().gameState).toBe(afterFirst); // untouched
  });

  it('ignores an empty batch', () => {
    const before = useUiStore.getState().gameState;
    useUiStore.getState().applyEventBatch([]);
    expect(useUiStore.getState().gameState).toBe(before);
  });
});

describe('pendingSeal reconciliation (§7.6 server-truth)', () => {
  const base = devFixtureState.eventIndex;

  beforeEach(() => {
    useUiStore.setState({ gameState: devFixtureState, notice: null, pendingSeal: null });
  });

  it('clears on my own trade.offered echo (a sealed propose/counter)', () => {
    useUiStore.setState({
      myPlayerId: 'player-1',
      pendingSeal: { intentType: 'intent.proposeTrade', turn: 0 },
    });
    const echo: TradeOfferedEvent = {
      type: 'trade.offered',
      index: base,
      proposerId: 'player-1',
      give: { fleece: 2 },
      get: { iron: 1 },
      targets: ['player-2'],
      depth: 0,
    };
    useUiStore.getState().applyEventBatch([echo]);
    expect(useUiStore.getState().pendingSeal).toBeNull();
  });

  it('clears on my own trade.executed echo (a sealed accept)', () => {
    useUiStore.setState({
      myPlayerId: 'player-2',
      pendingSeal: { intentType: 'intent.acceptTrade', turn: 0 },
    });
    const echo: TradeExecutedEvent = {
      type: 'trade.executed',
      index: base,
      proposerId: 'player-1',
      accepterId: 'player-2',
      give: { fleece: 1 },
      get: { iron: 1 },
    };
    useUiStore.getState().applyEventBatch([echo]);
    expect(useUiStore.getState().pendingSeal).toBeNull();
  });

  it("does NOT clear on someone else's trade.offered echo", () => {
    useUiStore.setState({
      myPlayerId: 'player-1',
      pendingSeal: { intentType: 'intent.proposeTrade', turn: 0 },
    });
    const echo: TradeOfferedEvent = {
      type: 'trade.offered',
      index: base,
      proposerId: 'player-3',
      give: { barley: 1 },
      get: { clay: 1 },
      targets: ['player-1'],
      depth: 0,
    };
    useUiStore.getState().applyEventBatch([echo]);
    expect(useUiStore.getState().pendingSeal).not.toBeNull();
  });

  it('applyReject clears the pending seal and raises a localized reject notice', () => {
    useUiStore.setState({ pendingSeal: { intentType: 'intent.acceptTrade', turn: 0 } });
    useUiStore.getState().applyReject('CANNOT_AFFORD');
    expect(useUiStore.getState().pendingSeal).toBeNull();
    expect(useUiStore.getState().notice).toEqual({
      kind: 'reject',
      reason: 'CANNOT_AFFORD',
    });
  });

  it('applyIntentError clears the pending seal and raises a generic error notice', () => {
    useUiStore.setState({ pendingSeal: { intentType: 'intent.proposeTrade', turn: 0 } });
    useUiStore.getState().applyIntentError();
    expect(useUiStore.getState().pendingSeal).toBeNull();
    expect(useUiStore.getState().notice).toEqual({ kind: 'error' });
  });

  it('dismissNotice clears the current notice', () => {
    useUiStore.getState().applyIntentError();
    useUiStore.getState().dismissNotice();
    expect(useUiStore.getState().notice).toBeNull();
  });
});

describe('setConnectionStatus', () => {
  it('sets the status and carries version info only for a mismatch', () => {
    useUiStore.getState().setConnectionStatus('version-mismatch', {
      serverVersion: '0.0.2',
      clientVersion: '0.0.1',
    });
    expect(useUiStore.getState().connectionStatus).toBe('version-mismatch');
    expect(useUiStore.getState().versionMismatch).toEqual({
      serverVersion: '0.0.2',
      clientVersion: '0.0.1',
    });

    useUiStore.getState().setConnectionStatus('connected');
    expect(useUiStore.getState().connectionStatus).toBe('connected');
    expect(useUiStore.getState().versionMismatch).toBeNull();
  });
});
