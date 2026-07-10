// S2.5.3 — private rooms by code / invite link, over the REAL wire
// (`@colyseus/testing`'s `sdk`, which drives the FULL matchmaker path — unlike
// `testServer.createRoom()`, which bypasses `onAuth`/`onCreate`'s listing side
// effects entirely). Mirrors `lobbySelection.e2e.test.ts` /
// `joinOptionsSecurity.e2e.test.ts`'s pattern: these tests bind the TERMINAL
// OBSERVABLE (which room a client actually lands in / the matchmaker's own
// room-cache listing), not merely "a flag was read".
//
// Owner decision (S2.5.3 story doc): the invite "code" IS the raw Colyseus
// `roomId` — no bespoke code registry. `isPrivate:true` on `client.create`
// excludes the room from `joinOrCreate`; `client.joinById(roomId)` reaches it
// directly regardless of privacy.
import { ColyseusTestServer } from '@colyseus/testing';
import { PROTOCOL_VERSION } from '@skervik/protocol';
import type { Server } from 'colyseus';
import { matchMaker } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGameServer, GAME_ROOM_NAME, type GameRoom } from '../index.js';

/** Gives the room's queued async work a tick to settle (mirrors the other E2E files). */
function nextTick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Own port (2573) — never collides with `GameRoom.test.ts`'s default `boot()`
 * port, `botFill.e2e.test.ts`'s 2569, `botFillSafeLeave.e2e.test.ts`'s 2570,
 * `lobbySelection.e2e.test.ts`'s 2571, or `joinOptionsSecurity.e2e.test.ts`'s
 * 2572 (vitest runs test files in parallel workers).
 */
async function bootOnPort(gameServer: Server, port: number): Promise<ColyseusTestServer> {
  await gameServer.listen(port);
  return new ColyseusTestServer(gameServer);
}

const CONNECT_OPTS = { protocolVersion: PROTOCOL_VERSION } as const;

describe('private rooms by code / invite link over the wire (S2.5.3)', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    testServer = await bootOnPort(createGameServer(), 2573);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  // --- criterion 1: a private room is excluded from quick-match -------------

  it('[forcing] a private room (client.create with isPrivate:true) is never auto-matched into — a quick-match joinOrCreate right after lands in a DIFFERENT room. This test fails if GameRoom.onCreate stops calling setPrivate(true).', async () => {
    const hostRoom = await testServer.sdk.create(GAME_ROOM_NAME, {
      ...CONNECT_OPTS,
      isPrivate: true,
    });

    const strangerRoom = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, CONNECT_OPTS);

    expect(strangerRoom.roomId).not.toBe(hostRoom.roomId);

    await hostRoom.leave();
    await strangerRoom.leave();
  });

  // --- criterion 2: join-by-code reaches the exact room ----------------------

  it('[forcing] client.joinById(roomId) reaches the EXACT room a private host created — same roomId, seats now 2/4', async () => {
    const hostRoom = await testServer.sdk.create(GAME_ROOM_NAME, {
      ...CONNECT_OPTS,
      isPrivate: true,
    });

    const friendRoom = await testServer.sdk.joinById(hostRoom.roomId, CONNECT_OPTS);
    await nextTick();

    expect(friendRoom.roomId).toBe(hostRoom.roomId);
    const serverRoom = matchMaker.getLocalRoomById(hostRoom.roomId) as GameRoom;
    expect(serverRoom.state.seats).toHaveLength(2);
    expect(serverRoom.maxClients).toBe(4);

    await hostRoom.leave();
    await friendRoom.leave();
  });

  it('[forcing] joinById with a wrong/nonexistent roomId rejects cleanly — the promise rejects, nothing crashes, a normal join right after still works', async () => {
    await expect(
      testServer.sdk.joinById('this-room-does-not-exist', CONNECT_OPTS),
    ).rejects.toThrow();

    // Server health proof: a normal join right after still succeeds.
    const room = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, CONNECT_OPTS);
    expect(room.roomId).toBeTruthy();
    await room.leave();
  });

  // --- criterion 3: isPrivate survives the .strict() allow-list --------------

  it('[forcing] a wire create carrying isPrivate:true is accepted (not refused by JoinOptionsSchema.strict()) and the resulting room reports private === true in the matchmaker room cache. This test fails if isPrivate is not added to JoinLobbySelectionSchema.', async () => {
    const hostRoom = await testServer.sdk.create(GAME_ROOM_NAME, {
      ...CONNECT_OPTS,
      isPrivate: true,
    });
    await nextTick();

    const [listing] = await matchMaker.query({ roomId: hostRoom.roomId });
    expect(listing?.private).toBe(true);

    await hostRoom.leave();
  });

  it('a plain joinOrCreate room (no isPrivate) reports private as falsy — the default is unaffected', async () => {
    const room = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, CONNECT_OPTS);
    await nextTick();

    const [listing] = await matchMaker.query({ roomId: room.roomId });
    expect(listing?.private).toBeFalsy();

    await room.leave();
  });
});
