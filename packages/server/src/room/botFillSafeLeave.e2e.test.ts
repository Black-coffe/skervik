// S2.3.3 — bot-fill on grace expiry + safe leave/rejoin (closes E2.3). Proves
// the epic-closing "no dead time / no karmic ban" capability against the REAL
// authoritative room pipeline (`@colyseus/testing`, in-process, no sockets):
//
//   1. A human that DROPS and never reconnects (grace expiry) has its seat
//      taken over by a fill-bot that drives it to a real `game.ended` — through
//      the SAME S2.4.3 `#driveBotTurn`/`#queue` tail, no new pipeline.
//   2. A human that deliberately (CONSENTED) leaves is bot-filled IMMEDIATELY
//      (not grace-held) — the remaining humans keep playing.
//   3. A drop+bot-fill match replays BYTE-IDENTICALLY from its event log (the
//      fill-bot's moves are ordinary events; the wall-clock expiry trigger is
//      server-only, never logged).
//   4. `game.ended` force-closes clients with the CONSENTED code (4000) so a
//      post-match reload clears the client's reconnect pointer (S2.3.2a nit #3).
//   5. Classic byte-frozen: a match with NO drops installs no fill-bot.
import { ColyseusTestServer } from '@colyseus/testing';
import { createHeuristicBot } from '@skervik/bots';
import {
  buildTopology,
  type EdgeId,
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerState,
  replay,
  type Seed,
  type VertexId,
} from '@skervik/core';
import { PROTOCOL_VERSION } from '@skervik/protocol';
import type { Server } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGameServer, GAME_ROOM_NAME, type GameRoom } from '../index.js';
import { InMemoryEventSink } from './eventSink.js';

/** Gives the room's queued async work a tick to settle (mirrors botFill.e2e.test.ts). */
function nextTick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Boots this file's server on its OWN port so it never collides with the default
 * `boot()` port `GameRoom.test.ts` uses or `botFill.e2e.test.ts`'s 2569 (vitest
 * runs files in parallel workers) — mirrors `botFill.e2e.test.ts`'s helper.
 */
async function bootOnPort(gameServer: Server, port: number): Promise<ColyseusTestServer> {
  await gameServer.listen(port);
  return new ColyseusTestServer(gameServer);
}

const CONNECT_OPTS = { protocolVersion: PROTOCOL_VERSION } as const;

/** The Colyseus `CloseCode.CONSENTED` value the S2.3.2a client clears its reconnect pointer on. */
const CONSENTED_CLOSE_CODE = 4000;

/**
 * The known-terminating seed the S2.4.2/S2.4.3 bots already prove reaches
 * `game.ended` at every difficulty (`packages/bots/src/harness.test.ts`,
 * `botFill.e2e.test.ts`) — reused so a mid-match human→bot handover rides a
 * board/roll sequence proven to terminate rather than an unproven fresh one.
 */
const SEED: Seed = 'skervik-s1.7.2-e2e-match-seed';

/** Polls until the room reaches `'finished'` — bot steps are microtask-chained, so this settles fast. */
async function waitForFinished(room: GameRoom, timeoutMs = 45000): Promise<void> {
  const start = Date.now();
  while (room.gameState.phase !== 'finished') {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `bot-filled match did not reach 'finished' within ${timeoutMs}ms ` +
          `(phase=${room.gameState.phase}, turn=${room.gameState.turn})`,
      );
    }
    await nextTick(10);
  }
}

/**
 * Whether `id` is the seat that owes the next authoritative action given `state`
 * — mirrors the room's own `#nextBotActorId`, so the test drives the human's
 * seat exactly where the pipeline expects it to act (setup placements, roll,
 * main, a robber move, or a post-7 discard).
 */
function seatOwesAction(state: GameState, id: PlayerId): boolean {
  if (state.phase === 'robber') {
    const owing = state.playersToDiscard ?? [];
    if (owing.length > 0) return owing.includes(id);
    return state.currentPlayerId === id;
  }
  if (state.phase === 'setup' || state.phase === 'roll' || state.phase === 'main') {
    return state.currentPlayerId === id;
  }
  return false;
}

/**
 * Runs a 2-HUMAN Classic match, driving both with a heuristic brain through
 * setup, then ABANDONING one seat at the first post-setup state — by a
 * non-consented drop (grace expiry) or a consented leave. The OTHER human stays
 * connected (so a fill is warranted — bot-fill exists for the remaining humans),
 * the abandoned seat is taken over by a fill-bot, and the fill-bot + the driven
 * remaining human play the match to a real `game.ended`. Returns the live room +
 * its event sink + both seat ids.
 */
