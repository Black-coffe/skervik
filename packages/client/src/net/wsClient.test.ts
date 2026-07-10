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
import {
  persistCurrentRoomId,
  persistReconnectionToken,
  readCurrentRoomId,
  readReconnectionToken,
} from './reconnectToken.js';
import {
  attachRoom,
  connect,
  DEFAULT_RECONNECT_BACKOFF_MS,
  DEFAULT_RECONNECT_MAX_ATTEMPTS,
  type JoinMode,
  type ReconnectCapability,
  type RoomLike,
  type WsClientCallbacks,
} from './wsClient.js';

// S2.3.2a: `connect()` imports the real `@colyseus/sdk` `Client` — mock its
// constructor so the resume-first / fresh-join branches drive against fake
// `reconnect`/`joinOrCreate` promises instead of a real socket. `vi.hoisted`
// so the mock functions exist before `vi.mock`'s factory runs (hoisting).
const { mockReconnect, mockJoinOrCreate, mockCreate, mockJoinById } = vi.hoisted(() => ({
  mockReconnect: vi.fn(),
  mockJoinOrCreate: vi.fn(),
  mockCreate: vi.fn(),
  mockJoinById: vi.fn(),
}));

vi.mock('@colyseus/sdk', () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    return {
      reconnect: mockReconnect,
      joinOrCreate: mockJoinOrCreate,
      create: mockCreate,
      joinById: mockJoinById,
    };
  }),
}));

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

  it('exposes the room id (S2.5.3 — the shareable invite code for a private host)', () => {
    const room = new MockRoom();
    room.roomId = 'room-xyz';
    const handle = attachRoom(room, makeCallbacks().callbacks);
    expect(handle.roomId).toBe('room-xyz');
  });
});

