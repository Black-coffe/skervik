import type {
  GameEvent,
  GameState,
  PlayerId,
  PlayerIntent,
  RejectReason,
} from '@skervik/core';
import type {
  EventBatchMessage,
  RejectMessage,
  StateSnapshotMessage,
} from '@skervik/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { devFixtureState } from '../dev/devFixture.js';
import type { ConnectionStatus, VersionMismatchInfo } from './connection.js';
import { CONSENTED_LEAVE_CODE } from './connection.js';
import { readReconnectionToken } from './reconnectToken.js';
import {
  attachRoom,
  type ReconnectCapability,
  type RoomLike,
  type WsClientCallbacks,
} from './wsClient.js';

/** A minimal in-memory `Storage` — this test runner has no DOM/jsdom (S2.3.2). */
class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length(): number {
    return this.#data.size;
  }
  clear(): void {
    this.#data.clear();
  }
  getItem(key: string): string | null {
    return this.#data.has(key) ? (this.#data.get(key) ?? null) : null;
  }
  key(index: number): string | null {
    return Array.from(this.#data.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.#data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#data.set(key, value);
  }
}

/**
 * A faithful mock of the `colyseus.js` `Room` message bus — no socket. Captures
 * the registered handlers so a test can drive inbound frames, and records
 * outbound `send`s / the `leave` call so the send + disconnect paths assert.
 */
class MockRoom implements RoomLike {
  sessionId = 'seat-abc';
  roomId = 'room-xyz';
  reconnectionToken = 'reconnect-token-1';
  readonly sent: Array<{ type: string; message: unknown }> = [];
  left: boolean | undefined = undefined;
  #handlers = new Map<string, (message: unknown) => void>();
  #onLeave?: (code: number) => void;
  #onError?: (code: number, message?: string) => void;

  onMessage(type: string, callback: (message: unknown) => void): void {
    this.#handlers.set(type, callback);
  }
  send(type: string, message: unknown): void {
    this.sent.push({ type, message });
  }
  onLeave(callback: (code: number) => void): void {
    this.#onLeave = callback;
  }
  onError(callback: (code: number, message?: string) => void): void {
    this.#onError = callback;
  }
  leave(consented?: boolean): void {
    this.left = consented;
  }

  // --- test drivers ---
  emit(type: string, message: unknown): void {
    const handler = this.#handlers.get(type);
    if (!handler) throw new Error(`no handler registered for "${type}"`);
    this.#handlers.get(type)?.(message);
  }
  hasHandler(type: string): boolean {
    return this.#handlers.has(type);
  }
  fireLeave(code: number): void {
    this.#onLeave?.(code);
  }
  fireError(code: number): void {
    this.#onError?.(code);
  }
}

function makeCallbacks() {
  const onSnapshot = vi.fn<(state: GameState, myPlayerId: PlayerId) => void>();
  const onBatch = vi.fn<(events: readonly GameEvent[]) => void>();
  const onReject = vi.fn<(reason: RejectReason) => void>();
  const onError = vi.fn<() => void>();
  const onConnectionChange =
    vi.fn<(status: ConnectionStatus, v?: VersionMismatchInfo | null) => void>();
  const callbacks: WsClientCallbacks = {
    onSnapshot,
    onBatch,
    onReject,
    onError,
    onConnectionChange,
  };
  return { callbacks, onSnapshot, onBatch, onReject, onError, onConnectionChange };
}

const snapshotEnvelope: StateSnapshotMessage = {
  v: 1,
  type: 'state.snapshot',
  payload: devFixtureState,
};

const batchEnvelope: EventBatchMessage = {
  v: 1,
  type: 'event.batch',
  payload: [
    {
      type: 'resources.produced',
      index: devFixtureState.eventIndex,
      grants: { 'player-2': { timber: 1 } },
      bank: {},
    },
    {
      type: 'resources.produced',
      index: devFixtureState.eventIndex + 1,
      grants: { 'player-3': { clay: 2 } },
      bank: {},
    },
  ],
};

