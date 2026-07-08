// S2.4.3 — single-player + bot-fill: the v1 heuristic bot (`@skervik/bots`)
// wired into the REAL authoritative room pipeline. Unlike the cross-process
// `fullMatch.e2e.test.ts` (real sockets) or the boot-free `twoPlayerMatch.e2e.
// test.ts` (pure core, no Room at all), this is the THIRD flavor: a real
// `GameRoom` under `@colyseus/testing` (in-process, no sockets), proving bot
// seats are driven through the SAME `#queue` / `#applyAuthoritativeIntent` tail
// a human client uses — never a second apply path.
//
// Four groups:
//   1. `SeatSchema`'s additive `isBot`/`botDifficulty` fields (a human seat is
//      byte-unchanged).
//   2. A pure bot-vs-bot room auto-starts on seats-full and plays a complete
//      deterministic Classic match to `game.ended`, with reproducibility +
//      replay-equality.
//   3. No-hang: a per-turn action cap forces the deterministic default without
//      ever consulting the bot (never throws when a legal default exists).
//   4. No-hang: a truly stuck bot (no legal fallback either, e.g. `setup` under
//      S2.1.4's deferred auto-placement) fails LOUD — logged, never a hang,
//      never an unhandled rejection.
import { ColyseusTestServer } from '@colyseus/testing';
import {
  buildTopology,
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  generateBoard,
  type PlayerId,
  type PlayerState,
  replay,
  type Seed,
} from '@skervik/core';
import { PROTOCOL_VERSION } from '@skervik/protocol';
import type { Server } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createGameServer, GAME_ROOM_NAME, type GameRoom } from '../index.js';
import { InMemoryEventSink } from './eventSink.js';

/** Gives the room's queued async work a tick to settle (mirrors GameRoom.test.ts). */
function nextTick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `@colyseus/testing`'s `boot()` helper ALWAYS binds its hardcoded default
 * port (2568) when handed a `Server` instance directly (it ignores the `port`
 * argument on that branch) — fine for a single file, but `GameRoom.test.ts`
 * already boots one server on that exact default, and vitest runs test FILES
 * in parallel workers, so two callers of `boot()` race on the same port
 * (`EADDRINUSE`). This mirrors `boot()`'s own Server-branch, just on OUR
 * chosen port, so this file's server never collides with `GameRoom.test.ts`'s.
 */
async function bootOnPort(gameServer: Server, port: number): Promise<ColyseusTestServer> {
  await gameServer.listen(port);
  return new ColyseusTestServer(gameServer);
}

/** The compatible join handshake every client must present (S1.5.2). */
const CONNECT_OPTS = { protocolVersion: PROTOCOL_VERSION } as const;

/** A minimal empty-handed player for a crafted state (mirrors GameRoom.test.ts). */
function player(id: string): PlayerState {
  return { id: id as PlayerId, name: id, victoryPoints: 0, resources: {} };
}

/**
 * The SAME fixed seed the S2.4.2 bots package already proves reaches
 * `game.ended` "well under the termination cap" at every difficulty
 * (`packages/bots/src/harness.test.ts`'s `SEED`, itself the S1.7.2 E2E seed) —
 * reused here so this room-level wiring test rides a KNOWN-terminating
 * board/roll sequence rather than an unproven fresh one.
 */
const SEED: Seed = 'skervik-s1.7.2-e2e-match-seed';

/** Polls `room.gameState.phase` until `'finished'` — bot steps are microtask-chained, so this settles fast. */
async function waitForFinished(room: GameRoom, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (room.gameState.phase !== 'finished') {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `bot-driven match did not reach 'finished' within ${timeoutMs}ms ` +
          `(phase=${room.gameState.phase}, turn=${room.gameState.turn})`,
      );
    }
    await nextTick(10);
  }
}

/** `match.started`'s `matchId` is the room's random `roomId` — strip it for a cross-run compare. */
function stripMatchId(events: readonly GameEvent[]): unknown {
  return events.map((e) =>
    e.type === 'match.started' ? { ...e, matchId: '__MATCH__' } : e,
  );
}

