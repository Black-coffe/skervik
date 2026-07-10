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
  RuleProfileId,
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
import {
  clearCurrentRoomId,
  clearReconnectionToken,
  persistCurrentRoomId,
  persistReconnectionToken,
  readCurrentRoomId,
  readReconnectionToken,
} from './reconnectToken.js';

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
  /** The match's room id — the sessionStorage token-persistence key (S2.3.2, Key decision 3). */
  readonly roomId: string;
  /** The SDK's own reclaim token for THIS joined session (S2.3.2). */
  readonly reconnectionToken: string;
  onMessage(type: string, callback: (message: unknown) => void): unknown;
  send(type: string, message: unknown): void;
  onLeave(callback: (code: number) => void): unknown;
  onError(callback: (code: number, message?: string) => void): unknown;
  leave(consented?: boolean): unknown;
}

/**
 * The client-side reconnect capability {@link attachRoom} needs to recover
 * from an UNEXPECTED drop (S2.3.2) — supplied by {@link connect}, which owns
 * the real `@colyseus/sdk` `Client`, so this module stays lib-free and the
 * whole flow still unit-tests against a mock `reconnect`. `reconnect` mints a
 * BRAND NEW `RoomLike` from a persisted `reconnectionToken` (a real
 * `client.reconnect` HTTP roundtrip in production). `maxAttempts`/`backoffMs`
 * bound the retry — a few attempts with short backoff, capped well under the
 * server's 120s grace (Key decision 5).
 */
export interface ReconnectCapability {
  readonly reconnect: (token: string) => Promise<RoomLike>;
  readonly maxAttempts?: number;
  readonly backoffMs?: readonly number[];
}

