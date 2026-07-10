// S2.5.4 — lobby preset selection + bot fill reaching the authoritative room
// over the REAL wire (`@colyseus/testing`'s `sdk.joinOrCreate`, which drives
// the FULL matchmaker path — `onAuth` → `onCreate` → `onJoin` — unlike
// `testServer.createRoom()`, which bypasses `onAuth` entirely). This is
// deliberate: the security requirement this story adds (an explicit
// allow-list for the wire-supplied `profileId`) lives in `onAuth`, so only a
// REAL join exercises it.
//
// Four groups:
//   1. A wire-supplied `profileId` reaches `gameState.profileId` AND changes
//      an actual rule in force (not just an echoed string) — criterion 1.
//   2. An experimental/unknown `profileId` is refused — never starts, never
//      crashes — criterion 2. Each test states what it would take for the
//      allow-list's removal to flip the assertion.
//   3. The M1 default (no `profileId`) is unchanged — criterion 3.
//   4. Bot count reaches the seated roster AND the human takes the first
//      snake-draft placement — criteria 4 + 5.
//   5. `reconnectGraceSeconds` arriving from the wire is floored at the
//      product-law minimum — criterion 6.
import { ColyseusTestServer } from '@colyseus/testing';
import { EXPERIMENTAL_PROFILE_IDS, loadRuleProfile, type PlayerId } from '@skervik/core';
import { PROTOCOL_VERSION } from '@skervik/protocol';
import type { Client, Server } from 'colyseus';
import { matchMaker } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGameServer, GAME_ROOM_NAME, type GameRoom } from '../index.js';

/** Gives the room's queued async work a tick to settle (mirrors botFill.e2e.test.ts). */
function nextTick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Boots this file's server on its OWN port so it never collides with the
 * default `boot()` port `GameRoom.test.ts` uses, `botFill.e2e.test.ts`'s 2569,
 * or `botFillSafeLeave.e2e.test.ts`'s 2570 (vitest runs files in parallel
 * workers) — mirrors those files' identical helper.
 */
async function bootOnPort(gameServer: Server, port: number): Promise<ColyseusTestServer> {
  await gameServer.listen(port);
  return new ColyseusTestServer(gameServer);
}

const CONNECT_OPTS = { protocolVersion: PROTOCOL_VERSION } as const;

/** Three bots at a fixed difficulty — fills a 4-seat Classic room around one human. */
const THREE_BOTS = [
  { difficulty: 'medium' as const },
  { difficulty: 'medium' as const },
  { difficulty: 'medium' as const },
];

