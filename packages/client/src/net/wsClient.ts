// The WS net layer (S1.6.5) — the ONLY module that imports `@colyseus/sdk` (the
// 0.17 client line; migrated from `colyseus.js@0.16` per ADR-0011). It
// wraps the Colyseus `Client`/`Room` and maps the raw transport to the typed
// callbacks the store consumes, translating join/leave/error into a
// {@link ConnectionStatus}. Framework-free (no React, no zustand) so the whole
// join → snapshot → fold → send → reject/error path unit-tests against a MOCK
// room with no socket. Real cross-process wiring is E1.7; here every inbound
// frame is zod-validated at the boundary (the server is trusted, but the schema
// is the client's contract — a malformed frame must never crash the fold).
import { Client } from '@colyseus/sdk';
import type {
  GameEvent,
  GameState,
  PlayerId,
  PlayerIntent,
  RejectReason,
} from '@skervik/core';
import {
  ErrorEnvelopeSchema,
  EventBatchEnvelopeSchema,
  GAME_ROOM_NAME,
  type IntentMessage,
  PROTOCOL_VERSION,
  RejectEnvelopeSchema,
  StateSnapshotEnvelopeSchema,
} from '@skervik/protocol';

import type { ConnectionStatus, VersionMismatchInfo } from './connection.js';
import { parseJoinError, statusForLeaveCode } from './connection.js';

export interface WsClientCallbacks {
  /** A joining/late-join `state.snapshot` — seed `gameState` and the real seat id. */
  readonly onSnapshot: (state: GameState, myPlayerId: PlayerId) => void;
  /** A broadcast `event.batch` — fold through core `reduce` (ADR-0009 Fork 1). */
  readonly onBatch: (events: readonly GameEvent[]) => void;
  /** A private `intent.rejected` — a `validate` refusal (turn/afford/phase/trade…). */
  readonly onReject: (reason: RejectReason) => void;
  /** A private `intent.error` — an infra failure; state was NOT advanced. */
  readonly onError: () => void;
  /** Every connection-lifecycle transition (carries version info on mismatch). */
  readonly onConnectionChange: (
    status: ConnectionStatus,
    versionMismatch?: VersionMismatchInfo | null,
  ) => void;
}

/** The live-connection handle the app holds once joined. */
export interface WsClientHandle {
  /** The joined seat id (`room.sessionId`) — the real `myPlayerId`. */
  readonly sessionId: string;
  /** Send a `PlayerIntent` as the `{ v:1, type:'intent', payload }` envelope. */
  readonly sendIntent: (intent: PlayerIntent) => void;
  /** Cleanly leave the room (a consented disconnect). */
  readonly disconnect: () => void;
}

/**
 * The minimal `@colyseus/sdk` `Room` surface the net layer touches — declared
 * structurally so {@link attachRoom} unit-tests against a mock room with no
 * transport. `Room<T>`'s real API is far wider (state schema, reconnection);
 * we deliberately depend on only these members.
 */
export interface RoomLike {
  readonly sessionId: string;
  onMessage(type: string, callback: (message: unknown) => void): unknown;
  send(type: string, message: unknown): void;
  onLeave(callback: (code: number) => void): unknown;
  onError(callback: (code: number, message?: string) => void): unknown;
  leave(consented?: boolean): unknown;
}

/**
 * Wire a joined room to the typed callbacks. Pure over {@link RoomLike}, so a
 * mock room drives the entire fold/reject/error/leave path. Each inbound
 * message is zod-validated (the discriminant already matched the channel name,
 * but the schema guards the payload shape); a frame that fails validation is
 * dropped with a dev warning rather than propagated.
 */
export function attachRoom(room: RoomLike, callbacks: WsClientCallbacks): WsClientHandle {
  room.onMessage('state.snapshot', (message) => {
    const parsed = StateSnapshotEnvelopeSchema.safeParse(message);
    if (!parsed.success) {
      warnDrop('state.snapshot', parsed.error);
      return;
    }
    callbacks.onSnapshot(parsed.data.payload as GameState, room.sessionId as PlayerId);
  });

  room.onMessage('event.batch', (message) => {
    const parsed = EventBatchEnvelopeSchema.safeParse(message);
    if (!parsed.success) {
      warnDrop('event.batch', parsed.error);
      return;
    }
    callbacks.onBatch(parsed.data.payload as readonly GameEvent[]);
  });

  room.onMessage('intent.rejected', (message) => {
    const parsed = RejectEnvelopeSchema.safeParse(message);
    if (!parsed.success) {
      warnDrop('intent.rejected', parsed.error);
      return;
    }
    callbacks.onReject(parsed.data.payload.reason as RejectReason);
  });

  room.onMessage('intent.error', (message) => {
    const parsed = ErrorEnvelopeSchema.safeParse(message);
    if (!parsed.success) {
      warnDrop('intent.error', parsed.error);
      return;
    }
    callbacks.onError();
  });

  room.onLeave((code) => callbacks.onConnectionChange(statusForLeaveCode(code)));
  room.onError(() => callbacks.onConnectionChange('error'));

  return {
    sessionId: room.sessionId,
    sendIntent: (intent) => {
      const envelope: IntentMessage = { v: 1, type: 'intent', payload: intent };
      room.send('intent', envelope);
    },
    disconnect: () => {
      room.leave(true);
    },
  };
}

/**
 * Connect to the authoritative room: announce `connecting`, `joinOrCreate` with
 * the protocol-version handshake, and on success {@link attachRoom} + announce
 * `connected`. A rejected join is interpreted by {@link parseJoinError} into a
 * `version-mismatch` (with versions) or a generic `error`, and returns `null`
 * so the caller keeps its fallback (dev-fixture) view. Never throws.
 */
export async function connect(
  url: string,
  callbacks: WsClientCallbacks,
): Promise<WsClientHandle | null> {
  callbacks.onConnectionChange('connecting');
  const client = new Client(url);
  try {
    const room = await client.joinOrCreate(GAME_ROOM_NAME, {
      protocolVersion: PROTOCOL_VERSION,
    });
    const handle = attachRoom(room as unknown as RoomLike, callbacks);
    callbacks.onConnectionChange('connected');
    return handle;
  } catch (error) {
    const { status, versionMismatch } = parseJoinError(error);
    callbacks.onConnectionChange(status, versionMismatch);
    return null;
  }
}

function warnDrop(type: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(`[ws] dropped a malformed "${type}" message`, error);
  }
}
