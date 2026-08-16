// S1.4.1 — GameRoom shell: seed generation, the minimal public projection,
// and join/leave/seat-cap behavior. Uses the official `@colyseus/testing`
// harness (a real Colyseus server + WS client) — this IS the Fork 4 ESM/Node
// 22 spike, exercised end to end rather than by reaching into Room internals.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { boot, type ColyseusTestServer } from '@colyseus/testing';
import {
  type BoardGeneratedEvent,
  buildTopology,
  type EdgeId,
  type GameEndedEvent,
  type GameState,
  generateBoard,
  loadRuleProfile,
  type MatchStartedEvent,
  NEUTRAL_OWNER_ID,
  type NeutralPlacedEvent,
  neutralPlacementEvents,
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createGameServer, GAME_ROOM_NAME, type GameRoom } from '../index.js';
import {
  InMemoryMatchMetadataStore,
  type MatchMetadataStore,
  type MatchResultMetadata,
  type MatchStartMetadata,
  NoopMatchMetadataStore,
} from '../matchMetadata.js';
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

// --- S2.6.3 durable match-metadata helpers ----------------------------------
/** Polls `nextTick` until `pred` holds or the tick budget runs out (drains the #queue). */
async function waitFor(pred: () => boolean, ticks = 40): Promise<void> {
  for (let i = 0; i < ticks && !pred(); i += 1) await nextTick();
}

/** Canonicalizes past the per-run random roomId/winner-sessionId so two runs deep-compare. */
function canonicalizeMeta(value: unknown, winnerId: string, roomId: string): unknown {
  let json = JSON.stringify(value);
  json = json.split(roomId).join('__ROOM__');
  json = json.split(winnerId).join('__WINNER__');
  return JSON.parse(json);
}

/** A store whose every write rejects ASYNCHRONOUSLY — the realistic DB/FS failure (S2.6.3 AC4). */
class ThrowingMatchMetadataStore implements MatchMetadataStore {
  async recordSeedReveal(): Promise<void> {
    throw new Error('seed reveal write failed');
  }
  readSeedReveal(): null {
    return null;
  }
  async recordMatchStart(): Promise<void> {
    throw new Error('match-start write failed');
  }
  async recordMatchResult(): Promise<void> {
    throw new Error('match-result write failed');
  }
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