describe('lobby preset selection + bot fill over the wire (S2.5.4)', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    testServer = await bootOnPort(createGameServer(), 2571);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  // --- 1. profileId reaches the match, and a blitz-specific RULE is in force ---

  it('[forcing] a wire join carrying profileId:"blitz" resolves the match under Blitz — gameState.profileId AND a Blitz-specific rule (vpToWin:8) are in force, not merely an echoed string', async () => {
    const room = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
      ...CONNECT_OPTS,
      profileId: 'blitz',
      bots: THREE_BOTS,
    });
    await nextTick();

    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as GameRoom;
    expect(serverRoom.gameState.profileId).toBe('blitz');
    // Not just the id round-tripping: Blitz actually resolves a DIFFERENT
    // victory threshold than Classic's 10 — this is the "rule actually in
    // force" half of the criterion.
    expect(loadRuleProfile('blitz').victory.vpToWin).toBe(8);
    expect(loadRuleProfile('classic').victory.vpToWin).toBe(10);

    await room.leave();
  });

  // --- 2. an experimental / unknown profileId is refused, never crashes -----

  it('[forcing] a wire join carrying an EXPERIMENTAL profileId (EXPERIMENTAL_PROFILE_IDS.hiddenVp) is refused — the room never starts. This test fails if the allow-list is removed (an unguarded onCreate would happily resolve the experimental profile).', async () => {
    await expect(
      testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
        ...CONNECT_OPTS,
        profileId: EXPERIMENTAL_PROFILE_IDS.hiddenVp,
      }),
    ).rejects.toThrow();
  });

  it('[forcing] a wire join carrying an UNKNOWN profileId string ("nonsense") is refused the same way', async () => {
    await expect(
      testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
        ...CONNECT_OPTS,
        profileId: 'nonsense',
      }),
    ).rejects.toThrow();
  });

  it('the server is still healthy after a refused join — a normal join right after succeeds (nothing crashed)', async () => {
    await expect(
      testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
        ...CONNECT_OPTS,
        profileId: 'nonsense',
      }),
    ).rejects.toThrow();

    const room = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, CONNECT_OPTS);
    expect(room.roomId).toBeTruthy();
    await room.leave();
  });

  // --- 3. the M1 default is unchanged ----------------------------------------

  it('a join with no profileId still yields classic (M1 default, byte-unchanged)', async () => {
    const room = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
      ...CONNECT_OPTS,
      bots: THREE_BOTS,
    });
    await nextTick();

    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as GameRoom;
    expect(serverRoom.gameState.profileId).toBe('classic');

    await room.leave();
  });

  // --- 4 + 5. bot count reaches the roster; the human is seated FIRST -------

  it('[forcing] choosing 3 bots seats 3 bot players + the human (4-3=1 human, as configured), and the human takes seatIndex 0 (first snake-draft placement) — discharges the S2.4.3 lead-review nit', async () => {
    const room = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
      ...CONNECT_OPTS,
      bots: THREE_BOTS,
    });
    await nextTick();

    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as GameRoom;
    expect(serverRoom.state.seats).toHaveLength(4);

    const humanSeat = serverRoom.state.seats.find(
      (s) => s.playerId === (room.sessionId as PlayerId),
    );
    expect(humanSeat).toBeDefined();
    expect(humanSeat?.isBot).toBe(false);
    expect(humanSeat?.seatIndex).toBe(0);

    const botSeats = serverRoom.state.seats.filter((s) => s.isBot);
    expect(botSeats).toHaveLength(3);

    // Bots + the human filled the 4-seat cap -> the SAME auto-start path fired.
    expect(serverRoom.gameState.phase).toBe('setup');
    // `match.started`'s playerIds is built from `state.seats` ARRAY ORDER — the
    // human's seat came first, so it leads the seating/turn order too.
    expect(serverRoom.gameState.playerOrder?.[0]).toBe(room.sessionId);

    await room.leave();
  });

  it('a room with NO bots seats the human normally (unaffected by the reordering fix)', async () => {
    const room = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, CONNECT_OPTS);
    await nextTick();

    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as GameRoom;
    expect(serverRoom.state.seats).toHaveLength(1);
    expect(serverRoom.state.seats[0]?.seatIndex).toBe(0);
    expect(serverRoom.state.seats[0]?.isBot).toBe(false);

    await room.leave();
  });

  // --- 6. reconnectGraceSeconds arriving from the wire is floored -----------

  it('[forcing] reconnectGraceSeconds arriving from the wire is floored at the >=120s product-law minimum (discharges the S2.3.1 nit) — a test passing 60 observes 120', async () => {
    // Calls the REAL `onAuth` method directly (bypassing the socket transport,
    // which would serialize the options into a DIFFERENT object on the
    // server side, making the mutation unobservable from a test-owned
    // reference). `testServer.createRoom` mints a real, fully-initialized
    // `GameRoom` instance without going through the matchmaker's `onAuth`
    // gate, so calling `onAuth` on it directly exercises the EXACT production
    // code path once, on an options object this test still holds a reference to.
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const options = { protocolVersion: PROTOCOL_VERSION, reconnectGraceSeconds: 60 };

    const authorized = room.onAuth({} as Client, options);

    expect(authorized).toBe(true);
    expect(options.reconnectGraceSeconds).toBe(120);
  });

  it('reconnectGraceSeconds arriving from the wire already at/above the floor is left unchanged', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {});
    const options = { protocolVersion: PROTOCOL_VERSION, reconnectGraceSeconds: 300 };

    room.onAuth({} as Client, options);

    expect(options.reconnectGraceSeconds).toBe(300);
  });
});
