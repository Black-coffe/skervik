// UI-state store (S1.6.3 → S1.6.4 → wired live in S1.6.5) — zustand. Holds the
// CURRENT `GameState` plus `myPlayerId`. Before a connection it renders the dev
// fixture (fallback view); once joined, `gameState` is seeded from the server's
// `state.snapshot` and advanced ONLY by folding broadcast `event.batch`es
// through core `reduce` (ADR-0009 Fork 1 — the client rebuilds state exactly
// like the server, never a hand-maintained mirror). The store never invents
// authoritative state. S1.6.4's UI-only trade state (the `dispatchIntent` seam,
// `tradeLog`, `pendingSeal`) rides on top; S1.6.5 fills the seam with a real WS
// send and reconciles `pendingSeal` on the server's echo (§7.6 server-truth).

import type {
  GameEvent,
  GameState,
  PlayerId,
  PlayerIntent,
  RejectReason,
  TileId,
  TradeOffer,
} from '@skervik/core';
import { reduce } from '@skervik/core';
import { create } from 'zustand';

import type { BuildMode } from '../board/buildLegality.js';
import { devFixtureState } from '../dev/devFixture.js';
import type { ConnectionStatus, VersionMismatchInfo } from '../net/connection.js';
import type { WsClientHandle } from '../net/wsClient.js';
import type { QuickReaction, TradeLogEntry } from './trade.js';
import { tradeLogEntryFromIntent } from './trade.js';

/**
 * The "pending seal" marker (DESIGN.md §7.6): once the local player seals or
 * accepts, the offer is *pending* until the server's echo of the corresponding
 * trade event folds in (server truth). S1.6.5 clears it on that echo OR on an
 * `intent.rejected`/`intent.error` (the deal didn't seal). The UI renders a
 * visibly-distinct state and never treats the deal as confirmed.
 */
export interface PendingSeal {
  readonly intentType: PlayerIntent['type'];
  readonly turn: number;
}

/**
 * A dismissable, localized failure notice (§7.6 / §10). A `reject` carries the
 * `validate` {@link RejectReason} (mapped to a `reject.*` string, with a generic
 * fallback for the long tail); an `error` is an infrastructure failure
 * ("try again"). This is the trace of a failed dispatch — the store records the
 * failure HERE rather than inventing a new `tradeLog` kind (which would cascade
 * into the S1.6.4 Trade-UI's exhaustive status map, out of this story's scope).
 */
export type UiNotice =
  { readonly kind: 'reject'; readonly reason: RejectReason } | { readonly kind: 'error' };

