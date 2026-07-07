// S1.7.2 Phase B — the REAL cross-process E2E full-match gate. Unlike the
// boot-free `scriptedDriver.test.ts` (pure `validate`/`reduce`, no sockets/FS),
// this boots the ACTUAL server (`createHttpServer` = Fastify + attached Colyseus
// WS + mounted matchmaking, ADR-0011) on an ephemeral port, connects N REAL
// `@colyseus/sdk@0.17` clients over a socket, and drives them through a complete
// Classic match to `game.ended` — the headline vertical-slice proof.
//
// It reuses the SAME deterministic `decideAction` the boot-free proof uses (the
// driver is authored exactly once), so "what a client sends on its turn" is
// identical logic. The harness is the orchestrator: it folds the server's
// `event.batch` broadcasts through core `reduce` to track the shared authoritative
// view, and on each step it picks the next acting seat in the SAME deterministic
// order the boot-free sim uses and sends that seat's intent over ITS socket. One
// intent, wait for the resulting broadcast, repeat — self-clocking, so the applied
// event sequence is byte-deterministic across runs (no socket-timing races).
//
// Asserts the four invariants that ARE the M1 promise:
//   a. a winner reaches `vpToWin` (via the authoritative `game.ended.finalStandings`
//      tally — core's `computeVictoryPoints`, NOT `player.victoryPoints`),
//   b. determinism — the identical socket sequence run twice yields deep-equal
//      final `GameState` (canonicalized past the random sessionId/roomId labels),
//   c. replay equality — the persisted `events.ndjson` → `parseGameEventLog` →
//      `replay` deep-equals the room's authoritative final `GameState`,
//   d. seed secrecy — no client ever received the raw seed (only `seedHash`).
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client, type Room } from '@colyseus/sdk';
import {
  CLASSIC_VICTORY_PROFILE,
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  parseGameEventLog,
  type PlayerId,
  reduce,
  replay,
  type Seed,
} from '@skervik/core';
import { GAME_ROOM_NAME, PROTOCOL_VERSION } from '@skervik/protocol';
import { matchMaker } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHttpServer, type HttpServerHandle } from '../index.js';
import type { GameRoom } from '../room/GameRoom.js';
import { decideAction } from './scriptedDriver.js';

/**
 * The fixed seed the whole E2E pins — MUST match `scriptedDriver.test.ts`'s
 * `E2E_SEED` so the socket run drives the SAME board + rolls the boot-free proof
 * verified reaches 10 VP. Duplicated as a literal (not imported) because importing
 * a `*.test.ts` module would re-register its `describe` blocks here — a plain
 * string constant is the cheapest way to share the one value without that.
 */
const E2E_SEED: Seed = 'skervik-s1.7.2-e2e-match-seed';

/** Seat count for the E2E (N=3 Classic) — the server's `maxSeats`, so the 3rd join fills + auto-starts. */
const N_SEATS = 3;

/** Hard step cap on the socket drive (boot-free proof terminates at ~278 intents). */
const STEP_CAP = 2000;

/** Per-intent socket round-trip budget — if a sent intent produces no broadcast in time, fail loudly. */
const STEP_TIMEOUT_MS = 8000;

/** Budget for the seats-full genesis (`match.started` + `board.generated`) broadcast to arrive. */
const GENESIS_TIMEOUT_MS = 8000;

interface RunResult {
  /** Deep clone of the room's authoritative final `GameState` (captured before teardown). */
  readonly finalState: GameState;
  /** The `game.ended` event the driver reached, if any. */
  readonly endedEvent: GameEndedEvent | null;
  readonly winnerId: PlayerId;
  readonly winnerVp: number;
  /** The seating order (sessionIds) — canonical-relabel keys for the determinism compare. */
  readonly playerOrder: readonly PlayerId[];
  readonly matchId: string;
  readonly steps: number;
  /** Absolute path of the persisted ndjson event log. */
  readonly logPath: string;
  /** Every JSON-serialized message/state each client observed — scanned for the raw seed. */
  readonly clientSaw: string;
  /** Whether a bank/port trade was exercised (the product-heart trade path). */
  readonly tradeExercised: boolean;
}