// S2.3.2 — the client half of the reconnect loop: persist the token on join,
// call `reconnect(token)` on an UNEXPECTED drop (bounded retry), re-wire the
// new room synchronously on success (Key decision 5, the resync race), and
// go terminal (disconnected, token cleared) on a consented leave or an
// exhausted retry.
describe('attachRoom — reconnect on an unexpected drop (S2.3.2)', () => {
  it('persists the reconnectionToken + the current-room pointer on a fresh join, leaving the join snapshot path unchanged', () => {
    const room = new MockRoom();
    const harness = makeCallbacks();
    attachRoom(room, harness.callbacks);

    expect(readReconnectionToken(room.roomId)).toBe(room.reconnectionToken);
    expect(readCurrentRoomId()).toBe(room.roomId);

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

  it('a consented disconnect() does not reconnect and clears the token + the current-room pointer', () => {
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
    expect(readCurrentRoomId()).toBeNull();
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

// S2.3.2a nit #2: the previous default (3 attempts, ~1s total) gave up while
// the server still holds the 120s grace. The widened default is bounded and
// non-blocking, but wide enough to ride out a real outage, and still
// terminates on exhaustion (never retries forever).
describe('attachRoom — the widened default retry budget (S2.3.2a)', () => {
  it('is bounded but wider than a sub-second blip, and an exhausted retry still terminates to disconnected', async () => {
    vi.useFakeTimers();
    const room = new MockRoom();
    const harness = makeCallbacks();
    const reconnect = vi
      .fn<ReconnectCapability['reconnect']>()
      .mockRejectedValue(new Error('outage'));

    attachRoom(room, harness.callbacks, { reconnect }); // no explicit maxAttempts/backoffMs → defaults

    room.fireLeave(1006);
    await vi.runAllTimersAsync();

    expect(DEFAULT_RECONNECT_MAX_ATTEMPTS).toBeGreaterThan(3);
    expect(DEFAULT_RECONNECT_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThan(
      10_000,
    );
    expect(reconnect).toHaveBeenCalledTimes(DEFAULT_RECONNECT_MAX_ATTEMPTS);
    expect(harness.onConnectionChange).toHaveBeenLastCalledWith('disconnected');

    vi.useRealTimers();
  });
});

// S2.3.2a — the forcing story: S2.3.2 persisted a `reconnectionToken` that was
// never actually READ in production (write-only), because a cold-loaded app
// has no `roomId` in memory to look it up with. `connect()` now tries a
// resume FIRST via the current-room pointer; these tests drive it against a
// mocked `@colyseus/sdk` `Client` (no real socket).
describe('connect — resume on a cold load (S2.3.2a)', () => {
  beforeEach(() => {
    mockReconnect.mockReset();
    mockJoinOrCreate.mockReset();
  });

  it('[forcing] a persisted current-room pointer + matching token makes connect() call client.reconnect (not joinOrCreate), wire the resumed room via attachRoom, and fold a subsequent snapshot', async () => {
    persistCurrentRoomId('room-cold');
    persistReconnectionToken('room-cold', 'saved-token');

    const resumedRoom = new MockRoom();
    resumedRoom.roomId = 'room-cold';
    resumedRoom.sessionId = 'seat-resumed';
    mockReconnect.mockResolvedValue(resumedRoom);

    const harness = makeCallbacks();
    const handle = await connect('ws://test', harness.callbacks);

    expect(mockReconnect).toHaveBeenCalledWith('saved-token');
    expect(mockJoinOrCreate).not.toHaveBeenCalled();
    expect(handle).not.toBeNull();
    expect(handle?.sessionId).toBe('seat-resumed');
    expect(harness.onConnectionChange).toHaveBeenLastCalledWith('connected');

    // Wired through the real attachRoom path — a `state.snapshot` folds.
    resumedRoom.emit('state.snapshot', snapshotEnvelope);
    expect(harness.onSnapshot).toHaveBeenCalledWith(devFixtureState, 'seat-resumed');
  });

  it('cold-load fallback: an expired token (reconnect rejects) clears the pointer+token and falls through to joinOrCreate', async () => {
    persistCurrentRoomId('room-expired');
    persistReconnectionToken('room-expired', 'stale-token');
    mockReconnect.mockRejectedValue(new Error('grace expired'));

    const freshRoom = new MockRoom();
    freshRoom.roomId = 'room-fresh';
    mockJoinOrCreate.mockResolvedValue(freshRoom);

    const harness = makeCallbacks();
    const handle = await connect('ws://test', harness.callbacks);

    expect(mockReconnect).toHaveBeenCalledWith('stale-token');
    expect(mockJoinOrCreate).toHaveBeenCalledTimes(1);
    expect(handle).not.toBeNull();
    expect(harness.onConnectionChange).toHaveBeenLastCalledWith('connected');
    expect(readReconnectionToken('room-expired')).toBeNull();
    // The fresh join re-persists its own pointer (unaffected by the clear above).
    expect(readCurrentRoomId()).toBe('room-fresh');
  });

  it('no pointer → straight to joinOrCreate (unchanged behavior, no regression)', async () => {
    const freshRoom = new MockRoom();
    mockJoinOrCreate.mockResolvedValue(freshRoom);

    const harness = makeCallbacks();
    const handle = await connect('ws://test', harness.callbacks);

    expect(mockReconnect).not.toHaveBeenCalled();
    expect(mockJoinOrCreate).toHaveBeenCalledTimes(1);
    expect(handle).not.toBeNull();
    expect(harness.onConnectionChange).toHaveBeenLastCalledWith('connected');
  });
});

// S2.5.4 — the lobby's preset + bot-fill pick rides `joinOrCreate`'s options
// on a FRESH join, and is NEVER re-applied on a resume (the resume-first
// branch calls `client.reconnect(token)`, which takes no options at all).
describe('connect — lobby selection forwarding (S2.5.4)', () => {
  beforeEach(() => {
    mockReconnect.mockReset();
    mockJoinOrCreate.mockReset();
  });

  it('[forcing] a fresh join forwards lobby.profileId + lobby.bots into joinOrCreate options', async () => {
    const freshRoom = new MockRoom();
    mockJoinOrCreate.mockResolvedValue(freshRoom);

    const harness = makeCallbacks();
    await connect('ws://test', harness.callbacks, undefined, {
      profileId: 'blitz',
      bots: [{ difficulty: 'medium' }, { difficulty: 'medium' }],
    });

    expect(mockJoinOrCreate).toHaveBeenCalledWith(
      'skervik_game',
      expect.objectContaining({
        profileId: 'blitz',
        bots: [{ difficulty: 'medium' }, { difficulty: 'medium' }],
      }),
    );
  });

  it('omits profileId/bots from joinOrCreate options when no lobby selection is given (unchanged M1 default)', async () => {
    const freshRoom = new MockRoom();
    mockJoinOrCreate.mockResolvedValue(freshRoom);

    const harness = makeCallbacks();
    await connect('ws://test', harness.callbacks);

    const [, options] = mockJoinOrCreate.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options).not.toHaveProperty('profileId');
    expect(options).not.toHaveProperty('bots');
  });

  it('[forcing] a resumable cold load NEVER re-applies a lobby selection — reconnect(token) is called with only the token, joinOrCreate is never invoked', async () => {
    persistCurrentRoomId('room-cold-lobby');
    persistReconnectionToken('room-cold-lobby', 'saved-token');

    const resumedRoom = new MockRoom();
    resumedRoom.roomId = 'room-cold-lobby';
    mockReconnect.mockResolvedValue(resumedRoom);

    const harness = makeCallbacks();
    await connect('ws://test', harness.callbacks, undefined, {
      profileId: 'blitz',
      bots: [{ difficulty: 'hard' }],
    });

    expect(mockReconnect).toHaveBeenCalledWith('saved-token');
    expect(mockReconnect).toHaveBeenCalledTimes(1);
    expect(mockJoinOrCreate).not.toHaveBeenCalled();
  });
});

// S2.5.3 — private rooms by code / invite link. Three explicit fresh-join
// branches selected by `JoinMode`; the resume-first branch (S2.3.2a) stays
// ahead of all of them, unaffected.
describe('connect — join mode (S2.5.3: quick match / create private / join by code)', () => {
  beforeEach(() => {
    mockReconnect.mockReset();
    mockJoinOrCreate.mockReset();
    mockCreate.mockReset();
    mockJoinById.mockReset();
  });

  it('no joinMode (or explicit quickMatch) calls joinOrCreate — create/joinById are never invoked (unchanged M1/M2 default, criterion 4)', async () => {
    const freshRoom = new MockRoom();
    mockJoinOrCreate.mockResolvedValue(freshRoom);

    const harness = makeCallbacks();
    await connect('ws://test', harness.callbacks, undefined, undefined, {
      kind: 'quickMatch',
    });

    expect(mockJoinOrCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockJoinById).not.toHaveBeenCalled();
  });

  it('[forcing] joinMode:createPrivate calls client.create with isPrivate:true in the wire options — joinOrCreate/joinById are never invoked', async () => {
    const hostRoom = new MockRoom();
    hostRoom.roomId = 'room-private-1';
    mockCreate.mockResolvedValue(hostRoom);

    const harness = makeCallbacks();
    const handle = await connect('ws://test', harness.callbacks, undefined, undefined, {
      kind: 'createPrivate',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      'skervik_game',
      expect.objectContaining({ isPrivate: true }),
    );
    expect(mockJoinOrCreate).not.toHaveBeenCalled();
    expect(mockJoinById).not.toHaveBeenCalled();
    // The host reads this back as the shareable code/link (criterion 5's producer half).
    expect(handle?.roomId).toBe('room-private-1');
  });

  it('[forcing] joinMode:joinByCode calls client.joinById(roomId, options) — never joinOrCreate/create, and the resulting handle carries the SAME roomId', async () => {
    const friendRoom = new MockRoom();
    friendRoom.roomId = 'room-private-1';
    mockJoinById.mockResolvedValue(friendRoom);

    const harness = makeCallbacks();
    const handle = await connect('ws://test', harness.callbacks, undefined, undefined, {
      kind: 'joinByCode',
      roomId: 'room-private-1',
    });

    expect(mockJoinById).toHaveBeenCalledWith(
      'room-private-1',
      expect.objectContaining({ protocolVersion: expect.any(String) }),
    );
    expect(mockJoinOrCreate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(handle?.roomId).toBe('room-private-1');
  });

  it('a wrong/expired code rejects cleanly — connect() returns null, nothing throws', async () => {
    mockJoinById.mockRejectedValue(new Error('room not found'));

    const harness = makeCallbacks();
    const handle = await connect('ws://test', harness.callbacks, undefined, undefined, {
      kind: 'joinByCode',
      roomId: 'does-not-exist',
    });

    expect(handle).toBeNull();
    expect(harness.onConnectionChange).toHaveBeenLastCalledWith('error', null);
  });

  it.each<JoinMode>([
    { kind: 'createPrivate' },
    { kind: 'joinByCode', roomId: 'some-other-room' },
  ])(
    '[forcing] resume-first precedence: a live reconnect pointer wins over joinMode %o — reconnect(token) is called, create/joinById/joinOrCreate are never invoked',
    async (joinMode) => {
      // Fresh pointer+token EVERY case: `attachRoom` re-persists the resumed
      // room's OWN token on success, so a shared/reused pointer across cases
      // would silently observe the PRIOR case's re-persisted token instead of
      // this case's, masking exactly the regression this test exists to catch.
      persistCurrentRoomId('room-cold-resume');
      persistReconnectionToken('room-cold-resume', 'saved-token');
      mockReconnect.mockReset();
      mockCreate.mockReset();
      mockJoinById.mockReset();
      mockJoinOrCreate.mockReset();

      const resumedRoom = new MockRoom();
      resumedRoom.roomId = 'room-cold-resume';
      mockReconnect.mockResolvedValue(resumedRoom);

      const harness = makeCallbacks();
      const handle = await connect(
        'ws://test',
        harness.callbacks,
        undefined,
        undefined,
        joinMode,
      );

      expect(mockReconnect).toHaveBeenCalledWith('saved-token');
      expect(handle?.roomId).toBe('room-cold-resume'); // resumed, NOT the requested code
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockJoinById).not.toHaveBeenCalled();
      expect(mockJoinOrCreate).not.toHaveBeenCalled();
    },
  );
});
