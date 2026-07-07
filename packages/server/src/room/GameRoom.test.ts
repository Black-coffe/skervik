// S1.4.1 — GameRoom shell: seed generation, the minimal public projection,
// and join/leave/seat-cap behavior. Uses the official `@colyseus/testing`
// harness (a real Colyseus server + WS client) — this IS the Fork 4 ESM/Node
// 22 spike, exercised end to end rather than by reaching into Room internals.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { boot, type ColyseusTestServer } from '@colyseus/testing';
import {
  buildTopology,
  type EdgeId,
  type GameState,
  generateBoard,
  type MatchStartedEvent,
  parseGameEventLog,
  type PlayerId,
  type PlayerIntent,
  type PlayerState,
  replay,
  type Seed,
  validate,
  type VertexId,
} from '@skervik/core';
import {
  EventBatchEnvelopeSchema,
  type EventBatchMessage,
  PROTOCOL_VERSION,
  type RejectMessage,
  ServerMessageSchema,
  StateSnapshotEnvelopeSchema,
  type StateSnapshotMessage,
} from '@skervik/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGameServer, GAME_ROOM_NAME, type GameRoom } from '../index.js';
import { InMemoryMatchMetadataStore } from '../matchMetadata.js';
import { sha256Hex } from '../seed.js';
import { FsEventSink, type GameEventSink, InMemoryEventSink } from './eventSink.js';

/** Gives the room's `onJoin`/`onLeave` sends a tick to reach the client. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * The compatible join handshake every client must now present (S1.5.2): the
 * room's `onAuth` rejects a join that omits or mismatches `protocolVersion`, so
 * every `connectTo` carries the current `PROTOCOL_VERSION`. The version-gate
 * tests below deliberately pass a different/absent value.
 */
const CONNECT_OPTS = { protocolVersion: PROTOCOL_VERSION } as const;

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

// --- S1.4.3 commit-reveal: a real winning intent through the pipeline --------
// Mirror of core's victory recipe (victory.test.ts `nearWinGenesis`): a target
// vertex with an own road to build onto + 4 city vertices well clear of it, so
// a single `intent.buildSettlement` takes the acting player from 9 VP (8 cities
// + 1 hidden VP card) to 10 → core appends `game.ended`. Driven through the
// room's real `validate`/`reduce` pipeline so the reveal hook fires exactly as
// in production.
const topology = buildTopology();
const winTarget = topology.vertices[0] as {
  id: VertexId;
  adjacentVertexIds: readonly VertexId[];
};
const winExcluded = new Set<string>([winTarget.id, ...winTarget.adjacentVertexIds]);
const winRoadEdge = ((): EdgeId => {
  const a = winTarget.id;
  const b = winTarget.adjacentVertexIds[0] as VertexId;
  const edge = topology.edges.find(
    (e) => e.vertexIds.includes(a) && e.vertexIds.includes(b),
  );
  if (!edge) throw new Error('no edge for win road');
  return edge.id;
})();
const winCityVertices = topology.vertices
  .filter((v) => !winExcluded.has(v.id))
  .slice(0, 4)
  .map((v) => v.id);

/** All five Classic resources in abundance — covers any single build cost. */
const RICH = { timber: 9, clay: 9, fleece: 9, barley: 9, iron: 9 } as const;

/**
 * Crafts a `main`-phase state one settlement away from a win for `winner`,
 * preserving the room's REAL `seedHash`/`matchId` (so the revealed seed can be
 * checked against the published commitment). `winner` is the seated client's
 * sessionId — the pipeline binds the actor to that seat.
 */
