// S1.4.1 — GameRoom shell: seed generation, the minimal public projection,
// and join/leave/seat-cap behavior. Uses the official `@colyseus/testing`
// harness (a real Colyseus server + WS client) — this IS the Fork 4 ESM/Node
// 22 spike, exercised end to end rather than by reaching into Room internals.
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { PlayerId, PlayerState } from '@skervik/core';
import type {
  EventBatchMessage,
  RejectMessage,
  StateSnapshotMessage,
} from '@skervik/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGameServer, GAME_ROOM_NAME, type GameRoom } from '../index.js';
import { InMemoryEventSink } from './eventSink.js';

/** Gives the room's `onJoin`/`onLeave` sends a tick to reach the client. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/** A minimal empty-handed player for a crafted running-match state. */
function player(id: string): PlayerState {
  return { id: id as PlayerId, name: id, victoryPoints: 0, resources: {} };
}

/**
 * Puts the room into a minimal 2-player `main`-phase turn owned by `current`
 * — enough for the pipeline tests to exercise a real `validate`/`reduce`
 * without the (not-yet-built) match-start flow. Seats already carry each
 * client's `sessionId` as its `playerId` (S1.4.1 `onJoin`), so `a`/`b` here
 * are those same session ids.
 */
function startMainTurn(room: GameRoom, a: string, b: string, current: string): void {
  room.gameState = {
    ...room.gameState,
    phase: 'main',
    turn: 1,
    currentPlayerId: current as PlayerId,
    players: [player(a), player(b)],
    playerOrder: [a as PlayerId, b as PlayerId],
  };
  room.state.phase = 'main';
  room.state.currentPlayerId = current;
}

/** The 64-hex signature of the raw seed / its SHA-256 — must never ride a gameplay or reject message. */
const HEX64 = /[0-9a-f]{64}/;