// S2.3.2: `attachRoom` persists the reconnectionToken via `sessionStorage` on
// every wire — stub a fresh in-memory store for every test in this file (a
// no-op for the tests below that don't care) so the persist/clear tests can
// observe real writes without touching a real browser store.
beforeEach(() => {
  vi.stubGlobal('sessionStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attachRoom — inbound message wiring', () => {
  let room: MockRoom;
  let harness: ReturnType<typeof makeCallbacks>;

  beforeEach(() => {
    room = new MockRoom();
    harness = makeCallbacks();
    attachRoom(room, harness.callbacks);
  });

  it('routes state.snapshot to onSnapshot with the payload + the seat id', () => {
    room.emit('state.snapshot', snapshotEnvelope);
    expect(harness.onSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.onSnapshot).toHaveBeenCalledWith(devFixtureState, 'seat-abc');
  });

  it('routes event.batch to onBatch with the exact events array', () => {
    room.emit('event.batch', batchEnvelope);
    expect(harness.onBatch).toHaveBeenCalledTimes(1);
    expect(harness.onBatch).toHaveBeenCalledWith(batchEnvelope.payload);
  });

  it('routes intent.rejected to onReject with the reason', () => {
    const reject: RejectMessage = {
      v: 1,
      type: 'intent.rejected',
      payload: { reason: 'NOT_YOUR_TURN' },
    };
    room.emit('intent.rejected', reject);
    expect(harness.onReject).toHaveBeenCalledWith('NOT_YOUR_TURN');
  });

  it('routes intent.error to onError', () => {
    room.emit('intent.error', {
      v: 1,
      type: 'intent.error',
      payload: { code: 'INTERNAL_ERROR' },
    });
    expect(harness.onError).toHaveBeenCalledTimes(1);
  });

  it('drops a malformed frame instead of propagating it', () => {
    room.emit('state.snapshot', {
      v: 1,
      type: 'state.snapshot',
      payload: { nope: true },
    });
    expect(harness.onSnapshot).not.toHaveBeenCalled();
  });

  it('maps an unexpected leave to reconnecting and a consented leave to disconnected', () => {
    room.fireLeave(1006);
    expect(harness.onConnectionChange).toHaveBeenLastCalledWith('reconnecting');
    room.fireLeave(4000);
    expect(harness.onConnectionChange).toHaveBeenLastCalledWith('disconnected');
  });

  it('maps a transport error to the error status', () => {
    room.fireError(1011);
    expect(harness.onConnectionChange).toHaveBeenLastCalledWith('error');
  });
});

describe('attachRoom — the returned handle', () => {
  it('sends an intent as the { v:1, type:"intent", payload } envelope', () => {
    const room = new MockRoom();
    const handle = attachRoom(room, makeCallbacks().callbacks);
    const intent: PlayerIntent = {
      type: 'intent.proposeTrade',
      playerId: 'seat-abc',
      give: { fleece: 2 },
      get: { iron: 1 },
    };
    handle.sendIntent(intent);
    expect(room.sent).toEqual([
      { type: 'intent', message: { v: 1, type: 'intent', payload: intent } },
    ]);
  });

  it('exposes the seat id and leaves consented on disconnect', () => {
    const room = new MockRoom();
    const handle = attachRoom(room, makeCallbacks().callbacks);
    expect(handle.sessionId).toBe('seat-abc');
    handle.disconnect();
    expect(room.left).toBe(true);
  });
});

// S2.3.2 — the client half of the reconnect loop: persist the token on join,
// call `reconnect(token)` on an UNEXPECTED drop (bounded retry), re-wire the
// new room synchronously on success (Key decision 5, the resync race), and
// go terminal (disconnected, token cleared) on a consented leave or an
// exhausted retry.
describe('attachRoom — reconnect on an unexpected drop (S2.3.2)', () => {
  it('persists the reconnectionToken on a fresh join, leaving the join snapshot path unchanged', () => {
    const room = new MockRoom();
    const harness = makeCallbacks();
    attachRoom(room, harness.callbacks);

    expect(readReconnectionToken(room.roomId)).toBe(room.reconnectionToken);

    room.emit('state.snapshot', snapshotEnvelope);
    expect(harness.onSnapshot).toHaveBeenCalledWith(devFixtureState, room.sessionId);
  });

  it('an unexpected drop calls reconnect(token) with the persisted token; on resolve it re-wires the new room synchronously (a snapshot folds) and status goes reconnecting → connected', async () => {
    const room = new MockRoom();
    const reconnectedRoom = new MockRoom();
    reconnectedRoom.sessionId = 'seat-abc-2';
    reconnectedRoom.roomId = room.roomId;
    reconnectedRoom.reconnectionToken = 'reconnect-token-2';
    const harness = makeCallbacks();
    const reconnect = vi
      .fn<ReconnectCapability['reconnect']>()
      .mockResolvedValue(reconnectedRoom);

    const handle = attachRoom(room, harness.callbacks, { reconnect, maxAttempts: 1 });

    room.fireLeave(1006); // an unexpected close (not the consented code)
    expect(harness.onConnectionChange).toHaveBeenLastCalledWith('reconnecting');
    expect(reconnect).toHaveBeenCalledWith(room.reconnectionToken);

    await vi.waitFor(() => {
      expect(harness.onConnectionChange).toHaveBeenLastCalledWith('connected');
    });

    // Re-wired synchronously on resolve — the handler was registered in time
    // to fold this message (proves the resync race is won, Key decision 5).
    expect(reconnectedRoom.hasHandler('state.snapshot')).toBe(true);
    reconnectedRoom.emit('state.snapshot', snapshotEnvelope);
    expect(harness.onSnapshot).toHaveBeenCalledWith(devFixtureState, 'seat-abc-2');

    // The ORIGINAL handle now indirects through the reconnected room — a
    // caller that stashed it once (the store) never needs a fresh handle.
    expect(handle.sessionId).toBe('seat-abc-2');
  });

  it('a consented disconnect() does not reconnect and clears the token', () => {
    const room = new MockRoom();
    const harness = makeCallbacks();
    const reconnect = vi.fn<ReconnectCapability['reconnect']>();
    const handle = attachRoom(room, harness.callbacks, { reconnect });

    handle.disconnect();
    expect(room.left).toBe(true);
    room.fireLeave(CONSENTED_LEAVE_CODE);

    expect(reconnect).not.toHaveBeenCalled();
    expect(harness.onConnectionChange).toHaveBeenLastCalledWith('disconnected');
    expect(readReconnectionToken(room.roomId)).toBeNull();
  });

  it('reconnect failure (the bounded retry is exhausted) goes terminal: disconnected, token cleared', async () => {
    const room = new MockRoom();
    const harness = makeCallbacks();
    const reconnect = vi
      .fn<ReconnectCapability['reconnect']>()
      .mockRejectedValue(new Error('server refused the reclaim'));

    attachRoom(room, harness.callbacks, { reconnect, maxAttempts: 1 });

    room.fireLeave(1006);
    await vi.waitFor(() => {
      expect(harness.onConnectionChange).toHaveBeenLastCalledWith('disconnected');
    });

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(readReconnectionToken(room.roomId)).toBeNull();
  });

  it('retries within the bounded attempt count before succeeding', async () => {
    const room = new MockRoom();
    const reconnectedRoom = new MockRoom();
    reconnectedRoom.roomId = room.roomId;
    const harness = makeCallbacks();
    const reconnect = vi
      .fn<ReconnectCapability['reconnect']>()
      .mockRejectedValueOnce(new Error('first attempt fails'))
      .mockResolvedValueOnce(reconnectedRoom);

    attachRoom(room, harness.callbacks, { reconnect, maxAttempts: 2, backoffMs: [0] });

    room.fireLeave(1006);
    await vi.waitFor(() => {
      expect(reconnect).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(harness.onConnectionChange).toHaveBeenLastCalledWith('connected');
    });
  });
});
