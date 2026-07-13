// S2.5.5 — quick-match segregates rooms by rule preset, over the REAL wire
// (`@colyseus/testing`'s `sdk.joinOrCreate`, which drives the FULL matchmaker
// path — `onAuth` → `onCreate` → `onJoin` — unlike `testServer.createRoom()`,
// which bypasses matching entirely). Mirrors `lobbySelection.e2e.test.ts` /
// `privateRooms.e2e.test.ts`'s pattern: these tests bind the TERMINAL
// OBSERVABLE (which room a client actually lands in), not merely "a field was
// stored".
//
// The defect this closes: `gameServer.define(...)` had no `.filterBy(...)`, so
// `joinOrCreate` ignored the client-requested `profileId` and pooled every
// quick-match into whatever public room had a free seat — a Blitz pick could
// land in an open Classic room and silently run Classic. `.filterBy(['profileId'])`
// on BOTH `define()` sites (`index.ts`'s `createGameServer` — exercised here —
// and `boot.ts`'s production boot, same API, same fix) makes `joinOrCreate`
// only reuse a room whose creation `profileId` equals the joiner's request.
import { ColyseusTestServer } from '@colyseus/testing';
import { loadRuleProfile } from '@skervik/core';
import { PROTOCOL_VERSION } from '@skervik/protocol';
import type { Server } from 'colyseus';
import { matchMaker } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGameServer, GAME_ROOM_NAME, type GameRoom } from '../index.js';

/** Gives the room's queued async work a tick to settle (mirrors the sibling E2E files). */
function nextTick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Own port (2575) — never collides with the other room E2E files' fixed ports
 * (2569..2574, vitest runs test files in parallel workers).
 */
async function bootOnPort(gameServer: Server, port: number): Promise<ColyseusTestServer> {
  await gameServer.listen(port);
  return new ColyseusTestServer(gameServer);
}

const CONNECT_OPTS = { protocolVersion: PROTOCOL_VERSION } as const;

/** Two bots — combined with the two human joins below, fills the 4-seat room exactly. */
const TWO_BOTS = [{ difficulty: 'medium' as const }, { difficulty: 'medium' as const }];

describe('quick-match segregates rooms by preset (S2.5.5, filterBy(profileId))', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    testServer = await bootOnPort(createGameServer(), 2575);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  // --- AC1: different presets never pool into the same open room ------------

  it("[forcing] a classic quick-match and a blitz quick-match land in DIFFERENT rooms — a Blitz pick is never seated into an open Classic room. This test fails if .filterBy(['profileId']) is removed from the define() call.", async () => {
    const classicRoom = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
      ...CONNECT_OPTS,
      profileId: 'classic',
    });
    const blitzRoom = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
      ...CONNECT_OPTS,
      profileId: 'blitz',
    });

    expect(classicRoom.roomId).not.toBe(blitzRoom.roomId);

    await classicRoom.leave();
    await blitzRoom.leave();
  });

  // --- AC1 (same bucket) + AC2: the shared room honors the requested preset --

  it('[forcing] two blitz quick-matches land in the SAME room (bucket reuse, up to the seat cap), and that room actually RUNS blitz — never silently downgraded to classic', async () => {
    // The room-creating join brings 2 bots (options.bots is only read at
    // onCreate) so 1 human + 2 bots + the SECOND human below exactly fills the
    // 4-seat cap, firing the genesis batch that resolves `gameState.profileId`.
    const first = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
      ...CONNECT_OPTS,
      profileId: 'blitz',
      bots: TWO_BOTS,
    });
    const second = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
      ...CONNECT_OPTS,
      profileId: 'blitz',
    });
    await nextTick();

    expect(second.roomId).toBe(first.roomId);

    const serverRoom = matchMaker.getLocalRoomById(first.roomId) as GameRoom;
    expect(serverRoom.gameState.profileId).toBe('blitz');
    // Not just the id round-tripping: Blitz actually resolves a DIFFERENT
    // victory threshold than Classic's 10 — the "rule actually in force" half.
    expect(loadRuleProfile('blitz').victory.vpToWin).toBe(8);
    expect(loadRuleProfile('classic').victory.vpToWin).toBe(10);

    await first.leave();
    await second.leave();
  });
});