describe('GameRoom', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    testServer = await boot(createGameServer());
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  it('boots under Node 22/ESM and lets a client join', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const client = await testServer.connectTo(room);

    expect(client.sessionId).toBeTruthy();

    await client.leave();
  });

  it('the public schema exposes ONLY seedHash/phase/currentPlayerId/seats — no seed, no resource/hand/board field', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);

    expect(Object.keys(room.state.toJSON()).sort()).toEqual([
      'currentPlayerId',
      'phase',
      'seats',
      'seedHash',
    ]);
  });

  it('onCreate generates a private seed and publishes seedHash = sha256(seed), never the raw seed', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);

    expect(room.gameState.seedHash).toBe(room.state.seedHash);
    expect(room.gameState.seedHash).toMatch(/^[0-9a-f]{64}$/);
    // `#seed` is a true JS private field — unreachable via property
    // enumeration, so the only key either state can ever carry is
    // `seedHash` (the commit), never a `seed` field with the raw value.
    expect(Object.keys(room.gameState)).not.toContain('seed');
    expect(Object.keys(room.state.toJSON())).not.toContain('seed');
  });

  it('onJoin seats deterministically and sends exactly one seed-free state.snapshot', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);

    const snapshots: StateSnapshotMessage[] = [];
    const client = await testServer.connectTo(room);
    client.onMessage('state.snapshot', (payload: StateSnapshotMessage) => {
      snapshots.push(payload);
    });
    await nextTick();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.type).toBe('state.snapshot');
    expect(snapshots[0]?.payload.matchId).toBe(room.roomId);
    expect(Object.keys(snapshots[0]?.payload ?? {})).not.toContain('seed');

    expect(room.state.seats).toHaveLength(1);
    expect(room.state.seats[0]?.seatIndex).toBe(0);
    expect(room.state.seats[0]?.connected).toBe(true);

    await client.leave();
  });

  it('onLeave marks the seat disconnected without mutating the authoritative GameState', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const client = await testServer.connectTo(room);
    await nextTick();

    const gameStateBefore = JSON.stringify(room.gameState);

    await client.leave();
    await nextTick();

    expect(room.state.seats[0]?.connected).toBe(false);
    expect(JSON.stringify(room.gameState)).toBe(gameStateBefore);
  });

  it('rejects joins past the seat cap', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, { maxSeats: 1 });
    await testServer.connectTo(room);

    await expect(testServer.connectTo(room)).rejects.toThrow();
  });

  // --- S1.4.2 authoritative intent pipeline -------------------------------

  it('a seated player’s valid intent → reduce advances state, event.batch broadcasts to ALL clients, projection refreshes', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room);
    const c2 = await testServer.connectTo(room);
    await nextTick();

    const a = c1.sessionId;
    const b = c2.sessionId;
    startMainTurn(room, a, b, a);

    const batches1: EventBatchMessage[] = [];
    const batches2: EventBatchMessage[] = [];
    c1.onMessage('event.batch', (m: EventBatchMessage) => batches1.push(m));
    c2.onMessage('event.batch', (m: EventBatchMessage) => batches2.push(m));

    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: a },
    });
    await nextTick();

    // Both clients (the actor included) received the exact same validated batch.
    expect(batches1).toHaveLength(1);
    expect(batches2).toHaveLength(1);
    expect(batches1[0]?.payload).toEqual([
      { type: 'turn.ended', index: 0, playerId: a, nextPlayerId: b },
    ]);
    expect(batches2[0]?.payload).toEqual(batches1[0]?.payload);

    // Authoritative state advanced via reduce.
    expect(room.gameState.currentPlayerId).toBe(b);
    expect(room.gameState.phase).toBe('roll');
    expect(room.gameState.eventIndex).toBe(1);

    // Public projection refreshed to match.
    expect(room.state.currentPlayerId).toBe(b);
    expect(room.state.phase).toBe('roll');

    // No seed (raw or hashed) rides the gameplay broadcast.
    expect(JSON.stringify(batches1[0])).not.toMatch(HEX64);

    await c1.leave();
    await c2.leave();
  });

  it('the log-append seam receives exactly the validated events, once, before broadcast', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room);
    const c2 = await testServer.connectTo(room);
    await nextTick();

    const a = c1.sessionId;
    startMainTurn(room, a, c2.sessionId, a);

    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: a },
    });
    await nextTick();

    const sink = room.eventSink as InMemoryEventSink;
    expect(sink.events).toEqual([
      { type: 'turn.ended', index: 0, playerId: a, nextPlayerId: c2.sessionId },
    ]);

    await c1.leave();
    await c2.leave();
  });

  it('an invalid intent → only the sender gets the RejectReason, no broadcast, state unchanged', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room);
    const c2 = await testServer.connectTo(room);
    await nextTick();

    const a = c1.sessionId;
    startMainTurn(room, a, c2.sessionId, a);
    const before = JSON.stringify(room.gameState);

    const rejects: RejectMessage[] = [];
    const batches2: EventBatchMessage[] = [];
    c1.onMessage('intent.rejected', (m: RejectMessage) => rejects.push(m));
    c2.onMessage('event.batch', (m: EventBatchMessage) => batches2.push(m));

    // rollDice from `main` is illegal — the turn already rolled (ALREADY_ROLLED).
    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.rollDice', playerId: a },
    });
    await nextTick();

    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.payload.reason).toBe('ALREADY_ROLLED');
    expect(batches2).toHaveLength(0); // no broadcast of a rejection
    expect(JSON.stringify(room.gameState)).toBe(before); // state untouched
    expect(JSON.stringify(rejects[0])).not.toMatch(HEX64); // no seed on the reject

    await c1.leave();
    await c2.leave();
  });

  it('identity binding: a seated client claiming ANOTHER player’s id is rejected, not applied', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room);
    const c2 = await testServer.connectTo(room);
    await nextTick();

    const a = c1.sessionId;
    const b = c2.sessionId;
    // It is B's turn. If the server trusted the payload's id, c1 could end B's
    // turn; because identity is bound to c1's SEAT (a), the impersonation is
    // rejected.
    startMainTurn(room, a, b, b);
    const before = JSON.stringify(room.gameState);

    const rejects: RejectMessage[] = [];
    const batches2: EventBatchMessage[] = [];
    c1.onMessage('intent.rejected', (m: RejectMessage) => rejects.push(m));
    c2.onMessage('event.batch', (m: EventBatchMessage) => batches2.push(m));

    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: b },
    });
    await nextTick();

    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.payload.reason).toBe('MALFORMED_INTENT');
    expect(batches2).toHaveLength(0);
    expect(JSON.stringify(room.gameState)).toBe(before); // B's turn was NOT ended

    await c1.leave();
    await c2.leave();
  });

  it('identity binding: an unseated sender is rejected', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room);
    await nextTick();

    const a = c1.sessionId;
    startMainTurn(room, a, 'ghost', a);
    // Drop the sender's seat — now the connection has no bound identity.
    room.state.seats.splice(0, room.state.seats.length);

    const rejects: RejectMessage[] = [];
    c1.onMessage('intent.rejected', (m: RejectMessage) => rejects.push(m));

    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: a },
    });
    await nextTick();

    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.payload.reason).toBe('UNKNOWN_PLAYER');

    await c1.leave();
  });

  it('a malformed envelope is rejected without throwing', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room);
    await nextTick();

    const rejects: RejectMessage[] = [];
    c1.onMessage('intent.rejected', (m: RejectMessage) => rejects.push(m));

    // Unknown envelope type, then a missing payload — both must be rejected,
    // never thrown out of the handler.
    c1.send('intent', {
      v: 1,
      type: 'not-an-intent',
      payload: { type: 'intent.endTurn' },
    });
    c1.send('intent', { v: 1, type: 'intent' });
    await nextTick();

    expect(rejects).toHaveLength(2);
    expect(rejects[0]?.payload.reason).toBe('MALFORMED_INTENT');
    expect(rejects[1]?.payload.reason).toBe('MALFORMED_INTENT');

    await c1.leave();
  });
});
