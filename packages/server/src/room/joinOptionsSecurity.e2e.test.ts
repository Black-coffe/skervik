// Security follow-up to S2.5.4 (`[[room-options-are-client-input]]`) — closes
// the wire-trust gap for EVERY `GameRoomOptions` field, not just `profileId`.
// `GameRoom.onCreate` reads `seed`/`maxSeats`/`botActionCap`/`botFillDifficulty`
// directly off the raw join options with NO runtime check of its own; since
// Colyseus hands a client's `joinOrCreate` options to `onCreate` verbatim, a
// hand-rolled client could — on `main`, before this fix — create a room with
// an ATTACKER-CHOSEN seed. Every die roll derives deterministically from
// `seed` + event index, so the attacker would know every future roll while
// commit-reveal still "verifies" (the server honestly reveals whatever seed
// it was handed) — the exact reputational failure provably-fair RNG exists to
// prevent.
//
// `GameRoom.onAuth` now runs the join options through `JoinOptionsSchema`
// (STRICT: protocol handshake fields + lobby-selection fields, nothing else)
// as its FINAL gate. These tests bind the TERMINAL OBSERVABLE — the actual
// `seedHash`/`maxClients` a room ends up with — not merely "the field was
// stripped from some intermediate object", per the forcing-test discipline
// already established for S2.5.4's `profileId` allow-list
// (`lobbySelection.e2e.test.ts`).
import { ColyseusTestServer } from '@colyseus/testing';
import type { Seed } from '@skervik/core';
import { PROTOCOL_VERSION } from '@skervik/protocol';
import type { Server } from 'colyseus';
import { matchMaker } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGameServer, GAME_ROOM_NAME, type GameRoom } from '../index.js';
import { sha256Hex } from '../seed.js';

/** Gives the room's queued async work a tick to settle (mirrors the other E2E files). */
function nextTick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Own port so this file never collides with the default `boot()` port
 * (`GameRoom.test.ts`), 2569 (`botFill.e2e.test.ts`), 2570
 * (`botFillSafeLeave.e2e.test.ts`), or 2571 (`lobbySelection.e2e.test.ts`) —
 * vitest runs test files in parallel workers.
 */
async function bootOnPort(gameServer: Server, port: number): Promise<ColyseusTestServer> {
  await gameServer.listen(port);
  return new ColyseusTestServer(gameServer);
}

const CONNECT_OPTS = { protocolVersion: PROTOCOL_VERSION } as const;

describe('wire options security follow-up — internal-only GameRoomOptions fields are unreachable from the wire', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    testServer = await bootOnPort(createGameServer(), 2572);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  it('[forcing] a wire join carrying an attacker-chosen seed never produces a room using that seed — the join is refused, and a legitimate join right after gets a DIFFERENT seedHash. This test fails if JoinOptionsSchema stops rejecting unknown keys.', async () => {
    const attackerSeed = 'attacker-chosen-seed-0001' as Seed;
    const attackerSeedHash = sha256Hex(attackerSeed);

    await expect(
      testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
        ...CONNECT_OPTS,
        seed: attackerSeed,
      }),
    ).rejects.toThrow();

    // Terminal-observable proof, not just "the join failed": a legitimate
    // join right after gets a room whose seedHash is NOT the attacker's —
    // no code path anywhere ever adopted the attacker-supplied seed.
    const room = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, CONNECT_OPTS);
    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as GameRoom;
    expect(serverRoom.gameState.seedHash).not.toBe(attackerSeedHash);

    await room.leave();
  });

  it('[forcing] a wire join carrying maxSeats:1 does not shrink the table — the room still requires the default 4 seats to auto-start. This test fails if JoinOptionsSchema stops rejecting unknown keys.', async () => {
    await expect(
      testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
        ...CONNECT_OPTS,
        maxSeats: 1,
      }),
    ).rejects.toThrow();

    // Terminal-observable proof: a normal join right after still requires
    // ALL 4 seats to start — the rejected attempt above never influenced any
    // room's real `maxClients`.
    const room = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, CONNECT_OPTS);
    await nextTick();
    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as GameRoom;
    expect(serverRoom.maxClients).toBe(4);
    expect(serverRoom.gameState.phase).toBe('lobby'); // 1/4 seats filled — not auto-started

    await room.leave();
  });

  it('[forcing] botActionCap / botFillDifficulty / matchesDir / sink / metadataStore / turnTimerScheduler arriving over the wire refuse the join outright (every other internal-only GameRoomOptions field)', async () => {
    const forbiddenPayloads: Record<string, unknown> = {
      botActionCap: 0,
      botFillDifficulty: 'hard',
      matchesDir: '/tmp/attacker-controlled',
      sink: {},
      metadataStore: {},
      turnTimerScheduler: {},
    };
    for (const [key, value] of Object.entries(forbiddenPayloads)) {
      try {
        await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, {
          ...CONNECT_OPTS,
          [key]: value,
        });
        throw new Error(
          `expected the join carrying "${key}" to be refused, but it succeeded`,
        );
      } catch (error) {
        // The join must reject — but not with the sentinel we throw above on
        // an unexpected success (that would silently pass this loop).
        expect((error as Error).message).not.toMatch(/expected the join carrying/);
      }
    }
  });

  it('the server is still healthy after every refused join above — a normal join right after succeeds (nothing crashed)', async () => {
    const room = await testServer.sdk.joinOrCreate(GAME_ROOM_NAME, CONNECT_OPTS);
    expect(room.roomId).toBeTruthy();
    await room.leave();
  });
});