// Widened for a typical outage, not just a sub-second blip (S2.3.2a nit #2):
// 8 attempts with a capped exponential backoff totals ~31.5s — a useful
// fraction of the server's 120s grace, still well-bounded and non-blocking
// (the loop always terminates to 'disconnected' on exhaustion). Exported so
// the widened budget itself is test-visible, not just its effect.
export const DEFAULT_RECONNECT_MAX_ATTEMPTS = 8;
export const DEFAULT_RECONNECT_BACKOFF_MS: readonly number[] = [
  500, 1000, 2000, 4000, 8000, 8000, 8000,
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wire a joined room to the typed callbacks. Pure over {@link RoomLike}, so a
 * mock room drives the entire fold/reject/error/leave path. Each inbound
 * message is zod-validated (the discriminant already matched the channel name,
 * but the schema guards the payload shape); a frame that fails validation is
 * dropped with a dev warning rather than propagated.
 *
 * S2.3.2: an optional {@link ReconnectCapability} lets this recover from an
 * UNEXPECTED drop — `reconnect(token)` with a bounded retry, then a
 * SYNCHRONOUS re-wire of the new room (no `await` in between) so
 * `onMessage('state.snapshot')` is registered before the server's reclaim
 * unicast can arrive (Key decision 5, the resync race). The RETURNED handle
 * stays the SAME object across a reconnect — `sendIntent`/`disconnect`
 * indirect through the current room, so a caller that stashed the handle once
 * (the store) never needs to re-fetch it after a reconnect.
 */
export function attachRoom(
  room: RoomLike,
  callbacks: WsClientCallbacks,
  reconnectCapability?: ReconnectCapability,
): WsClientHandle {
  let activeRoom = room;

  const wire = (r: RoomLike): void => {
    // Persist BEFORE the drop can happen (it's async) — covers both the
    // initial join and every successful reconnect (the SDK mints a fresh
    // token on each). Keeping it here (rather than only in `connect`) means
    // this also runs for the reconnected room, DRY. The current-room pointer
    // (S2.3.2a) rides along so a COLD load can later locate this token.
    persistReconnectionToken(r.roomId, r.reconnectionToken);
    persistCurrentRoomId(r.roomId);

    r.onMessage('state.snapshot', (message) => {
      const parsed = StateSnapshotEnvelopeSchema.safeParse(message);
      if (!parsed.success) {
        warnDrop('state.snapshot', parsed.error);
        return;
      }
      callbacks.onSnapshot(parsed.data.payload as GameState, r.sessionId as PlayerId);
    });

    r.onMessage('event.batch', (message) => {
      const parsed = EventBatchEnvelopeSchema.safeParse(message);
      if (!parsed.success) {
        warnDrop('event.batch', parsed.error);
        return;
      }
      callbacks.onBatch(parsed.data.payload as readonly GameEvent[]);
    });

    r.onMessage('intent.rejected', (message) => {
      const parsed = RejectEnvelopeSchema.safeParse(message);
      if (!parsed.success) {
        warnDrop('intent.rejected', parsed.error);
        return;
      }
      callbacks.onReject(parsed.data.payload.reason as RejectReason);
    });

    r.onMessage('intent.error', (message) => {
      const parsed = ErrorEnvelopeSchema.safeParse(message);
      if (!parsed.success) {
        warnDrop('intent.error', parsed.error);
        return;
      }
      callbacks.onError();
    });

    r.onLeave((code) => {
      const status = statusForLeaveCode(code);
      if (status === 'disconnected') {
        // A consented leave (ours via `disconnect()`, or the server's) —
        // never reconnect, forget the token (Key decision 3) and the
        // current-room pointer (S2.3.2a), so a later reload never tries to
        // resume a finished seat.
        clearReconnectionToken(r.roomId);
        clearCurrentRoomId();
        callbacks.onConnectionChange(status);
        return;
      }
      callbacks.onConnectionChange(status); // 'reconnecting'
      if (reconnectCapability) void attemptReconnect(r, reconnectCapability);
    });
    r.onError(() => callbacks.onConnectionChange('error'));
  };

  const attemptReconnect = async (
    droppedRoom: RoomLike,
    capability: ReconnectCapability,
  ): Promise<void> => {
    const token = droppedRoom.reconnectionToken;
    const maxAttempts = capability.maxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS;
    const backoffMs = capability.backoffMs ?? DEFAULT_RECONNECT_BACKOFF_MS;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const newRoom = await capability.reconnect(token);
        activeRoom = newRoom; // the returned handle now indirects through the new room
        wire(newRoom); // synchronous re-wire — no await before this (Key decision 5)
        callbacks.onConnectionChange('connected');
        return;
      } catch {
        const isLastAttempt = attempt === maxAttempts - 1;
        if (!isLastAttempt) {
          await delay(backoffMs[attempt] ?? backoffMs.at(-1) ?? 0);
        }
      }
    }
    // Grace expired / reconnect refused — terminal, no fresh-join fallback
    // (a new seat via the lobby is out of scope, S2.3.2 §"DEFER").
    clearReconnectionToken(droppedRoom.roomId);
    callbacks.onConnectionChange('disconnected');
  };

  wire(room);

  return {
    get sessionId() {
      return activeRoom.sessionId;
    },
    sendIntent: (intent) => {
      const envelope: IntentMessage = { v: 1, type: 'intent', payload: intent };
      activeRoom.send('intent', envelope);
    },
    disconnect: () => {
      activeRoom.leave(true);
    },
  };
}

/**
 * Optional anonymous guest identity (S1.7.1) forwarded in the join options —
 * DISPLAY metadata only. The authoritative seat identity is still the
 * server-assigned `sessionId`; the server accepts these as optional fields on
 * the handshake and ignores them for authoritative logic.
 */
export interface GuestJoinFields {
  readonly guestId?: string;
  readonly displayName?: string;
}

/** A bot seat's difficulty — mirrors `@skervik/bots`' `Difficulty` without a package dependency (the client never runs bot AI itself). */
export type BotDifficulty = 'easy' | 'medium' | 'hard';

