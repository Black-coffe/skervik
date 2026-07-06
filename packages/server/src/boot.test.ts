// S1.7.1 — the REAL cross-process boot proof (ADR-0011). Unlike GameRoom.test.ts
// (which uses the `@colyseus/testing` harness), this boots the actual
// `createHttpServer()` (Fastify + attached Colyseus WS + mounted matchmaking)
// on an ephemeral port and drives it with a REAL `@colyseus/sdk@0.17` client —
// the same client line the app ships. It is the end-to-end proof that the
// version alignment works (client & server both on colyseus 0.17 / schema v4),
// retiring the S1.6.5 v3↔v4 flag. S1.7.2 scales this to a full 3-4-client match.
import { Client } from '@colyseus/sdk';
import type { GameState, PlayerId, PlayerState } from '@skervik/core';
import { GAME_ROOM_NAME, PROTOCOL_VERSION } from '@skervik/protocol';
import { matchMaker } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHttpServer, type HttpServerHandle } from './index.js';
import type { GameRoom } from './room/GameRoom.js';

/** Gives the room's async send/broadcast a tick to reach the client over the socket. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function player(id: string): PlayerState {
  return { id: id as PlayerId, name: id, victoryPoints: 0, resources: {} };
}

describe('createHttpServer — real HTTP + WS boot (S1.7.1 / ADR-0011)', () => {
  let handle: HttpServerHandle;
  let baseHttp: string;
  let baseWs: string;

  beforeAll(async () => {
    handle = await createHttpServer();
    const { port } = await handle.listen(0, '127.0.0.1');
    baseHttp = `http://127.0.0.1:${port}`;
    baseWs = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await handle.close();
  });

  // --- REST surface -------------------------------------------------------

  it('GET /health → 200 { status: "ok" }', async () => {
    const res = await fetch(`${baseHttp}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('POST /auth/guest → 200 { guestId, displayName } with the supplied name', async () => {
    const res = await fetch(`${baseHttp}/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Nemo' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { guestId: string; displayName: string };
    expect(body.displayName).toBe('Nemo');
    expect(body.guestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('POST /auth/guest with no body → a generated Guest-XXXX name', async () => {
    const res = await fetch(`${baseHttp}/auth/guest`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { guestId: string; displayName: string };
    expect(body.displayName).toMatch(/^Guest-[0-9A-F]{4}$/);
  });

  it('POST /auth/guest with a malformed body → 400 { error }', async () => {
    const res = await fetch(`${baseHttp}/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 123 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: 'INVALID_BODY' });
  });

  // --- the alignment proof: a real 0.17 client over the socket ------------

  it('a real @colyseus/sdk 0.17 client joins: state.snapshot + coherent Schema state + one-intent event.batch round-trip', async () => {
    const guest = await fetch(`${baseHttp}/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Aronnax' }),
    }).then((r) => r.json() as Promise<{ guestId: string; displayName: string }>);

    const client = new Client(baseWs);
    const room = await client.joinOrCreate(GAME_ROOM_NAME, {
      protocolVersion: PROTOCOL_VERSION,
      guestId: guest.guestId,
      displayName: guest.displayName,
    });

    const snapshots: Array<{ payload: GameState }> = [];
    const batches: Array<{ payload: Array<{ type: string }> }> = [];
    let schemaError: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SDK Room state is the decoded Schema projection
    let schemaState: any = null;
    room.onMessage('state.snapshot', (m) => snapshots.push(m as { payload: GameState }));
    room.onMessage('event.batch', (m) =>
      batches.push(m as { payload: Array<{ type: string }> }),
    );
    room.onStateChange((state) => {
      schemaState = state;
    });
    room.onError((code, message) => {
      schemaError = `${code}: ${message ?? ''}`;
    });
    await sleep(250);

    // message bus: exactly one seed-free snapshot
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.payload.seedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(snapshots[0]?.payload ?? {})).not.toContain('seed');

    // Colyseus Schema sync across the socket (the v3↔v4 risk — now v4↔v4)
    expect(schemaError).toBeNull();
    expect(schemaState).not.toBeNull();
    expect(schemaState.seedHash).toBe(snapshots[0]?.payload.seedHash);
    expect(schemaState.seats).toHaveLength(1);
    expect(schemaState.seats[0].playerId).toBe(room.sessionId);

    // one-intent round-trip: craft a minimal main-turn on the server room, then
    // send a real intent over the socket and see the resulting event.batch +
    // schema delta land back on the client.
    const serverRoom = matchMaker.getLocalRoomById(room.roomId) as GameRoom;
    const sid = room.sessionId;
    serverRoom.gameState = {
      ...serverRoom.gameState,
      phase: 'main',
      turn: 1,
      currentPlayerId: sid as PlayerId,
      players: [player(sid), player('opponent')],
      playerOrder: [sid as PlayerId, 'opponent' as PlayerId],
    };
    serverRoom.state.phase = 'main';
    serverRoom.state.currentPlayerId = sid;

    room.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: sid },
    });
    await sleep(250);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.payload[0]?.type).toBe('turn.ended');
    // the schema projection (phase) advanced and the delta reached the client
    expect(schemaState.phase).toBe('roll');

    await room.leave();
  });

  it('a join with an INCOMPATIBLE protocolVersion is rejected over the socket (PROTOCOL_VERSION_MISMATCH)', async () => {
    const client = new Client(baseWs);
    await expect(
      client.joinOrCreate(GAME_ROOM_NAME, { protocolVersion: '0.0.0-incompatible' }),
    ).rejects.toThrow(/PROTOCOL_VERSION_MISMATCH/);
  });
});
