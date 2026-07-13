// S2.6.2a AC3/AC4 — the session-token security boundary over a REAL socket.
// Mirrors boot.test.ts (actual createHttpServer + a real @colyseus/sdk client),
// but wires a PGlite-backed DbGuestStore + a FIXED session secret so:
//   • AC4 — POST /auth/guest returns { guestId, displayName, sessionToken } and
//     re-presenting that token resolves the SAME durable userId.
//   • AC3 — a garbage token is REJECTED (4004 / "invalid session token"); a
//     VALID token joins and lands its userId on client.userData; NO token joins.
import { Client } from '@colyseus/sdk';
import { GAME_ROOM_NAME, PROTOCOL_VERSION } from '@skervik/protocol';
import { matchMaker } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DbGuestStore } from './auth/dbGuestStore.js';
import { UserRepository } from './db/repositories/userRepository.js';
import { createTestDb, type TestDb } from './db/testDb.js';
import { createHttpServer, type HttpServerHandle } from './index.js';
import type { GameRoom } from './room/GameRoom.js';

const SECRET = new TextEncoder().encode('s2.6.2a-fixed-test-secret');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GuestResponse {
  readonly guestId: string;
  readonly displayName: string;
  readonly sessionToken: string;
}

describe('createHttpServer — session-token auth (S2.6.2a AC3/AC4)', () => {
  let handle: HttpServerHandle;
  let testDb: TestDb;
  let baseHttp: string;
  let baseWs: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    const guestStore = new DbGuestStore(new UserRepository(testDb.db));
    handle = await createHttpServer({ guestStore, sessionSecret: SECRET });
    const { port } = await handle.listen(0, '127.0.0.1');
    baseHttp = `http://127.0.0.1:${port}`;
    baseWs = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await handle.close();
    await testDb.close();
  });

  async function issueGuest(displayName: string): Promise<GuestResponse> {
    const res = await fetch(`${baseHttp}/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as GuestResponse;
  }

  it('AC4: POST /auth/guest returns a signed sessionToken bound to a durable userId', async () => {
    const guest = await issueGuest('Aronnax');
    expect(guest.displayName).toBe('Aronnax');
    expect(guest.guestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // A three-segment JWT.
    expect(guest.sessionToken.split('.')).toHaveLength(3);
  });

  it('AC3: a join with a GARBAGE sessionToken is rejected (4004 / invalid session token)', async () => {
    const client = new Client(baseWs);
    await expect(
      client.joinOrCreate(GAME_ROOM_NAME, {
        protocolVersion: PROTOCOL_VERSION,
        sessionToken: 'not.a.valid.jwt',
      }),
    ).rejects.toThrow(/invalid session token/);
  });

  it('AC3/AC4: a VALID token joins, and its userId lands on client.userData (same userId re-resolves)', async () => {
    const guest = await issueGuest('Conseil');

    const client = new Client(baseWs);
    const room = await client.joinOrCreate(GAME_ROOM_NAME, {
      protocolVersion: PROTOCOL_VERSION,
      guestId: guest.guestId,
      displayName: guest.displayName,
      sessionToken: guest.sessionToken,
    });
    await sleep(150);

    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as GameRoom;
    const serverClient = serverRoom.clients.find((c) => c.sessionId === room.sessionId);
    expect(serverClient).toBeDefined();
    // Non-authoritative metadata: the durable userId from the token — NOT the
    // seat PlayerId (which stays the sessionId, ADR-0009).
    expect((serverClient?.userData as { userId?: string } | undefined)?.userId).toBe(
      guest.guestId,
    );

    await room.leave();
  });

  it('AC3: a join with NO sessionToken succeeds as a fresh guest (backward compatible)', async () => {
    const client = new Client(baseWs);
    const room = await client.joinOrCreate(GAME_ROOM_NAME, {
      protocolVersion: PROTOCOL_VERSION,
    });
    await sleep(150);

    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as GameRoom;
    const serverClient = serverRoom.clients.find((c) => c.sessionId === room.sessionId);
    expect(serverClient).toBeDefined();
    // No token → no userData attached.
    expect(serverClient?.userData).toBeUndefined();

    await room.leave();
  });
});