/**
 * A lobby's rule-preset + bot-fill choice (S2.5.4), forwarded ONLY on a FRESH
 * `joinOrCreate` — never on the resume-first branch below (a page reload with
 * a live reconnect pointer must resume the existing match unmodified, never
 * re-apply a lobby pick to it). The server independently re-validates
 * `profileId` against its own shipping allow-list (`GameRoom.onAuth`); this
 * type only documents the wire shape the client sends.
 */
export interface LobbyJoinFields {
  readonly profileId?: RuleProfileId;
  readonly bots?: ReadonlyArray<{ readonly difficulty: BotDifficulty }>;
}

/**
 * Connect to the authoritative room. On a COLD load (a page reload, not the
 * in-tab drop S2.3.2 handles) this first tries to RESUME a held seat: if the
 * current-room pointer + a matching token were persisted by a prior join
 * (S2.3.2a), it attempts a single `client.reconnect(token)` — the token is
 * self-contained (Key decision 3), so no `roomId` is needed. On success the
 * resumed room is wired through the SAME {@link attachRoom} path as a fresh
 * join (sync handlers + `ReconnectCapability` apply identically), and the
 * server's existing reclaim/resync unicast (S2.3.2) delivers a fresh
 * `state.snapshot` that folds the board back to consistent — no server change.
 * `lobby` is INTENTIONALLY never read in this branch (S2.5.4): resuming a held
 * seat must never re-apply a lobby pick.
 * On failure (expired token / grace ran out) the pointer+token are cleared
 * and this falls through to a fresh `joinOrCreate` with the protocol-version
 * handshake (plus optional guest {@link GuestJoinFields} and lobby
 * {@link LobbyJoinFields} selection, S2.5.4). A rejected `joinOrCreate` is
 * interpreted by {@link parseJoinError} into a `version-mismatch` (with
 * versions) or a generic `error`, and returns `null` so the caller keeps its
 * fallback (dev-fixture) view. Never throws.
 */
export async function connect(
  url: string,
  callbacks: WsClientCallbacks,
  guest?: GuestJoinFields,
  lobby?: LobbyJoinFields,
): Promise<WsClientHandle | null> {
  callbacks.onConnectionChange('connecting');
  const client = new Client(url);
  // S2.3.2: `client.reconnect` (the real `@colyseus/sdk` `Client`) is the
  // reconnect capability `attachRoom` calls on an unexpected drop — kept
  // here, not in `attachRoom`, so that module never imports the SDK. Shared
  // by both the resume-first branch below and a fresh join (S2.3.2a), so
  // an in-tab drop after either path recovers the same way.
  const reconnectCapability: ReconnectCapability = {
    reconnect: async (token) => (await client.reconnect(token)) as unknown as RoomLike,
  };

  const savedRoomId = readCurrentRoomId();
  if (savedRoomId) {
    const savedToken = readReconnectionToken(savedRoomId);
    if (savedToken) {
      try {
        const room = await client.reconnect(savedToken);
        const handle = attachRoom(
          room as unknown as RoomLike,
          callbacks,
          reconnectCapability,
        );
        callbacks.onConnectionChange('connected');
        return handle;
      } catch {
        // Token expired / grace ran out — forget it and fall through to a
        // fresh join below (Key decision: a single resume attempt on cold
        // load, no retry loop here — that's the in-tab `attemptReconnect` path).
        clearCurrentRoomId();
        clearReconnectionToken(savedRoomId);
      }
    }
  }

  try {
    const room = await client.joinOrCreate(GAME_ROOM_NAME, {
      protocolVersion: PROTOCOL_VERSION,
      ...(guest?.guestId !== undefined ? { guestId: guest.guestId } : {}),
      ...(guest?.displayName !== undefined ? { displayName: guest.displayName } : {}),
      ...(lobby?.profileId !== undefined ? { profileId: lobby.profileId } : {}),
      ...(lobby?.bots !== undefined ? { bots: lobby.bots } : {}),
    });
    const handle = attachRoom(
      room as unknown as RoomLike,
      callbacks,
      reconnectCapability,
    );
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
