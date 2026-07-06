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
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { devFixtureState } from '../dev/devFixture.js';
import type { ConnectionStatus, VersionMismatchInfo } from './connection.js';
import { attachRoom, type RoomLike, type WsClientCallbacks } from './wsClient.js';

/**
 * A faithful mock of the `colyseus.js` `Room` message bus — no socket. Captures
 * the registered handlers so a test can drive inbound frames, and records
 * outbound `send`s / the `leave` call so the send + disconnect paths assert.
 */
class MockRoom implements RoomLike {
  sessionId = 'seat-abc';
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
