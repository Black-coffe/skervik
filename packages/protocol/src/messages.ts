// @skervik/protocol — the WS message envelope (E1.4 S1.4.1, ADR-0009 Fork 4).
// Type-only: no runtime code, no zod (validation lands in S1.5.1) — this is
// the ONE shared shape server and client import instead of each declaring
// their own wire format and drifting apart.
import type { GameEvent, GameState, PlayerIntent, RejectReason } from '@skervik/core';

/**
 * The public projection of `GameState` sent as `state.snapshot`'s payload.
 * Safe to serialize by construction: `GameState` never holds the raw seed
 * (only `seedHash` is a field — ADR-0009 Fork 3, `docs/wiki/seed-handling.md`).
 */
export type PublicGameState = GameState;

/** Client → server: a player's wish, validated server-side (S1.4.2 owns handling it). */
export interface IntentMessage {
  readonly v: 1;
  readonly type: 'intent';
  readonly payload: PlayerIntent;
}

/** Server → clients: validated events, folded through each client's own `reduce` (ADR-0009 Fork 1). */
export interface EventBatchMessage {
  readonly v: 1;
  readonly type: 'event.batch';
  readonly payload: readonly GameEvent[];
}

/** Server → one joining/late-joining client: a one-shot full public state (S1.4.1). */
export interface StateSnapshotMessage {
  readonly v: 1;
  readonly type: 'state.snapshot';
  readonly payload: PublicGameState;
}

/**
 * Server → ONLY the sender: an intent `validate` refused (S1.4.2). Sent
 * privately (never broadcast — a rejection is not a state change) and carries
 * only the public {@link RejectReason} — never the seed, never any state
 * (`validate` never returns the seed, ADR-0009 Fork 3).
 */
export interface RejectMessage {
  readonly v: 1;
  readonly type: 'intent.rejected';
  readonly payload: { readonly reason: RejectReason };
}

/** The discriminated union of every message that crosses the WS boundary. */
export type WsMessage =
  IntentMessage | EventBatchMessage | StateSnapshotMessage | RejectMessage;