async function runAbandonedMatch(
  testServer: ColyseusTestServer,
  mode: 'drop' | 'consented',
): Promise<{
  room: GameRoom;
  sink: InMemoryEventSink;
  abandonedId: PlayerId;
  remainingId: PlayerId;
}> {
  const sink = new InMemoryEventSink();
  const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
    maxSeats: 2,
    seed: SEED,
    sink,
    reconnectGraceSeconds: 0.05, // tiny REAL grace — the expiry path fires fast
    botFillDifficulty: 'hard',
  });

  const h1 = await testServer.connectTo(room, CONNECT_OPTS); // the seat that will be abandoned
  const h2 = await testServer.connectTo(room, CONNECT_OPTS); // the remaining human
  await nextTick();
  const abandonedId = h1.sessionId as PlayerId;
  const remainingId = h2.sessionId as PlayerId;
  expect(room.gameState.phase).toBe('setup');

  // A heuristic brain the TEST uses to play each human's OWN turns (its seed is
  // arbitrary — it only drives sent intents, holds no authority). After the
  // abandon the fill-bot auto-drives the abandoned seat via the room's queue.
  const brain = createHeuristicBot({ difficulty: 'hard', seed: 'test-brain' });
  const sendFor = (client: typeof h1, id: PlayerId): void => {
    const intent = brain.decide(room.gameState, id);
    if (intent) client.send('intent', { v: 1, type: 'intent', payload: intent });
  };

  let abandoned = false;
  for (let i = 0; i < 20000 && room.gameState.phase !== 'finished'; i += 1) {
    const state = room.gameState;

    // Abandon h1 at the FIRST post-setup state (h1 has now placed its setup
    // settlements/roads — a genuine "played, then left" seat), so the fill-bot
    // carries h1's whole main phase while h2 (still human) plays on.
    if (!abandoned && state.phase !== 'lobby' && state.phase !== 'setup') {
      if (mode === 'drop') {
        await h1.leave(false); // non-consented → grace hold → expiry → fill
        await nextTick(250); // let the 50ms grace expire + `.catch()` install the bot
      } else {
        await h1.leave(true); // consented → immediate fill
        await nextTick();
      }
      abandoned = true;
      continue;
    }

    // Drive whichever HUMAN still owes an action (h1 only until it is abandoned;
    // h2 for the whole match).
    if (!abandoned && seatOwesAction(state, abandonedId)) sendFor(h1, abandonedId);
    if (seatOwesAction(state, remainingId)) sendFor(h2, remainingId);
    await nextTick(10);
  }

  await waitForFinished(room);
  return { room, sink, abandonedId, remainingId };
}

// --- Near-win craft for the game-end consented-close test (mirrors -----------
// GameRoom.test.ts `driveToNearWin`): a target vertex with an own road to build
// onto + 4 city vertices clear of it, so ONE buildSettlement takes the acting
// player from 9 VP (8 cities + 1 hidden VP card) to 10 → core appends game.ended.
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
const RICH = { timber: 9, clay: 9, fleece: 9, barley: 9, iron: 9 } as const;

/** Crafts a `main`-phase state one settlement away from a win for `winner`. */
function driveToNearWin(room: GameRoom, winner: string): void {
  const cities: Record<string, string> = {};
  for (const vertexId of winCityVertices) cities[vertexId] = winner;
  room.gameState = {
    ...room.gameState,
    phase: 'main',
    turn: 5,
    currentPlayerId: winner as PlayerId,
    players: [
      { id: winner as PlayerId, name: winner, victoryPoints: 0, resources: { ...RICH } },
    ],
    playerOrder: [winner as PlayerId],
    buildings: { settlements: {}, roads: { [winRoadEdge]: winner }, cities },
    devCards: { [winner]: { held: { victoryPoint: 1 }, boughtThisTurn: {} } },
  };
  room.state.phase = 'main';
  room.state.currentPlayerId = winner;
}