export interface UiStore {
  readonly gameState: GameState;
  readonly myPlayerId: PlayerId;
  /** Live connection lifecycle (DESIGN.md §6) — shown in the HUD, localized. */
  readonly connectionStatus: ConnectionStatus;
  /** The reported versions behind a `version-mismatch`, for "update required". */
  readonly versionMismatch: VersionMismatchInfo | null;
  /** The live WS handle once joined (`null` in the dev-fixture/no-server view). */
  readonly connection: WsClientHandle | null;
  /** Ordered trade trace (§7.4) — every dispatched trade action, newest last. */
  readonly tradeLog: readonly TradeLogEntry[];
  /** Set while a sealed/accepted deal awaits the server echo (§7.6). */
  readonly pendingSeal: PendingSeal | null;
  /** The current dismissable failure notice, if any (§7.6). */
  readonly notice: UiNotice | null;
  /**
   * S2.5.2: `true` when I am this room's host (seat 0 / the private room's
   * creator) — a transport-only signal folded from `state.snapshot`'s
   * `isHost`, never derived from `gameState` (host/ready/lock are session
   * concerns, not game rules). `false` before any snapshot arrives.
   */
  readonly isHost: boolean;
  /**
   * S2.5.2: `true` when this room is manual-start only (created with
   * `isPrivate:true`), folded from `state.snapshot`'s `isPrivate`. `false`
   * (quick match's default) before any snapshot arrives.
   */
  readonly isPrivateRoom: boolean;
  /**
   * S2.8.3b: the MAIN-phase build submode — UI-ONLY (which piece kind's board
   * picking is armed), never part of `gameState` and never sent to the server.
   * Lives here (not in a component) because two sibling HUD pieces share it:
   * `BottomDeck` (the «Строить» selector) SETS it, `GameScreen`/`useBuildPlacement`
   * READS it to arm board picking. `'none'` = no active build.
   */
  readonly buildMode: BuildMode;
  /**
   * S2.8.4a: the tile awaiting a robber steal-victim choice — UI-ONLY (set when
   * the human clicks a tile that has ≥1 eligible victim, cleared once the
   * `intent.moveRobber` is dispatched or «Отмена» is pressed). Never part of
   * `gameState`, never sent except inside the resolved `moveRobber`. Lives here
   * (not in a component) so it survives `GameScreen`'s phase re-routing between
   * board picking and the victim picker; cleared on `applySnapshot` (a fresh
   * match join) — NOT on `setGameState`/event folds — so a stale pending tile
   * can never leak across matches (the S2.8.3b review nit). `null` = no pending
   * tile (board picking active).
   */
  readonly robberPendingTile: TileId | null;
  /**
   * S2.8.5a: whether the «Предприятие» (Venture) hand panel is open —
   * UI-ONLY, never part of `gameState`, never sent to the server. Lives here
   * (not in a component) for the same "two sibling HUD pieces share it"
   * reason as `buildMode`: `BottomDeck` (the «Предприятие» toggle) SETS it,
   * `GameScreen` READS it to render `<VenturePanel/>`. `false` = closed.
   */
  readonly ventureOpen: boolean;
  readonly setGameState: (next: GameState) => void;
  /** Set (or clear with `'none'`) the UI-only build submode. Never touches `gameState`. */
  readonly setBuildMode: (mode: BuildMode) => void;
  /** Set (or clear with `null`) the UI-only pending robber tile. Never touches `gameState`. */
  readonly setRobberPendingTile: (tileId: TileId | null) => void;
  /** Open/close the UI-only Venture hand panel. Never touches `gameState`. */
  readonly setVentureOpen: (open: boolean) => void;
  /**
   * The scope seam (S1.6.4 → S1.6.5). Composing/responding in the Trade UI
   * produces a typed {@link PlayerIntent} handed here. It records the intent as
   * a `tradeLog` trace entry, flips the local `pendingSeal` PREVIEW (never a
   * confirm — §7.6), and, WHEN CONNECTED, sends it to the authoritative server;
   * the authoritative result returns as a folded `event.batch` (which clears the
   * pending seal) or an `intent.rejected`/`intent.error` (which also clears it).
   * With no connection (dev-fixture view) the send is a no-op — the preview
   * simply persists. The Trade-UI components that call `dispatchIntent(...)` are
   * unchanged; only this body gained the send.
   */
  readonly dispatchIntent: (intent: PlayerIntent) => void;
  /** Predefined bounded quick-reaction (§7.3) — annotates the trace (no free-text). */
  readonly sendReaction: (reaction: QuickReaction) => void;
  /**
   * Seed `gameState` + the real seat id from a joining `state.snapshot`, plus
   * the S2.5.2 transport-only `isHost`/`isPrivate` signals.
   */
  readonly applySnapshot: (
    state: GameState,
    myPlayerId: PlayerId,
    isHost: boolean,
    isPrivate: boolean,
  ) => void;
  /** Fold a broadcast `event.batch` through core `reduce` (ordered/idempotent). */
  readonly applyEventBatch: (events: readonly GameEvent[]) => void;
  /** Update the shown connection status (+ optional version info). */
  readonly setConnectionStatus: (
    status: ConnectionStatus,
    versionMismatch?: VersionMismatchInfo | null,
  ) => void;
  /** Store (or clear) the live WS handle used by `dispatchIntent` to send. */
  readonly setConnection: (connection: WsClientHandle | null) => void;
  /** Reconcile a `validate` rejection: clear the pending seal + raise a notice. */
  readonly applyReject: (reason: RejectReason) => void;
  /** Reconcile an infra failure: clear the pending seal + raise a generic notice. */
  readonly applyIntentError: () => void;
  /** Dismiss the current failure notice. */
  readonly dismissNotice: () => void;
}

/**
 * `myPlayerId` is a DEV CONSTANT fallback (S1.6.3): the first seat in the fixed
 * seating order, so the dev-fixture view renders without a server. A real join
 * REPLACES it with `room.sessionId` via {@link UiStore.applySnapshot}.
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

/**
 * `true` when a folded batch carries the SERVER ECHO that seals my pending
 * action (§7.6 server-truth): my own `trade.offered` (for a propose/counter I
 * sent — the counter makes ME the new proposer) or a `trade.executed` I
 * accepted. Only my own echo clears MY pending seal.
 */
function batchSealsPending(
  pendingSeal: PendingSeal | null,
  events: readonly GameEvent[],
  myPlayerId: PlayerId,
): boolean {
  if (!pendingSeal) return false;
  const awaitingOffer =
    pendingSeal.intentType === 'intent.proposeTrade' ||
    pendingSeal.intentType === 'intent.counterTrade';
  for (const event of events) {
    if (
      pendingSeal.intentType === 'intent.acceptTrade' &&
      event.type === 'trade.executed' &&
      event.accepterId === myPlayerId
    ) {
      return true;
    }
    if (
      awaitingOffer &&
      event.type === 'trade.offered' &&
      event.proposerId === myPlayerId
    ) {
      return true;
    }
  }
  return false;
}

