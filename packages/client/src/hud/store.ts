// UI-state store (S1.6.3, extended S1.6.4) — zustand. Holds the CURRENT
// `GameState` (the dev fixture for now — no WS until S1.6.5) plus
// `myPlayerId`, a DEV CONSTANT until S1.6.5 wires real auth/join. The store
// never invents authoritative state: `gameState` always comes from
// core/fixture (and later the WS client). S1.6.4 adds UI-ONLY trade state on
// top — the dispatch seam (`dispatchIntent`), the trade trace (`tradeLog`),
// and the pending-seal marker (`pendingSeal`) — none of which mutate the
// authoritative `gameState`.

import type { GameState, PlayerId, PlayerIntent, TradeOffer } from '@skervik/core';
import { create } from 'zustand';

import { devFixtureState } from '../dev/devFixture.js';
import type { QuickReaction, TradeLogEntry } from './trade.js';
import { tradeLogEntryFromIntent } from './trade.js';

/**
 * The "pending seal" marker (DESIGN.md §7.6): once the local player seals or
 * accepts, the offer is *pending* until the server event returns. With no
 * server yet (S1.6.5 wires WS), it simply stays pending — the UI renders a
 * visibly-distinct state and never treats the deal as confirmed.
 */
export interface PendingSeal {
  readonly intentType: PlayerIntent['type'];
  readonly turn: number;
}

export interface UiStore {
  readonly gameState: GameState;
  readonly myPlayerId: PlayerId;
  /** Ordered trade trace (§7.4) — every dispatched trade action, newest last. */
  readonly tradeLog: readonly TradeLogEntry[];
  /** Set while a sealed/accepted deal awaits the (not-yet-wired) server echo. */
  readonly pendingSeal: PendingSeal | null;
  readonly setGameState: (next: GameState) => void;
  /**
   * The scope seam (S1.6.4 → S1.6.5). Composing/responding in the Trade UI
   * produces a typed {@link PlayerIntent} handed here. In S1.6.4 this is a
   * STUB: it records the intent as a `tradeLog` trace entry and flips the
   * local `pendingSeal` marker — it performs NO network I/O and is NOT the
   * authority (it never mutates `gameState`). S1.6.5 replaces ONLY this body
   * with WS send + server-echo reconciliation; the component layer that calls
   * `dispatchIntent(...)` does not change.
   */
  readonly dispatchIntent: (intent: PlayerIntent) => void;
  /** Predefined bounded quick-reaction (§7.3) — annotates the trace (no free-text). */
  readonly sendReaction: (reaction: QuickReaction) => void;
}

/**
 * `myPlayerId` is a DEV CONSTANT (key decision 1, S1.6.3 spec): the first
 * seat in the fixed seating order, falling back to the first `players`
 * entry the same way `GameTable`/`flotillaColors.ts` already do. S1.6.5
 * (auth/join) replaces this with the real joined player's id.
 */
const DEV_MY_PLAYER_ID: PlayerId =
  devFixtureState.playerOrder?.[0] ?? devFixtureState.players[0]?.id ?? '';

/** Which trade actions enter/leave the pending-seal state (§7.6). */
const SEALING_INTENTS: ReadonlySet<PlayerIntent['type']> = new Set([
  'intent.proposeTrade',
  'intent.counterTrade',
  'intent.acceptTrade',
]);
const CLEARING_INTENTS: ReadonlySet<PlayerIntent['type']> = new Set([
  'intent.rejectTrade',
  'intent.cancelTrade',
]);

export const useUiStore = create<UiStore>((set) => ({
  gameState: devFixtureState,
  myPlayerId: DEV_MY_PLAYER_ID,
  tradeLog: [],
  pendingSeal: null,
  setGameState: (next) => set({ gameState: next }),
  dispatchIntent: (intent) =>
    set((state) => {
      const entry = tradeLogEntryFromIntent(
        intent,
        state.gameState.openTradeOffer,
        state.gameState.turn,
        state.tradeLog.length,
      );
      const tradeLog = entry ? [...state.tradeLog, entry] : state.tradeLog;
      let pendingSeal = state.pendingSeal;
      if (SEALING_INTENTS.has(intent.type)) {
        pendingSeal = { intentType: intent.type, turn: state.gameState.turn };
      } else if (CLEARING_INTENTS.has(intent.type)) {
        pendingSeal = null;
      }
      return { tradeLog, pendingSeal };
    }),
  sendReaction: (reaction) =>
    set((state) => ({
      tradeLog: [
        ...state.tradeLog,
        {
          id: state.tradeLog.length,
          kind: 'reaction',
          actorId: state.myPlayerId,
          reaction,
          turn: state.gameState.turn,
        },
      ],
    })),
}));

/** Stable seat order for the current `gameState` — never reorder mid-match (DESIGN.md §6). */
export function selectSeatOrder(state: GameState): readonly PlayerId[] {
  return state.playerOrder ?? state.players.map((p) => p.id);
}

/** `true` when it's `myPlayerId`'s turn to act. */
export function selectIsMyTurn(state: GameState, myPlayerId: PlayerId): boolean {
  return state.currentPlayerId === myPlayerId;
}

/** The single open player↔player offer, if any (S1.3.2 puts it on `GameState`). */
export function selectOpenOffer(state: GameState): TradeOffer | undefined {
  return state.openTradeOffer;
}

/**
 * `true` when an open offer is addressed TO me by someone else — the docked
 * incoming card's trigger (offer exists, I'm a target, I'm not the proposer).
 */
export function selectIsIncomingToMe(state: GameState, myPlayerId: PlayerId): boolean {
  const offer = state.openTradeOffer;
  return !!offer && offer.proposerId !== myPlayerId && offer.targets.includes(myPlayerId);
}

/** `true` when the open offer is MY proposal (awaiting a response). */
export function selectIsMyOutgoing(state: GameState, myPlayerId: PlayerId): boolean {
  const offer = state.openTradeOffer;
  return !!offer && offer.proposerId === myPlayerId;
}