function driveToNearWin(room: GameRoom, winner: string): void {
  const cities: Record<string, string> = {};
  for (const vertexId of winCityVertices) cities[vertexId] = winner;
  room.gameState = {
    ...room.gameState,
    phase: 'main',
    turn: 20,
    currentPlayerId: winner as PlayerId,
    players: [
      { id: winner as PlayerId, name: winner, victoryPoints: 0, resources: { ...RICH } },
      { id: 'opponent' as PlayerId, name: 'opponent', victoryPoints: 0, resources: {} },
    ],
    buildings: { settlements: {}, roads: { [winRoadEdge]: winner }, cities },
    devCards: { [winner]: { held: { victoryPoint: 1 }, boughtThisTurn: {} } },
  };
  room.state.phase = 'main';
  room.state.currentPlayerId = winner;
}

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
    const client = await testServer.connectTo(room, CONNECT_OPTS);

    expect(client.sessionId).toBeTruthy();

    await client.leave();
  });

  it('the public schema exposes ONLY the projection fields (seedHash/phase/currentPlayerId/seats + S2.1.4 presentational deadline) — no seed, no resource/hand/board field', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);

    // S2.1.4 added the presentational turn-deadline fields to the public
    // projection (never to GameState/the log). No gameplay/hand/board field.
    expect(Object.keys(room.state.toJSON()).sort()).toEqual([
      'currentPlayerId',
      'phase',
      'seats',
      'seedHash',
      'turnDeadline',
      'turnSoftWarnAt',
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
    const client = await testServer.connectTo(room, CONNECT_OPTS);
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
    const client = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const gameStateBefore = JSON.stringify(room.gameState);

    await client.leave();
    await nextTick();

    expect(room.state.seats[0]?.connected).toBe(false);
    expect(JSON.stringify(room.gameState)).toBe(gameStateBefore);
  });

  it('rejects joins past the seat cap', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, { maxSeats: 1 });
    await testServer.connectTo(room, CONNECT_OPTS);

    await expect(testServer.connectTo(room, CONNECT_OPTS)).rejects.toThrow();
  });

  // --- S1.4.2 authoritative intent pipeline -------------------------------

  it('a seated player’s valid intent → reduce advances state, event.batch broadcasts to ALL clients, projection refreshes', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
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
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
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
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
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
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
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

  it('turn-gate: a seated player acting under its OWN id on another player’s turn → NOT_YOUR_TURN (NIT-3)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const a = c1.sessionId;
    const b = c2.sessionId;
    // It is B's turn. c1 acts under ITS OWN id (a) — no impersonation, so the
    // identity check passes — but the turn-gate at the server boundary rejects
    // it because the current turn belongs to B.
    startMainTurn(room, a, b, b);
    const before = JSON.stringify(room.gameState);

    const rejects: RejectMessage[] = [];
    const batches2: EventBatchMessage[] = [];
    c1.onMessage('intent.rejected', (m: RejectMessage) => rejects.push(m));
    c2.onMessage('event.batch', (m: EventBatchMessage) => batches2.push(m));

    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: a },
    });
    await nextTick();

    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.payload.reason).toBe('NOT_YOUR_TURN');
    expect(batches2).toHaveLength(0); // a rejection is never broadcast
    expect(JSON.stringify(room.gameState)).toBe(before); // state untouched

    await c1.leave();
    await c2.leave();
  });

  it('identity binding: an unseated sender is rejected', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
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

  it('a malformed envelope/payload is rejected by zod without throwing (S1.5.1)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const rejects: RejectMessage[] = [];
    c1.onMessage('intent.rejected', (m: RejectMessage) => rejects.push(m));

    // (1) unknown envelope type, (2) missing payload, and — the S1.5.1 upgrade
    // over the old structural guard — (3) a KNOWN intent type with a WRONG-TYPED
    // payload field (`count` a string, not a number). The old guard only checked
    // `payload.type` was a string and would have handed (3) to `validate`; zod
    // now rejects it as MALFORMED_INTENT at the wire boundary. All three are
    // rejected, never thrown out of the handler.
    c1.send('intent', {
      v: 1,
      type: 'not-an-intent',
      payload: { type: 'intent.endTurn' },
    });
    c1.send('intent', { v: 1, type: 'intent' });
    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: {
        type: 'intent.bankTrade',
        playerId: c1.sessionId,
        give: 'timber',
        count: 'four',
        get: 'ore',
      },
    });
    await nextTick();

    expect(rejects).toHaveLength(3);
    expect(rejects[0]?.payload.reason).toBe('MALFORMED_INTENT');
    expect(rejects[1]?.payload.reason).toBe('MALFORMED_INTENT');
    expect(rejects[2]?.payload.reason).toBe('MALFORMED_INTENT');

    await c1.leave();
  });

  it('real server-sent event.batch / state.snapshot payloads parse against the outbound schemas (S1.5.1, E1.6 contract)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);

    // Attach the state.snapshot listener BEFORE connecting c1 (and before
    // connecting c2) — onJoin sends the snapshot immediately, so a listener
    // registered after another awaited `connectTo` can miss it (it isn't
    // buffered for late subscribers).
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const snapshots: StateSnapshotMessage[] = [];
    c1.onMessage('state.snapshot', (m: StateSnapshotMessage) => snapshots.push(m));
    await nextTick();

    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const a = c1.sessionId;
    const b = c2.sessionId;
    startMainTurn(room, a, b, a);

    // ...and the real event.batch it broadcasts from a valid intent.
    const batches: EventBatchMessage[] = [];
    c1.onMessage('event.batch', (m: EventBatchMessage) => batches.push(m));
    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: a },
    });
    await nextTick();

    expect(snapshots).toHaveLength(1);
    expect(batches).toHaveLength(1);

    // The exact messages the server put on the wire satisfy the schemas E1.6's
    // client will validate them against — the contract holds end to end.
    expect(StateSnapshotEnvelopeSchema.safeParse(snapshots[0]).success).toBe(true);
    expect(ServerMessageSchema.safeParse(snapshots[0]).success).toBe(true);
    expect(EventBatchEnvelopeSchema.safeParse(batches[0]).success).toBe(true);
    expect(ServerMessageSchema.safeParse(batches[0]).success).toBe(true);

    await c1.leave();
    await c2.leave();
  });

  // --- S1.5.2 handshake + protocol version negotiation ---------------------

  it('a join carrying the correct protocolVersion is accepted (onAuth) and still receives state.snapshot', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);

    const snapshots: StateSnapshotMessage[] = [];
    const client = await testServer.connectTo(room, {
      protocolVersion: PROTOCOL_VERSION,
    });
    client.onMessage('state.snapshot', (m: StateSnapshotMessage) => snapshots.push(m));
    await nextTick();

    // onAuth passed → the client seated and got the unchanged S1.4.1 snapshot.
    expect(room.state.seats).toHaveLength(1);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.type).toBe('state.snapshot');
    expect(StateSnapshotEnvelopeSchema.safeParse(snapshots[0]).success).toBe(true);

    await client.leave();
  });

  it('a join carrying an INCOMPATIBLE protocolVersion is rejected in onAuth — PROTOCOL_VERSION_MISMATCH, no seat, no snapshot', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);

    // onAuth throws a ServerError whose message is the JSON `error.version`
    // payload, so the join promise rejects with the machine code carried over
    // the transport — and the incompatible client never enters the room.
    await expect(
      testServer.connectTo(room, { protocolVersion: '0.0.0-incompatible' }),
    ).rejects.toThrow(/PROTOCOL_VERSION_MISMATCH/);
    await nextTick();

    // Rejected BEFORE onJoin/seating: no seat assigned, no broadcast possible.
    expect(room.state.seats).toHaveLength(0);
  });

  it('a join with a MISSING protocolVersion is rejected in onAuth (no seat)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);

    await expect(testServer.connectTo(room, {})).rejects.toThrow(
      /PROTOCOL_VERSION_MISMATCH/,
    );
    await nextTick();

    expect(room.state.seats).toHaveLength(0);
  });

  it('a join with a MALFORMED (non-string) protocolVersion is rejected in onAuth (no seat)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);

    await expect(
      testServer.connectTo(room, { protocolVersion: 1 as unknown as string }),
    ).rejects.toThrow(/PROTOCOL_VERSION_MISMATCH/);
    await nextTick();

    expect(room.state.seats).toHaveLength(0);
  });

  // --- S1.4.3 commit-reveal: reveal at game end + leak checklist ------------

  it('reveals the secret seed to match metadata EXACTLY on the game.ended batch, and seedHash === sha256Hex(revealed seed)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const winner = c1.sessionId;
    driveToNearWin(room, winner);

    const store = room.matchMetadataStore as InMemoryMatchMetadataStore;
    // Nothing revealed yet — the game has not ended.
    expect(store.reveals.size).toBe(0);

    const batches: EventBatchMessage[] = [];
    c1.onMessage('event.batch', (m: EventBatchMessage) => batches.push(m));

    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: {
        type: 'intent.buildSettlement',
        playerId: winner,
        vertexId: winTarget.id,
      },
    });
    await nextTick();

    // The winning action produced a game.ended event...
    expect(batches).toHaveLength(1);
    expect(batches[0]?.payload.some((e) => e.type === 'game.ended')).toBe(true);
    expect(room.gameState.phase).toBe('finished');

    // ...so the reveal fired exactly once, recording the raw seed under this match.
    expect(store.reveals.size).toBe(1);
    const revealed = store.reveals.get(room.roomId);
    expect(revealed).toMatch(/^[0-9a-f]{64}$/);

    // The commitment holds: the published seedHash is the SHA-256 of the now-
    // revealed seed — anyone can verify the room never swapped seeds mid-match.
    expect(sha256Hex(revealed as string)).toBe(room.gameState.seedHash);
    expect(sha256Hex(revealed as string)).toBe(room.state.seedHash);

    // Leak vector (4): the game.ended broadcast carries the public events only —
    // the raw seed never rides it.
    expect(JSON.stringify(batches[0])).not.toContain(revealed);

    await c1.leave();
  });

  it('never reveals the seed on a pre-game.ended batch (a plain end-turn leaves metadata empty)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const a = c1.sessionId;
    startMainTurn(room, a, c2.sessionId, a);

    const store = room.matchMetadataStore as InMemoryMatchMetadataStore;

    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: a },
    });
    await nextTick();

    // A normal turn advanced (S1.4.2), but no game.ended → the seed stays secret.
    expect(room.gameState.eventIndex).toBe(1);
    expect(store.reveals.size).toBe(0);

    await c1.leave();
    await c2.leave();
  });

  it('reveal is once-only: after game.ended the match is frozen, so a further intent is rejected and the seed is not re-revealed', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const winner = c1.sessionId;
    driveToNearWin(room, winner);

    const store = room.matchMetadataStore as InMemoryMatchMetadataStore;
    const rejects: RejectMessage[] = [];
    c1.onMessage('intent.rejected', (m: RejectMessage) => rejects.push(m));

    // Win.
    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: {
        type: 'intent.buildSettlement',
        playerId: winner,
        vertexId: winTarget.id,
      },
    });
    await nextTick();
    expect(store.reveals.size).toBe(1);
    const revealed = store.reveals.get(room.roomId);

    // Try to act again after the freeze — core rejects (GAME_ALREADY_ENDED),
    // so no second batch, and the metadata reveal is untouched (exactly once).
    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: winner },
    });
    await nextTick();

    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.payload.reason).toBe('GAME_ALREADY_ENDED');
    expect(store.reveals.size).toBe(1);
    expect(store.reveals.get(room.roomId)).toBe(revealed);
    // No seed ever rode the rejection reply.
    expect(JSON.stringify(rejects[0])).not.toMatch(HEX64);

    await c1.leave();
  });

  // --- S1.4.4b durable persistence + persist-before-commit ordering --------

  it('FsEventSink round-trip: the durable ndjson log replays back to the room’s exact gameState', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'skervik-events-'));
    try {
      const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
        matchesDir: tempDir,
      });
      // Production wiring: the `matchesDir` option selects the durable writer.
      expect(room.eventSink).toBeInstanceOf(FsEventSink);

      const c1 = await testServer.connectTo(room, CONNECT_OPTS);
      const c2 = await testServer.connectTo(room, CONNECT_OPTS);
      await nextTick();

      const a = c1.sessionId;
      const b = c2.sessionId;
      startMainTurn(room, a, b, a);
      // The state the log must replay FROM (before the intent's events).
      const initialState = structuredClone(room.gameState);

      c1.send('intent', {
        v: 1,
        type: 'intent',
        payload: { type: 'intent.endTurn', playerId: a },
      });
      await nextTick();

      // The batch was persisted as bare-GameEvent ndjson, one event per line.
      const ndjson = await readFile(join(tempDir, room.roomId, 'events.ndjson'), 'utf8');
      expect(ndjson.trimEnd().split('\n')).toHaveLength(1);

      // Round-trip: parse the on-disk log and replay it from the pre-intent
      // state — it reconstructs the room's exact post-intent gameState.
      const events = parseGameEventLog(ndjson);
      expect(events).toEqual([
        { type: 'turn.ended', index: 0, playerId: a, nextPlayerId: b },
      ]);
      expect(replay(initialState, events)).toEqual(room.gameState);

      // The durable log never leaks the seed (raw or hashed).
      expect(ndjson).not.toMatch(HEX64);

      await c1.leave();
      await c2.leave();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('persist-before-commit: a rejecting sink → sender gets a private error, NO broadcast, state untouched, no crash (NIT-1)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const a = c1.sessionId;
    const b = c2.sessionId;
    startMainTurn(room, a, b, a);

    // Inject a sink that fails every write (a durable-FS error) — ASYNCHRONOUSLY
    // (an `async` `append` that awaits nothing then rejects, so the pipeline's
    // `await this.eventSink.append(...)` genuinely suspends before the
    // rejection surfaces). A SYNCHRONOUSLY-throwing `append` would never
    // exercise the real async-rejection path this guard exists for (a real
    // `FsEventSink` failure is always an async rejection, e.g. a disk error
    // surfacing from `appendFile`'s promise) — lead-review nit: this must
    // prove the crash-safety guard for the case that actually occurs in
    // production, not merely for a synchronous throw.
    const throwingSink: GameEventSink = {
      async append() {
        throw new Error('disk write failed');
      },
    };
    room.eventSink = throwingSink;
    const before = structuredClone(room.gameState);

    const errors: unknown[] = [];
    const batches2: EventBatchMessage[] = [];
    c1.onMessage('intent.error', (m: unknown) => errors.push(m));
    c2.onMessage('event.batch', (m: EventBatchMessage) => batches2.push(m));

    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: a },
    });
    // Two ticks: the (voided, async) handler must fully settle. A regression
    // that let the sink rejection escape would surface here as an unhandled
    // rejection, which Vitest fails the run on.
    await nextTick();
    await nextTick();

    // The sender got a private infrastructure error (NOT a validation reject)...
    expect(errors).toHaveLength(1);
    expect((errors[0] as { type?: string }).type).toBe('intent.error');
    expect(JSON.stringify(errors[0])).not.toMatch(HEX64); // no seed in the reply
    // ...no event.batch was broadcast (nothing was durably recorded)...
    expect(batches2).toHaveLength(0);
    // ...and the authoritative state was NOT advanced past the unpersisted event.
    expect(room.gameState).toEqual(before);

    await c1.leave();
    await c2.leave();
  });

  it('concurrency: two intents in the same tick are SERIALIZED — the second validates against the COMMITTED state, not a stale one (lead-review TOCTOU fix)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const a = c1.sessionId;
    const b = c2.sessionId;
    startMainTurn(room, a, b, a);
    // `a` holds EXACTLY one bank-trade's worth of timber (base 4:1 rate, no
    // ports owned) — enough for ONE `intent.bankTrade`, not two. A double-spend
    // regression lets BOTH succeed; the fix lets only the first.
    room.gameState = {
      ...room.gameState,
      players: [{ ...player(a), resources: { timber: 4 } }, player(b)],
    };

    // A sink whose `append` genuinely suspends across a macrotask (like real
    // disk I/O) — this is the exact window a fire-and-forget handler would
    // race inside: without serialization, a SECOND intent arriving while the
    // first is still awaiting `append` would `validate` against `this.gameState`
    // BEFORE the first intent's commit — i.e. against STALE state.
    const delayedSink: GameEventSink = {
      append: () => new Promise((resolve) => setTimeout(resolve, 30)),
    };
    room.eventSink = delayedSink;

    const rejects: RejectMessage[] = [];
    const batches: EventBatchMessage[] = [];
    c1.onMessage('intent.rejected', (m: RejectMessage) => rejects.push(m));
    c1.onMessage('event.batch', (m: EventBatchMessage) => batches.push(m));

    const bankTradeIntent = {
      v: 1,
      type: 'intent' as const,
      payload: {
        type: 'intent.bankTrade' as const,
        playerId: a,
        give: 'timber',
        count: 4,
        get: 'clay',
      },
    };
    // Fire the SAME intent TWICE back-to-back, with no `await` between the two
    // `send`s — both land while the first's `#handleIntent` is (at best) still
    // in flight, exercising the exact race the queue must close.
    c1.send('intent', bankTradeIntent);
    c1.send('intent', bankTradeIntent);

    // Give the delayed sink (30ms) and the serialized queue time to fully
    // drain BOTH intents before asserting.
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Exactly ONE trade was applied — a single `bank.trade` broadcast...
    expect(batches).toHaveLength(1);
    expect(batches[0]?.payload).toHaveLength(1);
    expect(batches[0]?.payload[0]).toMatchObject({
      type: 'bank.trade',
      playerId: a,
      give: 'timber',
      count: 4,
      get: 'clay',
    });
    // ...and the SECOND was rejected CANNOT_AFFORD — validated against the
    // COMMITTED (post-first-trade, 0-timber) state, not the stale 4-timber one
    // a race would have handed it.
    expect(rejects).toHaveLength(1);
    expect(rejects[0]?.payload.reason).toBe('CANNOT_AFFORD');
    // The room ends with exactly 0 timber — spent ONCE, never double-spent (the
    // fingerprint a race would leave is a SECOND `bank.trade` broadcast, which
    // `batches` above already proves did not happen).
    expect(room.gameState.players.find((p) => p.id === a)?.resources['timber']).toBe(0);

    await c1.leave();
    await c2.leave();
  });

  // --- S1.7.2 Phase A: match-start orchestration --------------------------
  // Seating the room to its full cap must fire the `match.started` +
  // `board.generated` genesis batch exactly once, through the SAME
  // `#queue`/append/commit/broadcast pipeline as any intent, deterministically
  // for a fixed injected seed (the E2E's determinism + replay gates rest on it).

  /** A fixed injected seed — reproducible board across rooms/runs (never a real match secret). */
  const MATCH_START_SEED = 'skervik-s1.7.2-phase-a-seed';

  /** Seats `count` fresh clients into a room wired with an in-memory sink + the fixed seed. */
  async function seatFullRoom(
    count: number,
  ): Promise<{ room: GameRoom; sink: InMemoryEventSink; seatIds: string[] }> {
    const sink = new InMemoryEventSink();
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: count,
      seed: MATCH_START_SEED,
      sink,
    });
    const seatIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const client = await testServer.connectTo(room, CONNECT_OPTS);
      seatIds.push(client.sessionId);
    }
    await nextTick();
    return { room, sink, seatIds };
  }

  it('does NOT start the match while seats are still open (below the cap)', async () => {
    const sink = new InMemoryEventSink();
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 3,
      seed: MATCH_START_SEED,
      sink,
    });
    await testServer.connectTo(room, CONNECT_OPTS);
    await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    expect(room.gameState.phase).toBe('lobby');
    expect(sink.events).toHaveLength(0);
  });

  it('seating the full cap fires match.started + board.generated once, through the pipeline', async () => {
    const { room, sink, seatIds } = await seatFullRoom(3);

    // Authoritative state transitioned lobby -> setup via the folded batch.
    expect(room.gameState.phase).toBe('setup');
    expect(room.gameState.turn).toBe(1);
    expect(room.gameState.players.map((p) => p.id)).toEqual(seatIds);
    expect(room.gameState.playerOrder).toEqual(seatIds);
    expect(room.gameState.currentPlayerId).toBe(seatIds[0]);
    expect(room.gameState.board).toBeDefined();
    // match.started (index 0) + board.generated (index 1) -> eventIndex 2.
    expect(room.gameState.eventIndex).toBe(2);

    // The public projection was refreshed from the committed state.
    expect(room.state.phase).toBe('setup');
    expect(room.state.currentPlayerId).toBe(seatIds[0]);

    // The sink recorded exactly the two genesis events, in order, once.
    expect(sink.events.map((e) => e.type)).toEqual(['match.started', 'board.generated']);
    const started = sink.events[0] as MatchStartedEvent;
    expect(started.playerIds).toEqual(seatIds);
    expect(started.seedHash).toBe(room.gameState.seedHash);
  });

  it('the match-start board is deterministic for a fixed seed', async () => {
    const a = await seatFullRoom(3);
    const b = await seatFullRoom(3);

    const boardA = a.sink.events.find((e) => e.type === 'board.generated');
    const boardB = b.sink.events.find((e) => e.type === 'board.generated');
    expect(boardA).toBeDefined();
    expect(boardA).toEqual(boardB);

    // And it equals the SAME core generator output S1.6.1's dev fixture uses.
    const layout = generateBoard(MATCH_START_SEED, buildTopology());
    expect(boardA).toMatchObject({
      type: 'board.generated',
      tileKinds: layout.tileKinds,
      tileTokens: layout.tileTokens,
      portContents: layout.portContents,
      robberTileId: layout.robberTileId,
    });
  });

  it('every seated client receives the match-start batch (broadcast to all)', async () => {
    const sink = new InMemoryEventSink();
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 3,
      seed: MATCH_START_SEED,
      sink,
    });
    const early = [
      await testServer.connectTo(room, CONNECT_OPTS),
      await testServer.connectTo(room, CONNECT_OPTS),
    ];
    const batches: EventBatchMessage[][] = [[], []];
    early.forEach((client, i) => {
      client.onMessage('event.batch', (m: EventBatchMessage) => batches[i]?.push(m));
    });
    // The 3rd seat fills the room and triggers the start.
    await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    for (const received of batches) {
      expect(received).toHaveLength(1);
      expect(received[0]?.payload.map((e) => e.type)).toEqual([
        'match.started',
        'board.generated',
      ]);
    }
  });

  it('the raw seed never appears in the persisted match-start log — only its hash', async () => {
    const { sink } = await seatFullRoom(3);
    const serialized = JSON.stringify(sink.events);
    expect(serialized).toContain(sha256Hex(MATCH_START_SEED));
    expect(serialized).not.toContain(MATCH_START_SEED);
  });

  // --- S2.1.4 server-enforced turn timers + anti-AFK ----------------------
  // Colyseus `@colyseus/testing` exposes no tickable clock, so the room takes a
  // `turnTimerScheduler` seam: production wires it to `this.clock` (the ONLY
  // wall-clock the room uses), the test injects a manual scheduler it fires
  // deterministically. This proves arm → expire → forced action through the
  // #queue → broadcast → re-arm, plus the anti-AFK increment/reset — with no
  // real wall-clock wait and no timestamp reaching the log.

  it('a hard turn-timeout force-completes the turn through the #queue pipeline, re-arms, and drives anti-AFK (increment + reset)', async () => {
    const scheduler = new ManualScheduler();
    const sink = new InMemoryEventSink();
    // maxSeats 4 with only 2 clients → no auto-start, so the crafted state stands.
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      seed: MATCH_START_SEED,
      sink,
      turnTimerScheduler: scheduler,
    });
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const a = c1.sessionId;
    const b = c2.sessionId;
    // A main-phase turn owned by `a`, holding just enough for one proposeTrade —
    // a committing action that STAYS in `main`, so it arms the MAIN hard timer.
    room.gameState = {
      ...room.gameState,
      phase: 'main',
      turn: 1,
      currentPlayerId: a as PlayerId,
      players: [
        {
          id: a as PlayerId,
          name: a,
          victoryPoints: 0,
          resources: { timber: 1, clay: 1 },
        },
        { id: b as PlayerId, name: b, victoryPoints: 0, resources: {} },
      ],
      playerOrder: [a as PlayerId, b as PlayerId],
    };
    room.state.phase = 'main';
    room.state.currentPlayerId = a;

    const batches: EventBatchMessage[] = [];
    c1.onMessage('event.batch', (m: EventBatchMessage) => batches.push(m));

    // A real committing intent arms the MAIN hard timer for `a`.
    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: {
        type: 'intent.proposeTrade',
        playerId: a,
        give: { timber: 1 },
        get: { clay: 1 },
      },
    });
    await nextTick();
    expect(room.gameState.phase).toBe('main');
    expect(scheduler.armed).toBe(true);
    // The presentational deadline is projected onto the schema (never GameState).
    expect(room.state.turnDeadline).toBeGreaterThan(Date.now());
    expect(Object.keys(room.gameState)).not.toContain('turnDeadline');

    // Fire the hard timeout → forced endTurn for `a` through the shared tail.
    scheduler.fire();
    await nextTick();

    // The forced action produced a NORMAL turn.ended (no timestamp/marker)...
    const lastBatch = batches[batches.length - 1];
    expect(lastBatch?.payload.some((e) => e.type === 'turn.ended')).toBe(true);
    // ...the turn advanced to b (roll)...
    expect(room.gameState.currentPlayerId).toBe(b);
    expect(room.gameState.phase).toBe('roll');
    // ...anti-AFK incremented a's streak (threshold 2 → not yet idle)...
    const seatA = () => room.state.seats.find((s) => s.playerId === a);
    expect(seatA()?.consecutiveMisses).toBe(1);
    expect(seatA()?.idle).toBe(false);
    // ...and the timer was RE-ARMED for b's roll.
    expect(scheduler.armed).toBe(true);
    // The persisted log records only the resulting normal events — no timestamp.
    expect(JSON.stringify(sink.events)).not.toMatch(/deadline|timedOut|timestamp/i);

    // A subsequent REAL intent from `a` resets a's streak to 0. Re-craft a fresh
    // main turn owned by `a` and have it end the turn for real.
    room.gameState = {
      ...room.gameState,
      phase: 'main',
      turn: 2,
      currentPlayerId: a as PlayerId,
      players: [player(a), player(b)],
      playerOrder: [a as PlayerId, b as PlayerId],
    };
    room.state.phase = 'main';
    room.state.currentPlayerId = a;

    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: a },
    });
    await nextTick();

    expect(seatA()?.consecutiveMisses).toBe(0);
    expect(seatA()?.idle).toBe(false);

    await c1.leave();
    await c2.leave();
  });

  it('a stale timeout (superseded by a real action that re-armed) is a no-op — the generation guard cancels it', async () => {
    const scheduler = new ManualScheduler();
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      seed: MATCH_START_SEED,
      turnTimerScheduler: scheduler,
    });
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const a = c1.sessionId;
    const b = c2.sessionId;

    // 1. `a` ends its turn (real) → commit re-arms the timer (generation X) for
    //    b's roll. Capture that armed callback — it will become stale.
    startMainTurn(room, a, b, a);
    c1.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: a },
    });
    await nextTick();
    expect(room.gameState.currentPlayerId).toBe(b);
    const staleCallback = scheduler.currentCallback();
    expect(staleCallback).toBeDefined();

    // 2. `b` ends its turn (real) → commit RE-ARMS again (generation X+1). The
    //    captured callback now belongs to a superseded generation.
    startMainTurn(room, a, b, b);
    c2.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: b },
    });
    await nextTick();
    const eventIndexBefore = room.gameState.eventIndex;
    const currentBefore = room.gameState.currentPlayerId;

    // 3. Fire the STALE callback — the generation guard must no-op it: no forced
    //    action, no state change (a real action already advanced the turn).
    staleCallback?.();
    await nextTick();
    expect(room.gameState.eventIndex).toBe(eventIndexBefore);
    expect(room.gameState.currentPlayerId).toBe(currentBefore);

    await c1.leave();
    await c2.leave();
  });
});