  // S2.3.1: `client.leave()` (no args) defaults to a CONSENTED leave (the SDK
  // sends `Protocol.LEAVE_ROOM`), so Colyseus dispatches straight to `onLeave`
  // — no grace hold (that boundary, and the non-consented `onDrop` grace path,
  // are covered by the S2.3.1 suite below). This M1 property — disconnect
  // marks the seat without ever touching the authoritative GameState — still
  // holds unchanged for the consented path.
  it('a consented .leave() marks the seat disconnected without mutating the authoritative GameState (no grace hold)', async () => {
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

  // --- S2.1.6: 2-player mode via room options (NO default change) ----------
  // A room created with `maxSeats: 2` + `profileId: 'twoPlayer'` starts on
  // seats-full and emits the neutral/phantom blockers as genesis events through
  // the SAME persist→commit→broadcast pipeline. The production default
  // (classic/4, proven by the Phase A tests above) is untouched — mode SELECTION
  // is S2.5.4; this just proves the option wires the mechanic end to end.

  it('a maxSeats:2 + twoPlayer room starts and places the neutral blockers at genesis', async () => {
    const sink = new InMemoryEventSink();
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 2,
      profileId: 'twoPlayer',
      seed: MATCH_START_SEED,
      sink,
    });
    const seatIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      seatIds.push((await testServer.connectTo(room, CONNECT_OPTS)).sessionId);
    }
    await nextTick();

    // Started under the twoPlayer profile.
    expect(room.gameState.phase).toBe('setup');
    expect(room.gameState.profileId).toBe('twoPlayer');
    expect(room.gameState.players.map((p) => p.id)).toEqual(seatIds);

    const expectedNeutrals = loadRuleProfile('twoPlayer').neutralSettlements ?? 0;
    // Genesis batch: match.started, board.generated, then the neutral blockers.
    expect(sink.events.map((e) => e.type)).toEqual([
      'match.started',
      'board.generated',
      ...Array<string>(expectedNeutrals).fill('neutral.placed'),
    ]);
    expect((sink.events[0] as MatchStartedEvent).profileId).toBe('twoPlayer');

    // The blockers landed on the board under the reserved neutral id, at the
    // SAME deterministic vertices the pure policy computes from this board.
    const neutralVertices = sink.events
      .filter((e): e is NeutralPlacedEvent => e.type === 'neutral.placed')
      .map((e) => e.vertexId);
    expect(neutralVertices).toHaveLength(expectedNeutrals);
    for (const vertexId of neutralVertices) {
      expect(room.gameState.buildings?.settlements[vertexId]).toBe(NEUTRAL_OWNER_ID);
    }
    const layout = generateBoard(
      MATCH_START_SEED,
      buildTopology(),
      loadRuleProfile('twoPlayer').board,
    );
    expect(neutralVertices).toEqual(
      neutralPlacementEvents(layout, expectedNeutrals, 2).map((e) => e.vertexId),
    );
    // eventIndex advanced past every genesis event (2 + neutral count).
    expect(room.gameState.eventIndex).toBe(2 + expectedNeutrals);
  });

  it('the default room (no profileId) stays Classic and emits NO neutral events', async () => {
    const { room, sink } = await seatFullRoom(3);
    expect(room.gameState.profileId).toBe('classic');
    expect(sink.events.some((e) => e.type === 'neutral.placed')).toBe(false);
  });

  // --- S2.1.7b D1/D2: seats + topology derive from the profile --------------
  // `maxClients` now defaults from `loadRuleProfile(profileId).maxSeats`
  // instead of a hardcoded constant, and `#startMatch` resolves its genesis
  // topology via `topologyForRadius(board.radius, board.ports.length)` — the
  // SAME memoized per-radius seam `@skervik/core` exposes — instead of the old
  // always-radius-2 `buildTopology()`, so an `expanded` room's genesis board is
  // actually radius-3/37-tile, not silently radius-2/19-tile.

  it("an 'expanded' room defaults maxClients to the profile's own maxSeats (6) with no maxSeats option passed at all", async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      profileId: 'expanded',
      seed: MATCH_START_SEED,
    });
    expect(loadRuleProfile('expanded').maxSeats).toBe(6);
    expect(room.maxClients).toBe(6);
  });

  it('an explicit maxSeats option still overrides the profile default, even for expanded (D1: an override, never a removal) — mirrors the existing 1-4 seat override cases', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      profileId: 'expanded',
      maxSeats: 2,
      seed: MATCH_START_SEED,
    });
    expect(room.maxClients).toBe(2);
  });

  it("[forcing] an 'expanded' room generates a 37-tile board, and a classic room created in the SAME process still generates 19 — proves topologyForRadius's per-radius memo serves two live rooms correctly (the old process-global buildTopology() singleton, always radius-2, could not). This test fails if GameRoom goes back to a no-arg buildTopology() call.", async () => {
    const classic = await seatFullRoom(3);
    const classicBoard = classic.sink.events.find(
      (e): e is BoardGeneratedEvent => e.type === 'board.generated',
    );
    expect(classicBoard).toBeDefined();
    expect(Object.keys(classicBoard?.tileKinds ?? {})).toHaveLength(19);

    const expandedSink = new InMemoryEventSink();
    const expandedRoom = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      profileId: 'expanded',
      seed: MATCH_START_SEED,
      sink: expandedSink,
    });
    for (let i = 0; i < 6; i++) {
      await testServer.connectTo(expandedRoom, CONNECT_OPTS);
    }
    await nextTick();

    expect(expandedRoom.gameState.phase).toBe('setup');
    expect(expandedRoom.gameState.profileId).toBe('expanded');
    const expandedBoard = expandedSink.events.find(
      (e): e is BoardGeneratedEvent => e.type === 'board.generated',
    );
    expect(expandedBoard).toBeDefined();
    expect(Object.keys(expandedBoard?.tileKinds ?? {})).toHaveLength(37);

    // Same fixed seed, different profile -> genuinely different layouts, not a
    // stale radius-2 board silently reused for the expanded room.
    expect(expandedBoard?.tileKinds).not.toEqual(classicBoard?.tileKinds);
  });

  // --- S2.3.1: reconnect grace ("no karmic bans") -------------------------
  // Colyseus 0.17 splits the M1-era single `onLeave(client, consented)` stub
  // into `onDrop` (non-consented, network drop) + `onLeave` (consented leave,
  // and the terminal notice once a drop's grace expires with no reconnect) —
  // see `GameRoom.onDrop`'s doc comment. `client.leave(false)` (the SDK's
  // non-consented form) closes the raw socket without sending `LEAVE_ROOM`,
  // so the server sees a close code other than `CloseCode.CONSENTED` and
  // dispatches to `onDrop`. `#reconnectGraceSeconds` is a small REAL value in
  // every test here — Colyseus's own `allowReconnection` expiry timer is an
  // internal wall-clock `setTimeout` in `@colyseus/core` with no scheduler
  // seam (unlike the room's OWN `#armTurnTimer`, which stays on the injectable
  // `turnTimerScheduler` and is untouched by this story) — so "fast and
  // deterministic" here means a short real wait, the same idiom `nextTick()`
  // already uses elsewhere in this file, never anything close to a real 120s.

  it('grace hold + reclaim: a non-consented drop holds the seat; reconnecting within grace reclaims it with the gameState byte-identical throughout', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      reconnectGraceSeconds: 5,
    });
    const client = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const sessionId = client.sessionId;
    const reconnectionToken = client.reconnectionToken;
    const gameStateBefore = JSON.stringify(room.gameState);

    await client.leave(false); // non-consented (raw close, no LEAVE_ROOM) → onDrop
    await nextTick();

    expect(room.state.seats).toHaveLength(1); // held, not removed
    expect(room.state.seats.find((s) => s.playerId === sessionId)?.connected).toBe(false);
    expect(JSON.stringify(room.gameState)).toBe(gameStateBefore);

    const reconnected = await testServer.sdk.reconnect(reconnectionToken);
    await nextTick();

    expect(reconnected.sessionId).toBe(sessionId); // SAME seat/session, no identity remap
    expect(room.state.seats.find((s) => s.playerId === sessionId)?.connected).toBe(true);
    expect(JSON.stringify(room.gameState)).toBe(gameStateBefore); // untouched across the whole cycle

    await reconnected.leave();
  });

  // --- S2.3.2: the server half of the resync — a fresh snapshot at reclaim --

  it('S2.3.2 reclaim resync: the reclaimed client receives a SECOND state.snapshot of the CURRENT gameState (unicast, not broadcast); the join snapshot behavior is unchanged', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 2,
      reconnectGraceSeconds: 5,
    });

    // c1: capture every state.snapshot it ever receives (join + reclaim).
    const snapshotsForC1: StateSnapshotMessage[] = [];
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    c1.onMessage('state.snapshot', (m: StateSnapshotMessage) => snapshotsForC1.push(m));
    await nextTick();

    // c2: a second, never-dropped client — proves the reclaim resync is a
    // UNICAST (it must see nothing beyond its own join snapshot).
    const snapshotsForC2: StateSnapshotMessage[] = [];
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
    c2.onMessage('state.snapshot', (m: StateSnapshotMessage) => snapshotsForC2.push(m));
    await nextTick();

    expect(snapshotsForC1).toHaveLength(1); // onJoin behavior UNCHANGED
    expect(snapshotsForC2).toHaveLength(1);

    const sessionId = c1.sessionId;
    const reconnectionToken = c1.reconnectionToken;

    await c1.leave(false); // non-consented drop → onDrop grace hold
    await nextTick();

    const reconnected = await testServer.sdk.reconnect(reconnectionToken);
    reconnected.onMessage('state.snapshot', (m: StateSnapshotMessage) =>
      snapshotsForC1.push(m),
    );
    await nextTick();

    expect(reconnected.sessionId).toBe(sessionId); // same seat/session, reclaim not a fresh join

    // The reclaim unicast — a SECOND snapshot, minted from the CURRENT
    // authoritative gameState (post any forced actions), still seed-free.
    expect(snapshotsForC1).toHaveLength(2);
    expect(snapshotsForC1[1]?.type).toBe('state.snapshot');
    expect(JSON.stringify(snapshotsForC1[1]?.payload)).toBe(
      JSON.stringify(room.gameState),
    );
    expect(Object.keys(snapshotsForC1[1]?.payload ?? {})).not.toContain('seed');

    // c2 (never dropped) received nothing extra — this was a unicast.
    expect(snapshotsForC2).toHaveLength(1);

    await reconnected.leave();
    await c2.leave();
  });

  it('grace expiry, no forfeit: a dropped client that never reconnects leaves the seat held, connected:false, no crash', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      reconnectGraceSeconds: 0.05, // tiny REAL grace — no scheduler seam on Colyseus's own timer
    });
    const client = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const sessionId = client.sessionId;

    await client.leave(false);
    await nextTick();
    // Wait past the 50ms grace window (short real wait, not a 120s sleep).
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(room.state.seats).toHaveLength(1); // NO forfeit — the seat is never removed
    expect(room.state.seats.find((s) => s.playerId === sessionId)?.connected).toBe(false);
  });

  it('the turn timer keeps running through grace: an absent current player is forced past, and reconnect resumes on the resulting consistent state', async () => {
    const scheduler = new ManualScheduler();
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      seed: MATCH_START_SEED,
      turnTimerScheduler: scheduler,
      reconnectGraceSeconds: 30,
    });
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const a = c1.sessionId;
    const b = c2.sessionId;
    const reconnectionToken = c1.reconnectionToken;

    // A main-phase turn owned by `a`, holding just enough for one proposeTrade
    // — a committing action that STAYS in `main`, so it (re-)arms the hard
    // timer for `a`'s own turn (mirrors the S2.1.4 test above).
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
    expect(scheduler.armed).toBe(true);
    expect(room.gameState.currentPlayerId).toBe(a);

    // `a` drops (non-consented) while still the current player — the timer is
    // NOT paused, and the seat is held for reconnect.
    await c1.leave(false);
    await nextTick();
    expect(room.state.seats.find((s) => s.playerId === a)?.connected).toBe(false);

    // The hard timeout still fires a forced default for the absent `a` — the
    // match advances to `b` exactly as it would for a connected player.
    scheduler.fire();
    await nextTick();
    expect(room.gameState.currentPlayerId).toBe(b);
    expect(room.gameState.phase).toBe('roll');
    const gameStateAfterForce = JSON.stringify(room.gameState);

    // `a` reconnects within grace and resumes on that SAME consistent state —
    // reconnect itself advances nothing further.
    const reconnected = await testServer.sdk.reconnect(reconnectionToken);
    await nextTick();
    expect(reconnected.sessionId).toBe(a);
    expect(room.state.seats.find((s) => s.playerId === a)?.connected).toBe(true);
    expect(JSON.stringify(room.gameState)).toBe(gameStateAfterForce);

    await reconnected.leave();
    await c2.leave();
  });

  it('no auto-dispose during grace: a single-human room whose human drops does not dispose before grace expiry', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 1,
      reconnectGraceSeconds: 0.3,
    });
    const client = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const disposeSpy = vi.spyOn(room, 'onDispose');

    await client.leave(false);
    await nextTick();
    // Still well within the grace window — Colyseus's own reserved-seat
    // bookkeeping behind `allowReconnection` keeps the room alive even at
    // zero live clients (a bot-filled single-player room keeps playing the
    // same way while its one human is held).
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('determinism guard: a drop + reconnect cycle appends ZERO events, leaving gameState byte-identical', async () => {
    const sink = new InMemoryEventSink();
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 2,
      sink,
      reconnectGraceSeconds: 5,
    });
    const client = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    const reconnectionToken = client.reconnectionToken;
    const eventsBefore = sink.events.length;
    const gameStateBefore = JSON.stringify(room.gameState);

    await client.leave(false); // non-consented drop
    await nextTick();
    expect(sink.events).toHaveLength(eventsBefore); // the drop appended NO event

    const reconnected = await testServer.sdk.reconnect(reconnectionToken);
    await nextTick();
    expect(sink.events).toHaveLength(eventsBefore); // the reclaim appended NO event either
    expect(JSON.stringify(room.gameState)).toBe(gameStateBefore);

    await reconnected.leave();
  });

  // --- S2.6.3 durable match-metadata lifecycle (AC2/AC3/AC4) -----------------
  // Reuses this describe's ONE booted testServer + the driveToNearWin harness.
  // Proves the room drives the metadata seam once per lifecycle edge, that the
  // store choice cannot perturb the deterministic game, and that a throwing
  // store never crashes or blocks the room.
  describe('durable match metadata (S2.6.3)', () => {
    it('AC2 (forcing): recordMatchStart fires once at start, recordMatchResult once at game.ended', async () => {
      const store = new InMemoryMatchMetadataStore();
      // maxSeats:1 → the single human join fills the room and auto-fires #startMatch.
      const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
        maxSeats: 1,
        metadataStore: store,
      });
      const c1 = await testServer.connectTo(room, CONNECT_OPTS);
      await waitFor(() => room.gameState.phase !== 'lobby');

      // START recorded exactly once, with the authoritative start payload.
      expect(store.starts.size).toBe(1);
      const start: MatchStartMetadata | undefined = store.starts.get(room.roomId);
      expect(start).toMatchObject({
        roomId: room.roomId,
        seedHash: room.gameState.seedHash,
        playerCount: 1,
      });
      expect(start?.profile).toBeDefined();
      expect(start?.startedAt).toBeInstanceOf(Date);
      expect(store.results.size).toBe(0);

      // Drive the seated client to a one-move win, then fire the winning intent.
      const winner = c1.sessionId;
      driveToNearWin(room, winner);
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
      // The result write runs on the queue tail AFTER commit+broadcast, so wait
      // for it directly (phase flips earlier, at commit) — the forcing signal.
      await waitFor(() => store.results.size === 1);
      expect(room.gameState.phase).toBe('finished');

      // RESULT recorded exactly once; START not re-fired (both latched).
      expect(store.starts.size).toBe(1);
      expect(store.results.size).toBe(1);
      const result: MatchResultMetadata | undefined = store.results.get(room.roomId);
      expect(result?.playerResults).toHaveLength(1);
      expect(result?.playerResults[0]).toMatchObject({ seat: 0, result: 'win' });
      // finalVp is the AUTHORITATIVE game.ended tally (core's computeVictoryPoints).
      const ended = batches
        .flatMap((b) => b.payload)
        .find((e): e is GameEndedEvent => e.type === 'game.ended');
      expect(ended).toBeDefined();
      expect(result?.playerResults[0]?.finalVp).toBe(ended?.finalStandings[winner]);
      // No session token was presented → winner_id / user_id resolve to null.
      expect(result?.winnerUserId).toBeUndefined();
      expect(result?.playerResults[0]?.userId).toBeUndefined();
      expect(result?.seed).toMatch(/^[0-9a-f]{64}$/);

      await c1.leave();
    });

    // S2.6.4 C2: an authenticated human who DROPS before game.ended is gone from
    // `this.clients`, but their `userId` was captured in `onAuth` into the
    // room-private `#seatUserIds` map — so `#resolveUserIdForSeat` still resolves
    // it, and their `match_players` row keeps the linkage (result 'abandoned')
    // instead of a spurious NULL. Without the capture the seat would export as
    // NULL and the match would vanish from that user's GDPR export.
    it('C2: a dropped authenticated seat keeps its user_id in the result (abandoned, not NULL)', async () => {
      const store = new InMemoryMatchMetadataStore();
      const verify = async (
        token: string,
      ): Promise<{ userId: string; displayName: string } | null> =>
        token === 'token-A' ? { userId: 'user-A', displayName: 'A' } : null;
      // maxSeats:2 so a SECOND (never-dropped) seat drives the win to game.ended
      // after the authed seat drops; large grace so no bot-fill converts the seat.
      const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
        maxSeats: 2,
        metadataStore: store,
        reconnectGraceSeconds: 30,
        verifySessionToken: verify,
      });

      // Seat 0 authenticates (userId captured in onAuth); seat 1 is a fresh guest.
      const cA = await testServer.connectTo(room, {
        protocolVersion: PROTOCOL_VERSION,
        sessionToken: 'token-A',
      });
      const cB = await testServer.connectTo(room, CONNECT_OPTS);
      await waitFor(() => room.gameState.phase !== 'lobby');
      const seatAId = cA.sessionId;
      const winner = cB.sessionId;

      // A drops (non-consented) before the match ends — removed from this.clients,
      // seat retained + connected:false, NOT bot-filled (grace pending).
      await cA.leave(false);
      await nextTick();
      expect(room.state.seats.find((s) => s.playerId === seatAId)?.connected).toBe(false);
      expect(room.state.seats.find((s) => s.playerId === seatAId)?.isBot).toBe(false);

      // B drives to a one-move win → game.ended → recordMatchResult on the tail.
      driveToNearWin(room, winner);
      cB.send('intent', {
        v: 1,
        type: 'intent',
        payload: {
          type: 'intent.buildSettlement',
          playerId: winner,
          vertexId: winTarget.id,
        },
      });
      await waitFor(() => store.results.size === 1);

      const result = store.results.get(room.roomId);
      const seatA = result?.playerResults.find((p) => p.seat === 0);
      // The dropped authed seat: 'abandoned' AND its captured userId retained.
      expect(seatA?.result).toBe('abandoned');
      expect(seatA?.userId).toBe('user-A');

      await cB.leave();
    });

    it('AC3 (determinism): the winning batch + final gameState are byte-identical with a Noop vs a recording store, and no metadata enters the log', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'skervik-meta-det-'));
      try {
        const runWin = async (
          store: MatchMetadataStore,
        ): Promise<{
          payload: unknown;
          finalState: GameState;
          winnerId: string;
          roomId: string;
        }> => {
          const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
            maxSeats: 1,
            metadataStore: store,
            matchesDir: tempDir,
            // A FIXED seed so both runs share a seedHash — driveToNearWin then
            // crafts an otherwise-identical state, isolating the store as the ONLY
            // difference; canonicalizing the random roomId/winnerId proves equality.
            seed: 'b'.repeat(64) as Seed,
          });
          const c1 = await testServer.connectTo(room, CONNECT_OPTS);
          await waitFor(() => room.gameState.phase !== 'lobby');
          const winner = c1.sessionId;
          driveToNearWin(room, winner);
          const batches: EventBatchMessage[] = [];
          let endedSeen = false;
          c1.onMessage('event.batch', (m: EventBatchMessage) => {
            batches.push(m);
            if (m.payload.some((e) => e.type === 'game.ended')) endedSeen = true;
          });
          c1.send('intent', {
            v: 1,
            type: 'intent',
            payload: {
              type: 'intent.buildSettlement',
              playerId: winner,
              vertexId: winTarget.id,
            },
          });
          // Wait until the client OBSERVES the game.ended batch (phase commits first).
          await waitFor(() => endedSeen);
          const winBatch = batches
            .map((b) => b.payload)
            .find((p) => p.some((e) => e.type === 'game.ended'));
          const finalState = structuredClone(room.gameState);
          const roomId = room.roomId;
          await c1.leave();
          return { payload: winBatch, finalState, winnerId: winner, roomId };
        };

        const noop = await runWin(new NoopMatchMetadataStore());
        const rec = await runWin(new InMemoryMatchMetadataStore());

        // The store choice cannot change the game: canonicalized past the per-run
        // random ids, the winning batch AND the final gameState are byte-identical.
        expect(canonicalizeMeta(rec.payload, rec.winnerId, rec.roomId)).toEqual(
          canonicalizeMeta(noop.payload, noop.winnerId, noop.roomId),
        );
        expect(canonicalizeMeta(rec.finalState, rec.winnerId, rec.roomId)).toEqual(
          canonicalizeMeta(noop.finalState, noop.winnerId, noop.roomId),
        );

        // The metadata NEVER enters the replayable event log (ADR-0009 Fork 3):
        // the ndjson carries GameEvents only, none of the metadata-only fields.
        const ndjson = await readFile(join(tempDir, rec.roomId, 'events.ndjson'), 'utf8');
        for (const forbidden of [
          'eventLogUri',
          'finalVp',
          'winnerUserId',
          'playerResults',
          'startedAt',
          'finishedAt',
        ]) {
          expect(ndjson).not.toContain(forbidden);
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('AC4 (best-effort isolation): a THROWING metadata store never crashes or blocks the room — the match starts, completes, log intact', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'skervik-meta-throw-'));
      try {
        const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
          maxSeats: 1,
          metadataStore: new ThrowingMatchMetadataStore(),
          matchesDir: tempDir,
        });
        const c1 = await testServer.connectTo(room, CONNECT_OPTS);
        // recordMatchStart rejected — but genesis still committed + broadcast.
        await waitFor(() => room.gameState.phase !== 'lobby');
        expect(room.gameState.phase).toBe('setup');

        const winner = c1.sessionId;
        driveToNearWin(room, winner);
        const batches: EventBatchMessage[] = [];
        let endedSeen = false;
        c1.onMessage('event.batch', (m: EventBatchMessage) => {
          batches.push(m);
          if (m.payload.some((e) => e.type === 'game.ended')) endedSeen = true;
        });
        c1.send('intent', {
          v: 1,
          type: 'intent',
          payload: {
            type: 'intent.buildSettlement',
            playerId: winner,
            vertexId: winTarget.id,
          },
        });
        // recordSeedReveal + recordMatchResult both reject — but the batch already
        // persisted + committed + broadcast, so the match reaches game.ended anyway.
        await waitFor(() => endedSeen);
        expect(room.gameState.phase).toBe('finished');
        expect(
          batches.flatMap((b) => b.payload).some((e) => e.type === 'game.ended'),
        ).toBe(true);

        // The durable log is intact — the winning game.ended is on disk (persist
        // happened BEFORE the throwing metadata write, which never touched it).
        const ndjson = await readFile(
          join(tempDir, room.roomId, 'events.ndjson'),
          'utf8',
        );
        expect(ndjson).toContain('game.ended');

        await c1.leave();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
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
