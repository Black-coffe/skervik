// S2.5.2 — ready-up: host-started private matches. A private room's ONLY
// start trigger is its host (seat 0 / the room's creator) sending the bare
// `startMatch` control message — `#maybeAutoStart` skips a private room
// entirely, even once every seat is technically full. On a valid press, any
// still-empty seats are bot-filled (reusing the SAME `#mintBotSeat` genesis
// path S2.4.3's `bots` option already exercises — see `botFill.e2e.test.ts`),
// then the EXISTING `#startMatch` genesis pipeline fires. Quick-match
// (`isPrivate` absent/false) is unchanged — every existing GameRoom/e2e test
// proves that untouched; this file adds one direct confirmation alongside
// the four criteria above.
//
// Uses the SAME `createRoom` + `connectTo` trusted-internal pattern as
// `botFill.e2e.test.ts`/`botFillSafeLeave.e2e.test.ts` (real distinct
// `sessionId`s per client, real `onJoin`/`onMessage` dispatch) rather than
// the full `sdk` matchmaker path — this story doesn't touch `onAuth`'s wire
// allow-list, so the trusted-internal path is the right layer.
import { ColyseusTestServer } from '@colyseus/testing';
import type { EventBatchMessage, StateSnapshotMessage } from '@skervik/protocol';
import { PROTOCOL_VERSION } from '@skervik/protocol';
import type { Server } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGameServer, GAME_ROOM_NAME, type GameRoom } from '../index.js';

/** Gives the room's queued async work a tick to settle (mirrors the other E2E files). */
function nextTick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Own port (2574) — never collides with the other E2E files' ports (2569-2573). */
async function bootOnPort(gameServer: Server, port: number): Promise<ColyseusTestServer> {
  await gameServer.listen(port);
  return new ColyseusTestServer(gameServer);
}

const CONNECT_OPTS = { protocolVersion: PROTOCOL_VERSION } as const;

describe('ready-up: host-started private matches (S2.5.2)', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    testServer = await bootOnPort(createGameServer(), 2574);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  // --- criterion 3: no auto-start on a partial fill --------------------------

  it("[forcing] a private room with 2/4 seats stays in 'lobby' with no match.started until the host acts", async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      isPrivate: true,
      maxSeats: 4,
    });
    const host = await testServer.connectTo(room, CONNECT_OPTS);
    const friend = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    expect(room.state.seats).toHaveLength(2);
    expect(room.gameState.phase).toBe('lobby');

    await host.leave();
    await friend.leave();
  });

  // --- criterion 1: host start begins a 2-human private match ----------------

  it('[forcing] the host sending startMatch bot-fills the 2 empty seats and begins the match — match.started is emitted, the 2 new seats are isBot:true, phase leaves lobby. Fails today with no manual start.', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      isPrivate: true,
      maxSeats: 4,
    });
    const host = await testServer.connectTo(room, CONNECT_OPTS);
    const friend = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const batches: EventBatchMessage[] = [];
    host.onMessage('event.batch', (m: EventBatchMessage) => batches.push(m));

    host.send('startMatch', {});
    await nextTick();

    expect(room.gameState.phase).not.toBe('lobby');
    expect(room.state.seats).toHaveLength(4);

    const started = batches
      .flatMap((b) => b.payload)
      .find((e) => e.type === 'match.started');
    expect(started).toBeDefined();

    const humanIds = new Set([host.sessionId, friend.sessionId]);
    const filledSeats = room.state.seats.filter((s) => !humanIds.has(s.playerId));
    expect(filledSeats).toHaveLength(2);
    for (const seat of filledSeats) {
      expect(seat.isBot).toBe(true);
      expect(seat.botDifficulty).not.toBe('');
    }

    await host.leave();
    await friend.leave();
  });

  // --- criterion 2: a non-host cannot start -----------------------------------

  it('[forcing] a non-host sending startMatch is ignored — the room stays in lobby, no seats are bot-filled', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      isPrivate: true,
      maxSeats: 4,
    });
    const host = await testServer.connectTo(room, CONNECT_OPTS);
    const friend = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    friend.send('startMatch', {});
    await nextTick();

    expect(room.gameState.phase).toBe('lobby');
    expect(room.state.seats).toHaveLength(2);

    await host.leave();
    await friend.leave();
  });

  // --- criterion 4: quick-match is unchanged ----------------------------------

  it('[forcing] a quick-match (non-private) room still auto-starts on seats-full — no startMatch message needed', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 2,
    });
    const p1 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();
    expect(room.gameState.phase).toBe('lobby'); // 1/2 seats — not yet

    const p2 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    expect(room.gameState.phase).not.toBe('lobby'); // auto-started on seats-full

    await p1.leave();
    await p2.leave();
  });

  // --- isHost / isPrivate transport signals (state.snapshot, S2.5.2) ---------

  it('[forcing] state.snapshot carries isHost:true for seat 0 (the creator) and isHost:false for a later joiner, both isPrivate:true for a private room', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      isPrivate: true,
      maxSeats: 4,
    });

    const hostSnapshots: StateSnapshotMessage[] = [];
    const host = await testServer.connectTo(room, CONNECT_OPTS);
    host.onMessage('state.snapshot', (m: StateSnapshotMessage) => hostSnapshots.push(m));
    await nextTick();

    const friendSnapshots: StateSnapshotMessage[] = [];
    const friend = await testServer.connectTo(room, CONNECT_OPTS);
    friend.onMessage('state.snapshot', (m: StateSnapshotMessage) =>
      friendSnapshots.push(m),
    );
    await nextTick();

    expect(hostSnapshots[0]?.isHost).toBe(true);
    expect(hostSnapshots[0]?.isPrivate).toBe(true);
    expect(friendSnapshots[0]?.isHost).toBe(false);
    expect(friendSnapshots[0]?.isPrivate).toBe(true);

    await host.leave();
    await friend.leave();
  });

  it('[forcing] state.snapshot carries isPrivate:false for a plain (non-private) room', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, { maxSeats: 4 });

    const snapshots: StateSnapshotMessage[] = [];
    const client = await testServer.connectTo(room, CONNECT_OPTS);
    client.onMessage('state.snapshot', (m: StateSnapshotMessage) => snapshots.push(m));
    await nextTick();

    expect(snapshots[0]?.isHost).toBe(true); // seat 0, no manual-start meaning here
    expect(snapshots[0]?.isPrivate).toBe(false);

    await client.leave();
  });
});