/**
 * A manual turn-timer scheduler (S2.1.4 test seam) — Colyseus `@colyseus/testing`
 * exposes no tickable clock, so the room's timer is injected here and fired
 * deterministically. Only ever ONE hard timer is armed at a time (the room clears
 * before each re-arm), so a single `pending` entry suffices; `clear()` only nulls
 * it when it is still the current one (a superseded clear is a no-op).
 */
class ManualScheduler {
  #pending: { readonly cb: () => void } | null = null;

  setTimeout(callback: () => void): { clear(): void } {
    const entry = { cb: callback };
    this.#pending = entry;
    return {
      clear: () => {
        if (this.#pending === entry) this.#pending = null;
      },
    };
  }

  get armed(): boolean {
    return this.#pending !== null;
  }

  /** The currently-armed callback (captured for the stale-generation test), or undefined. */
  currentCallback(): (() => void) | undefined {
    return this.#pending?.cb;
  }

  /** Fire the currently-armed timeout (one-shot: consumes it before invoking). */
  fire(): void {
    const entry = this.#pending;
    if (!entry) throw new Error('no turn timer armed to fire');
    this.#pending = null;
    entry.cb();
  }
}

// --- NIT-2 string-pin (lead-review nit) -------------------------------------
// `GameRoom`'s `isUnknownIntentError` string-matches the exact prefixes core's
// `validate()` exhaustiveness guard throws. Pin those two literal messages
// directly against the REAL exported `validate` here, independent of the room
// pipeline, so a future core reword of either message breaks THIS test loudly
// instead of silently flipping the room's MALFORMED_INTENT reply to
// INTERNAL_ERROR for a case that is actually a legitimate unknown-intent-type
// (not a real internal bug).
describe('core validate() exhaustiveness-throw messages GameRoom string-matches (NIT-2 pin)', () => {
  const minimalMainState = (playerId: string): GameState => ({
    matchId: 'pin-match',
    phase: 'main',
    turn: 1,
    currentPlayerId: playerId as PlayerId,
    players: [player(playerId)],
    playerOrder: [playerId as PlayerId],
    eventIndex: 0,
    seedHash: sha256Hex('pin-seed' as Seed),
  });

  it('an unrecognized top-level intent.type throws with the "unhandled intent type:" prefix', () => {
    const playerId = 'p1';
    const bogusIntent = {
      type: 'intent.totallyUnknownForThisTest',
      playerId,
    } as unknown as PlayerIntent;

    expect(() =>
      validate(
        minimalMainState(playerId),
        bogusIntent,
        playerId as PlayerId,
        'pin-seed' as Seed,
      ),
    ).toThrowError(/^unhandled intent type: /);
  });

  it('an unrecognized playDevCard card kind throws with the "unhandled playDevCard card kind:" prefix', () => {
    const playerId = 'p1';
    // `validate`'s CARD_NOT_HELD/BOUGHT_THIS_TURN guards key off `intent.card`
    // BEFORE the exhaustiveness switch, so the player must "hold" the bogus
    // card kind (bought a prior turn) to actually reach that switch's default.
    const state: GameState = {
      ...minimalMainState(playerId),
      devCards: {
        [playerId]: {
          held: { totallyUnknownCardKind: 1 },
          boughtThisTurn: {},
        },
      } as unknown as NonNullable<GameState['devCards']>,
    };
    const bogusPlayIntent = {
      type: 'intent.playDevCard',
      playerId,
      card: 'totallyUnknownCardKind',
    } as unknown as PlayerIntent;

    expect(() =>
      validate(state, bogusPlayIntent, playerId as PlayerId, 'pin-seed' as Seed),
    ).toThrowError(/^unhandled playDevCard card kind: /);
  });
});