/** A rough VP tally for a STUCK-state diagnostic only (authoritative tally is `game.ended.finalStandings`). */
function vpEstimate(state: GameState, playerId: PlayerId): number {
  const b = state.buildings;
  const settlements = b
    ? Object.values(b.settlements).filter((o) => o === playerId).length
    : 0;
  const cities = b?.cities
    ? Object.values(b.cities).filter((o) => o === playerId).length
    : 0;
  const longestRoad = state.longestRoadHolder === playerId ? 2 : 0;
  const largestArmy = state.largestArmyHolder === playerId ? 2 : 0;
  return settlements + cities * 2 + longestRoad + largestArmy;
}

/**
 * Boots N real clients into one room and drives a full match over the socket.
 * Returns the authoritative outcome + the audit material for the four assertions.
 */
async function runMatch(
  baseHttp: string,
  baseWs: string,
  matchesDir: string,
): Promise<RunResult> {
  // The shared authoritative view, folded from the FIRST client's `event.batch`
  // broadcasts (every client receives the same broadcast; folding one is enough).
  let localState: GameState = {
    matchId: '',
    phase: 'lobby',
    turn: 0,
    currentPlayerId: '',
    players: [],
    eventIndex: 0,
    seedHash: '',
  };
  let endedEvent: GameEndedEvent | null = null;
  let tradeExercised = false;

  // Watchers re-checked after every fold (implements `waitFor` below).
  const watchers: Array<() => void> = [];
  const notify = (): void => {
    for (const check of [...watchers]) check();
  };

  // What each client saw (seed-secrecy scan): snapshots, batches, Schema state.
  const seen: string[] = [];

  const foldBatch = (events: readonly GameEvent[]): void => {
    for (const event of events) {
      localState = reduce(localState, event);
      if (event.type === 'game.ended') endedEvent = event;
      if (event.type === 'bank.trade') tradeExercised = true;
    }
  };

  const diagnostic = (): string => {
    const seats = localState.players
      .map((p) => `${p.id}:vp≈${vpEstimate(localState, p.id)}`)
      .join(', ');
    return (
      `phase=${localState.phase} turn=${localState.turn} ` +
      `current=${localState.currentPlayerId} eventIndex=${localState.eventIndex} [${seats}]`
    );
  };

  const waitFor = (
    pred: () => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<void> => {
    if (pred()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const remove = (): void => {
        const i = watchers.indexOf(check);
        if (i >= 0) watchers.splice(i, 1);
      };
      const timer = setTimeout(() => {
        remove();
        reject(
          new Error(`${label} — timed out after ${timeoutMs}ms. STUCK: ${diagnostic()}`),
        );
      }, timeoutMs);
      const check = (): void => {
        if (pred()) {
          clearTimeout(timer);
          remove();
          resolve();
        }
      };
      watchers.push(check);
    });
  };

  // Connect N clients sequentially: the first CREATES the room, the rest JOIN it
  // (joinOrCreate quick-match) — the Nth join fills the seats and auto-fires
  // match-start (Phase A). Each fetches a real guest (S1.7.1 flow) then joins.
  const clients: Client[] = [];
  const rooms: Room[] = [];
  const roomBySession = new Map<PlayerId, Room>();
  for (let i = 0; i < N_SEATS; i += 1) {
    const guest = (await fetch(`${baseHttp}/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: `Driver-${i}` }),
    }).then((r) => r.json())) as { guestId: string; displayName: string };

    const client = new Client(baseWs);
    const room = await client.joinOrCreate(GAME_ROOM_NAME, {
      protocolVersion: PROTOCOL_VERSION,
      guestId: guest.guestId,
      displayName: guest.displayName,
    });
    clients.push(client);
    rooms.push(room);
    roomBySession.set(room.sessionId as PlayerId, room);

    // Only the first client folds the shared view (all receive the same batches).
    if (i === 0) {
      room.onMessage('state.snapshot', (m) => {
        seen.push(JSON.stringify(m));
        const snap = m as { payload: GameState };
        localState = snap.payload;
      });
      room.onMessage('event.batch', (m) => {
        seen.push(JSON.stringify(m));
        const batch = m as { payload: GameEvent[] };
        foldBatch(batch.payload);
        notify();
      });
    } else {
      room.onMessage('state.snapshot', (m) => seen.push(JSON.stringify(m)));
      room.onMessage('event.batch', (m) => seen.push(JSON.stringify(m)));
    }
    room.onStateChange((state) => seen.push(JSON.stringify(state)));
  }

  const roomId = rooms[0]!.roomId;

  // Wait for the seats-full genesis batch: the lobby view transitions to `setup`.
  await waitFor(
    () => localState.phase !== 'lobby',
    GENESIS_TIMEOUT_MS,
    'match did not auto-start on seats-full (no genesis batch)',
  );

  // The drive loop — mirrors the boot-free `simulateMatch` exactly, but each
  // intent crosses a real socket and the resulting events return via broadcast.
  // Pick the first seat (fixed player order) with a legal move, send it over
  // that seat's socket, wait for the batch it produces, repeat.
  let steps = 0;
  while (localState.phase !== 'finished' && steps < STEP_CAP) {
    let sentPlayer: PlayerId | null = null;
    for (const player of localState.players) {
      const intent = decideAction(localState, player.id);
      if (!intent) continue;
      const before = localState.eventIndex;
      const room = roomBySession.get(player.id);
      if (!room) {
        throw new Error(
          `no socket for seat ${player.id} — seats: ${[...roomBySession.keys()]}`,
        );
      }
      room.send('intent', { v: 1, type: 'intent', payload: intent });
      // Every legal intent produces >= 1 event -> one broadcast advances the index.
      await waitFor(
        () => localState.eventIndex > before,
        STEP_TIMEOUT_MS,
        `intent ${intent.type} by ${player.id} produced no broadcast`,
      );
      sentPlayer = player.id;
      steps += 1;
      break;
    }
    if (sentPlayer === null) {
      throw new Error(
        `driver DEADLOCKED at step ${steps}: no seat has a legal move. ${diagnostic()}`,
      );
    }
  }
  if (localState.phase !== 'finished') {
    throw new Error(
      `match did not reach game.ended within ${STEP_CAP} steps. ${diagnostic()}`,
    );
  }

  // Capture the authoritative final state from the live room BEFORE any teardown
  // (leaving clients can auto-dispose the room). `.gameState` is the plain core
  // GameState (the Schema `.state` is only the public lobby projection).
  const serverRoom = matchMaker.getLocalRoomById(roomId) as GameRoom;
  const finalState = structuredClone(serverRoom.gameState);
  const logPath = join(matchesDir, roomId, 'events.ndjson');

  const ended = endedEvent as GameEndedEvent | null;
  const winnerId = ended ? ended.winnerId : ('' as PlayerId);
  const winnerVp = ended ? (ended.finalStandings[winnerId] ?? 0) : 0;

  const result: RunResult = {
    finalState,
    endedEvent: ended,
    winnerId,
    winnerVp,
    playerOrder: [...(finalState.playerOrder ?? finalState.players.map((p) => p.id))],
    matchId: finalState.matchId,
    steps,
    logPath,
    clientSaw: seen.join('\n'),
    tradeExercised,
  };

  // Teardown this run's clients (the server itself is torn down in afterAll).
  await Promise.all(rooms.map((r) => r.leave()));

  return result;
}

/**
 * Relabel the random sessionId/roomId identifiers to stable seat tokens so two
 * runs (which necessarily get fresh sessionIds + roomId) can be deep-compared for
 * DETERMINISM — the game outcome (who-in-which-seat holds what) must be identical.
 * A JSON string replace covers both playerId values AND playerId-keyed maps
 * uniformly; ids are fixed-length distinct random tokens, so no collision.
 */
function canonicalize(
  state: GameState,
  playerOrder: readonly PlayerId[],
  matchId: string,
): unknown {
  let json = JSON.stringify(state);
  json = json.split(matchId).join('__MATCH__');
  playerOrder.forEach((pid, i) => {
    json = json.split(pid).join(`__P${i}__`);
  });
  return JSON.parse(json);
}

describe('cross-process E2E — a full Classic match online + replay-equality (S1.7.2 Phase B)', () => {
  let handle: HttpServerHandle;
  let matchesDir: string;
  let runA: RunResult;
  let runB: RunResult;

  beforeAll(async () => {
    matchesDir = await mkdtemp(join(tmpdir(), 'skervik-e2e-'));
    // Boot ONE real server: ephemeral port, temp match-log dir, N seats (so the
    // 3rd join auto-starts), and the fixed E2E seed (reproducible board + rolls).
    handle = await createHttpServer({ matchesDir, maxSeats: N_SEATS, seed: E2E_SEED });
    const { port } = await handle.listen(0, '127.0.0.1');
    const baseHttp = `http://127.0.0.1:${port}`;
    const baseWs = `ws://127.0.0.1:${port}`;

    // Run the identical scripted socket sequence twice (fresh room each time, same
    // server-injected seed) — the determinism + replay proofs read both.
    runA = await runMatch(baseHttp, baseWs, matchesDir);
    runB = await runMatch(baseHttp, baseWs, matchesDir);
  }, 240000);

  afterAll(async () => {
    await handle?.close();
    if (matchesDir) await rm(matchesDir, { recursive: true, force: true });
  });

  it('reaches game.ended with a winner at >= vpToWin (authoritative computeVictoryPoints tally)', () => {
    expect(runA.finalState.phase).toBe('finished');
    expect(runA.endedEvent).not.toBeNull();
    // `game.ended.finalStandings` IS core's `computeVictoryPoints` tally (validate.ts),
    // not the mutable `player.victoryPoints` field — the authoritative win check.
    expect(runA.winnerVp).toBeGreaterThanOrEqual(CLASSIC_VICTORY_PROFILE.vpToWin);
    // The trade path (product heart) is exercised at least once over the socket.
    expect(runA.tradeExercised).toBe(true);
  });

  it('is deterministic — the identical socket sequence run twice yields deep-equal final state', () => {
    expect(runB.finalState.phase).toBe('finished');
    // Canonicalized past the per-run random sessionId/roomId labels: the game
    // outcome (seat-by-seat) must be byte-identical for the same seed + sequence.
    const canonA = canonicalize(runA.finalState, runA.playerOrder, runA.matchId);
    const canonB = canonicalize(runB.finalState, runB.playerOrder, runB.matchId);
    expect(canonA).toEqual(canonB);
    expect(runA.winnerVp).toBe(runB.winnerVp);
    expect(runA.steps).toBe(runB.steps);
  });

  it('replay equality — the persisted event log replays to the authoritative final state', async () => {
    const ndjson = await readFile(runA.logPath, 'utf8');
    const events = parseGameEventLog(ndjson);
    // Replay onto the SAME lobby base the room started from (`match.started`
    // overwrites matchId/seedHash, so this base need only mirror onCreate).
    const base: GameState = {
      matchId: runA.finalState.matchId,
      phase: 'lobby',
      turn: 0,
      currentPlayerId: '',
      players: [],
      eventIndex: 0,
      seedHash: runA.finalState.seedHash,
    };
    expect(replay(base, events)).toEqual(runA.finalState);
  });

  it('seed secrecy — no client ever received the raw seed (only seedHash)', () => {
    // Sanity: the public commit (seedHash) DID reach clients.
    expect(runA.clientSaw).toContain(runA.finalState.seedHash);
    // The raw seed NEVER appears in any client-visible message or Schema state.
    expect(runA.clientSaw.includes(E2E_SEED)).toBe(false);
    expect(runB.clientSaw.includes(E2E_SEED)).toBe(false);
  });
});