export const useUiStore = create<UiStore>((set, get) => ({
  gameState: devFixtureState,
  myPlayerId: DEV_MY_PLAYER_ID,
  connectionStatus: 'disconnected',
  versionMismatch: null,
  connection: null,
  tradeLog: [],
  pendingSeal: null,
  notice: null,
  isHost: false,
  isPrivateRoom: false,
  buildMode: 'none',
  robberPendingTile: null,
  ventureOpen: false,
  setGameState: (next) => set({ gameState: next }),
  setBuildMode: (mode) => set({ buildMode: mode }),
  setRobberPendingTile: (tileId) => set({ robberPendingTile: tileId }),
  setVentureOpen: (open) => set({ ventureOpen: open }),
  dispatchIntent: (intent) => {
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
    });
    // Real WS send (S1.6.5). Kept OUT of the `set` updater (side-effect-free
    // updates) and after it, so the optimistic preview is applied first. A
    // no-op when there's no live connection (the dev-fixture view still works).
    get().connection?.sendIntent(intent);
  },
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
  applySnapshot: (next, myPlayerId, isHost, isPrivate) =>
    set({
      gameState: next,
      myPlayerId,
      isHost,
      isPrivateRoom: isPrivate,
      // Clear UI-only pending robber tile on a fresh join — never leak across
      // matches (heeding the S2.8.3b review nit: clear on JOIN, not on every
      // event fold via `setGameState`).
      robberPendingTile: null,
      // Same discipline for the Venture panel (S2.8.5a) — never leave it open
      // across a fresh match join.
      ventureOpen: false,
    }),
  applyEventBatch: (events) =>
    set((state) => {
      const first = events[0];
      // Idempotency/ordering guard (a cheap snapshot/batch race guard): a batch
      // whose first event index is behind our applied count (`eventIndex`) was
      // already folded — drop it. `eventIndex` is the count of events applied,
      // i.e. the index of the NEXT expected event.
      if (first === undefined || first.index < state.gameState.eventIndex) {
        return {};
      }
      const gameState = events.reduce((s, event) => reduce(s, event), state.gameState);
      const pendingSeal = batchSealsPending(state.pendingSeal, events, state.myPlayerId)
        ? null
        : state.pendingSeal;
      // S2.8.4a review nit: the robber phase can end WITHOUT the local player
      // completing their victim pick (the ~35s turn-timer force-resolves it
      // server-side, or the mover was someone else). Clear the UI-only
      // `robberPendingTile` on the phase-OUT transition ONLY (previous state
      // was 'robber', next state isn't) — never while still IN 'robber' (that
      // would wipe an in-progress victim choice mid-phase).
      const robberPendingTile =
        state.gameState.phase === 'robber' && gameState.phase !== 'robber'
          ? null
          : state.robberPendingTile;
      return { gameState, pendingSeal, robberPendingTile };
    }),
  setConnectionStatus: (status, versionMismatch = null) =>
    set({ connectionStatus: status, versionMismatch }),
  setConnection: (connection) => set({ connection }),
  applyReject: (reason) => set({ pendingSeal: null, notice: { kind: 'reject', reason } }),
  applyIntentError: () => set({ pendingSeal: null, notice: { kind: 'error' } }),
  dismissNotice: () => set({ notice: null }),
}));

/**
 * S2.5.2: the uniform client transition signal — flip to `<GameScreen>` once
 * the room's phase leaves `'lobby'`, for EVERY join mode (quick match /
 * create private / join by code alike), replacing S2.5.4a's quickMatch-only
 * connect-time flip (which could show a blank `<GameScreen>` before
 * `gameState` existed). Pure so `App.tsx`'s routing is unit-tested without a
 * React render — zustand v5's static-render snapshot can never observe a
 * later `setState()` (see `lobby/lobbyStore.ts`'s `deriveLobbyViewState` doc).
 */
export function shouldShowGame(phase: GameState['phase']): boolean {
  return phase !== 'lobby';
}

/**
 * S2.7.1: `true` only in the `'main'` phase — the sole phase p2p/bank trade
 * intents are legal in (`packages/core` `validate.ts`). Gates the whole trade
 * dock (offer builder + incoming-offer card, both live inside `<TradeZone>`)
 * out of the DOM in every other phase, so it never covers the Chart with an
 * offer builder that has nothing legal to propose (DESIGN.md §6/§7). Pure so
 * `GameScreen.tsx`'s gating is unit-tested without a React render.
 */
export function canShowTradeDock(phase: GameState['phase']): boolean {
  return phase === 'main';
}

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
