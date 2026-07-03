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
  parseGameEventLog,
  type PlayerId,
  type PlayerState,
  replay,
  type VertexId,
} from '@skervik/core';
import type {
  EventBatchMessage,
  RejectMessage,
  StateSnapshotMessage,
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

  it('turn-gate: a seated player acting under its OWN id on another player’s turn → NOT_YOUR_TURN (NIT-3)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room);
    const c2 = await testServer.connectTo(room);
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

  // --- S1.4.3 commit-reveal: reveal at game end + leak checklist ------------

  it('reveals the secret seed to match metadata EXACTLY on the game.ended batch, and seedHash === sha256Hex(revealed seed)', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME);
    const c1 = await testServer.connectTo(room);
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
    const c1 = await testServer.connectTo(room);
    const c2 = await testServer.connectTo(room);
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
    const c1 = await testServer.connectTo(room);
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

      const c1 = await testServer.connectTo(room);
      const c2 = await testServer.connectTo(room);
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
    const c1 = await testServer.connectTo(room);
    const c2 = await testServer.connectTo(room);
    await nextTick();

    const a = c1.sessionId;
    const b = c2.sessionId;
    startMainTurn(room, a, b, a);

    // Inject a sink that fails every write (a durable-FS error). The pipeline
    // awaits `append` BEFORE committing/broadcasting, so this must degrade
    // gracefully: reject to the sender, leave state untouched, never crash.
    const throwingSink: GameEventSink = {
      append() {
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
});