/**
 * A manual scheduler (S2.1.4 test seam, reused here to fire the S2.3.3 game-end
 * close deterministically — `@colyseus/testing` has no tickable clock). Only one
 * timer is armed at a time (the game-end close is scheduled only once, after the
 * turn timer is cleared at `'finished'`), so a single slot suffices.
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

  fire(): void {
    const entry = this.#pending;
    if (!entry) throw new Error('no timer armed to fire');
    this.#pending = null;
    entry.cb();
  }
}

function player(id: string): PlayerState {
  return { id: id as PlayerId, name: id, victoryPoints: 0, resources: {} };
}

describe('S2.3.3 — bot-fill on grace expiry + safe leave + game-end consented close', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    testServer = await bootOnPort(createGameServer(), 2570);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  // --- 1. Grace-expiry bot-fill drives the abandoned seat to game.ended ------

  it('grace expiry: a dropped human that never reconnects is bot-filled and driven to a real game.ended', async () => {
    const { room, sink, abandonedId } = await runAbandonedMatch(testServer, 'drop');

    expect(room.gameState.phase).toBe('finished');

    // The abandoned seat is now bot-driven — its existing `isBot`/`botDifficulty`
    // client-signal fields flipped (NO new SeatSchema field), still
    // `connected:false` (a filled human seat, distinct from a genesis bot's
    // `connected:true`).
    const seat = room.state.seats.find((s) => s.playerId === abandonedId);
    expect(seat?.isBot).toBe(true);
    expect(seat?.connected).toBe(false);
    expect(seat?.botDifficulty).toBe('hard');

    const ended = sink.events.find((e) => e.type === 'game.ended') as
      GameEndedEvent | undefined;
    expect(ended).toBeDefined();
    const winnerVp = ended ? ended.finalStandings[ended.winnerId] : undefined;
    expect(winnerVp).toBeGreaterThanOrEqual(10);

    // The fill-bot's moves are ORDINARY events — no timestamp/marker leaked into
    // the log, exactly like a genesis bot's (S2.3.3 determinism binding).
    expect(JSON.stringify(sink.events)).not.toMatch(/timestamp|isBot|"bot-fill"/i);
  }, 60000);

  // --- 2. Consented leave installs the fill-bot immediately ------------------

  it('consented leave: a deliberate leaver is bot-filled immediately and the match still finishes', async () => {
    const { room, abandonedId } = await runAbandonedMatch(testServer, 'consented');

    expect(room.gameState.phase).toBe('finished');
    const seat = room.state.seats.find((s) => s.playerId === abandonedId);
    expect(seat?.isBot).toBe(true);
    expect(seat?.connected).toBe(false);
  }, 60000);

  // --- 3. Replay byte-identity of a drop+bot-fill match ----------------------

  it('replay equality: a drop+bot-fill match replays from its event log to the authoritative final state', async () => {
    const { room, sink } = await runAbandonedMatch(testServer, 'drop');
    const base: GameState = {
      matchId: room.gameState.matchId,
      phase: 'lobby',
      turn: 0,
      currentPlayerId: '',
      players: [],
      eventIndex: 0,
      seedHash: room.gameState.seedHash,
    };
    // The fill-bot's moves + the human's are ordinary log events; the expiry
    // trigger is server-only (never logged) — so the persisted stream folds
    // byte-identically back to the live authoritative state.
    expect(replay(base, sink.events)).toEqual(room.gameState);
  }, 60000);

  // --- 4. game.ended force-closes clients with the CONSENTED code ------------

  it('game end: the room closes its clients with the CONSENTED code (4000) so a post-match reload clears the reconnect pointer', async () => {
    const scheduler = new ManualScheduler();
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 1,
      seed: SEED,
      turnTimerScheduler: scheduler,
    });
    const client = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    let leaveCode: number | undefined;
    const batches: GameEvent[][] = [];
    client.onLeave((code: number) => {
      leaveCode = code;
    });
    client.onMessage('event.batch', (m: { payload: GameEvent[] }) => {
      batches.push(m.payload);
    });

    // One buildSettlement takes the seat from 9 → 10 VP → core appends game.ended.
    const winner = client.sessionId;
    driveToNearWin(room, winner);
    client.send('intent', {
      v: 1,
      type: 'intent',
      payload: {
        type: 'intent.buildSettlement',
        playerId: winner,
        vertexId: winTarget.id,
      },
    });
    await nextTick();

    // The game ended and the final batch reached the client BEFORE any close.
    expect(room.gameState.phase).toBe('finished');
    expect(batches.some((b) => b.some((e) => e.type === 'game.ended'))).toBe(true);
    expect(leaveCode).toBeUndefined(); // the close is DEFERRED (scheduled, not yet fired)

    // Fire the deferred close: the client sees a CONSENTED (4000) leave — the
    // exact code its S2.3.2a logic maps to "clear the reconnect pointer".
    expect(scheduler.armed).toBe(true);
    scheduler.fire();
    await nextTick();
    expect(leaveCode).toBe(CONSENTED_CLOSE_CODE);
  }, 30000);

  // --- 5. Classic byte-frozen: no drop → no fill-bot -------------------------

  it('no drop, no fill: a running match with a connected human never flips a seat to a bot', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 2,
      seed: SEED,
    });
    const c1 = await testServer.connectTo(room, CONNECT_OPTS);
    const c2 = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();

    // A crafted main turn (no genesis bots at all) — a plain committing intent.
    const a = c1.sessionId;
    const b = c2.sessionId;
    room.gameState = {
      ...room.gameState,
      phase: 'main',
      turn: 1,
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

    // No drop, no consented leave → no fill-bot: both seats stay human.
    expect(room.state.seats.every((s) => s.isBot === false)).toBe(true);
    expect(room.state.seats.every((s) => s.botDifficulty === '')).toBe(true);
    expect(room.gameState.phase).not.toBe('finished'); // a plain end-turn, no game-end close

    await c1.leave();
    await c2.leave();
  });
});