describe('single-player / bot-fill — bots drive a real match through the authoritative pipeline (S2.4.3)', () => {
  let testServer: ColyseusTestServer;

  beforeAll(async () => {
    testServer = await bootOnPort(createGameServer(), 2569);
  });

  afterAll(async () => {
    await testServer.shutdown();
  });

  // --- 1. SeatSchema additive fields ----------------------------------------

  it('mints bot seats at genesis (isBot + structured botDifficulty); a human seat stays isBot:false', async () => {
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 3,
      bots: [{ difficulty: 'easy' }, { difficulty: 'medium' }],
    });

    expect(room.state.seats).toHaveLength(2);
    expect(room.state.seats[0]?.playerId).toBe('bot-0');
    expect(room.state.seats[0]?.isBot).toBe(true);
    expect(room.state.seats[0]?.botDifficulty).toBe('easy');
    expect(room.state.seats[1]?.playerId).toBe('bot-1');
    expect(room.state.seats[1]?.isBot).toBe(true);
    expect(room.state.seats[1]?.botDifficulty).toBe('medium');

    // The bots alone (2) don't fill maxSeats(3) yet — no auto-start.
    expect(room.gameState.phase).toBe('lobby');

    const human = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();
    const humanSeat = room.state.seats.find((s) => s.playerId === human.sessionId);
    expect(humanSeat).toBeDefined();
    expect(humanSeat?.isBot).toBe(false);
    expect(humanSeat?.botDifficulty).toBe(''); // human seat: byte-unchanged convention (empty = not set)

    // Bots (2) + the human (1) filled maxSeats(3) -> the SAME #startMatch path fired.
    expect(room.gameState.phase).toBe('setup');
    await human.leave();
  });

  // --- 2. Full bot-vs-bot match through the real pipeline -------------------

  async function runAllBotMatch(): Promise<{ room: GameRoom; sink: InMemoryEventSink }> {
    const sink = new InMemoryEventSink();
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 3,
      seed: SEED,
      sink,
      bots: [{ difficulty: 'hard' }, { difficulty: 'hard' }, { difficulty: 'hard' }],
    });
    await waitForFinished(room);
    return { room, sink };
  }

  it('a pure bot-vs-bot room auto-starts on seats-full and plays a full Classic match to game.ended', async () => {
    const { room, sink } = await runAllBotMatch();

    expect(room.gameState.phase).toBe('finished');
    const ended = sink.events.find((e) => e.type === 'game.ended') as
      GameEndedEvent | undefined;
    expect(ended).toBeDefined();
    const winnerId = ended?.winnerId as PlayerId;
    expect(['bot-0', 'bot-1', 'bot-2']).toContain(winnerId);
    expect(ended?.finalStandings[winnerId]).toBeGreaterThanOrEqual(10);
    expect(room.gameState.turn).toBeGreaterThan(0);

    // Every bot-driven event is an ORDINARY event: no timestamp/marker field
    // leaked into the log (S2.4.3 determinism binding — bind #6).
    expect(JSON.stringify(sink.events)).not.toMatch(/timestamp|"bot"|isBot/i);
  }, 30000);

  it('is deterministic — the identical room options + seed run twice yields identical events', async () => {
    const a = await runAllBotMatch();
    const b = await runAllBotMatch();

    expect(stripMatchId(a.sink.events)).toEqual(stripMatchId(b.sink.events));
    expect(a.sink.events.map((e) => e.type)).toEqual(b.sink.events.map((e) => e.type));
    expect(a.room.gameState.turn).toBe(b.room.gameState.turn);
  }, 60000);

  it('replay equality — the persisted events replay-fold from genesis to the authoritative final state', async () => {
    const { room, sink } = await runAllBotMatch();
    const base: GameState = {
      matchId: room.gameState.matchId,
      phase: 'lobby',
      turn: 0,
      currentPlayerId: '',
      players: [],
      eventIndex: 0,
      seedHash: room.gameState.seedHash,
    };
    expect(replay(base, sink.events)).toEqual(room.gameState);
  }, 30000);

  // --- 3. No-hang: the per-turn cap forces the deterministic default --------

  it('a per-turn action cap (0) forces the deterministic default every step — the bot is never even consulted, and nothing throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 3, // > seats we connect, so genesis never auto-fires (the crafted state stands)
      seed: SEED,
      bots: [{ difficulty: 'hard' }],
      botActionCap: 0,
    });
    const human = await testServer.connectTo(room, CONNECT_OPTS);
    await nextTick();
    expect(room.gameState.phase).toBe('lobby'); // sanity: only 2 of 3 seats filled

    // Craft a bare 'main' turn owned by the human, with a REAL board (so a
    // forced 7-roll's robber relocation is always legal regardless of dice) —
    // mirrors `GameRoom.test.ts`'s `startMainTurn` craft, extended with a board.
    const humanId = human.sessionId as PlayerId;
    const botId = 'bot-0' as PlayerId;
    const layout = generateBoard(SEED, buildTopology());
    room.gameState = {
      ...room.gameState,
      phase: 'main',
      turn: 1,
      currentPlayerId: humanId,
      players: [player(humanId), player(botId)],
      playerOrder: [humanId, botId],
      board: {
        tileKinds: layout.tileKinds,
        tileTokens: layout.tileTokens,
        portContents: layout.portContents,
        robberTileId: layout.robberTileId,
      },
    };
    room.state.phase = 'main';
    room.state.currentPlayerId = humanId;

    human.send('intent', {
      v: 1,
      type: 'intent',
      payload: { type: 'intent.endTurn', playerId: humanId },
    });
    await nextTick();

    // The bot's WHOLE turn (roll -> [robber if a 7 landed] -> main -> endTurn)
    // was driven purely by `resolveForcedAction` defaults — cap=0 never lets
    // the drive loop consult the bot's own decision — and control returns to
    // the human's fresh turn without anything throwing.
    expect(room.gameState.currentPlayerId).toBe(humanId);
    expect(room.gameState.phase).toBe('roll');
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await human.leave();
  });

  // --- 4. No-hang: a truly stuck bot fails LOUD ------------------------------

  it('a truly stuck bot (no legal fallback either) fails LOUD via a tiny per-turn cap — never hangs, never crashes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = new InMemoryEventSink();
    const room = await testServer.createRoom<GameRoom>(GAME_ROOM_NAME, {
      maxSeats: 2,
      seed: SEED,
      sink,
      bots: [{ difficulty: 'hard' }, { difficulty: 'hard' }],
      // Setup needs >= 2 players * (1 settlement + 1 road) * 2 rounds = 8 total
      // steps before it clears — a cap of 3 guarantees it is exceeded WHILE
      // still in `setup`, where S2.1.4 defers auto-placement (`resolveForcedAction`
      // returns null) — i.e. genuinely nothing legal is left to fall back to.
      botActionCap: 3,
    });

    // Let the queue run to its (stuck) end — no real time passes besides this wait.
    await nextTick(200);

    expect(room.gameState.phase).toBe('setup');
    expect(room.gameState.phase).not.toBe('finished');
    expect(consoleError).toHaveBeenCalled();
    const logged = consoleError.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toMatch(/STUCK/);

    consoleError.mockRestore();
  });
});
