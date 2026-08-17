// S2.1.7b-07 — the socket-based `expanded` proof: the SAME cross-process
// shape `fullMatch.e2e.test.ts` uses (real server boot on an ephemeral port,
// real `@colyseus/sdk` clients, the `decideAction` scripted driver over the
// wire) but for the 5-6 seat / 37-tile board (ADR-0013). Three independent
// server boots, one per concern, mirroring `fullMatch.e2e.test.ts`'s
// `N_SEATS` pattern:
//   1. single-player bot-fill — one human + 5 bots on `profileId:'expanded'`
//      reach a winner with no seat count anywhere on the wire.
//   2. multi-client — five REAL sockets seat and play a full expanded match.
//   3. seat-cap boundaries — a profile-derived 6-seat expanded room and a
//      profile-derived 4-seat Classic room, in the SAME server run, both
//      reject one client beyond their capacity.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client, type Room } from '@colyseus/sdk';
import {
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  loadRuleProfile,
  type PlayerId,
  reduce,
  type Seed,
} from '@skervik/core';
import { GAME_ROOM_NAME, PROTOCOL_VERSION } from '@skervik/protocol';
import { matchMaker } from 'colyseus';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createHttpServer, type HttpServerHandle } from '../index.js';
import type { GameRoom } from '../room/GameRoom.js';
import { decideAction } from './scriptedDriver.js';

/** Per-intent socket round-trip budget (mirrors `fullMatch.e2e.test.ts`). */
const STEP_TIMEOUT_MS = 8000;
/** Budget for the seats-full genesis broadcast to arrive. */
const GENESIS_TIMEOUT_MS = 8000;
/** Hard step cap on a driven match (the boot-free proof terminates well under this). */
const STEP_CAP = 3000;

async function fetchGuest(
  baseHttp: string,
  name: string,
): Promise<{ guestId: string; displayName: string }> {
  return fetch(`${baseHttp}/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: name }),
  }).then((r) => r.json()) as Promise<{ guestId: string; displayName: string }>;
}

/**
 * A minimal event-driven `waitFor` (mirrors `fullMatch.e2e.test.ts`): resolves
 * as soon as `pred()` is true, re-checked from `notify()`'s watcher list — no
 * sleeps/polling.
 */
function makeWaiter(): {
  waitFor: (pred: () => boolean, timeoutMs: number, label: string) => Promise<void>;
  notify: () => void;
} {
  const watchers: Array<() => void> = [];
  const notify = (): void => {
    for (const check of [...watchers]) check();
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
        reject(new Error(`${label} — timed out after ${timeoutMs}ms`));
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
  return { waitFor, notify };
}

// ---------------------------------------------------------------------------
// 1. Single-player bot-fill: one human socket + 5 server-owned bots.
// ---------------------------------------------------------------------------
describe('expanded — single-player bot-fill reaches a winner (S2.1.7b-07)', () => {
  let handle: HttpServerHandle;
  let matchesDir: string;
  let baseHttp: string;
  let baseWs: string;
  const SEED: Seed = 'skervik-expanded-single-player';

  beforeAll(async () => {
    matchesDir = await mkdtemp(join(tmpdir(), 'skervik-e2e-expanded-sp-'));
    // No `maxSeats` override — the room's seat cap must derive from the
    // profile alone (S2.1.7b D1), which is exactly what AC5 ("no seat count
    // anywhere on the wire") requires.
    handle = await createHttpServer({ matchesDir, seed: SEED });
    const { port } = await handle.listen(0, '127.0.0.1');
    baseHttp = `http://127.0.0.1:${port}`;
    baseWs = `ws://127.0.0.1:${port}`;
  }, 60000);

  afterAll(async () => {
    await handle?.close();
    // `maxRetries`/`retryDelay` (Node's own built-in recommendation for this
    // exact Windows race, not a test-logic sleep — see the story's Non-goal
    // on synchronization sleeps): a best-effort async metadata/log write can
    // still be landing in `matchesDir` a few ms after `close()` resolves.
    if (matchesDir) {
      await rm(matchesDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  });

  it('one real client + bots:5 fills a profile-derived 6-seat expanded room and reaches a winner', async () => {
    let localState: GameState = {
      matchId: '',
      phase: 'lobby',
      turn: 0,
      currentPlayerId: '',
      players: [],
      eventIndex: 0,
      seedHash: '',
    };
    let ended: GameEndedEvent | null = null;
    const seen: string[] = [];
    const { waitFor, notify } = makeWaiter();

    const guest = await fetchGuest(baseHttp, 'Solo');
    const client = new Client(baseWs);
    const room: Room = await client.joinOrCreate(GAME_ROOM_NAME, {
      protocolVersion: PROTOCOL_VERSION,
      guestId: guest.guestId,
      displayName: guest.displayName,
      profileId: 'expanded',
      bots: [
        { difficulty: 'medium' },
        { difficulty: 'medium' },
        { difficulty: 'medium' },
        { difficulty: 'medium' },
        { difficulty: 'medium' },
      ],
    });
    const humanId = room.sessionId as PlayerId;

    room.onMessage('state.snapshot', (m) => {
      seen.push(JSON.stringify(m));
      localState = (m as { payload: GameState }).payload;
    });
    room.onMessage('event.batch', (m) => {
      seen.push(JSON.stringify(m));
      const batch = m as { payload: GameEvent[] };
      for (const event of batch.payload) {
        localState = reduce(localState, event);
        if (event.type === 'game.ended') ended = event;
      }
      notify();
    });

    // Seats-full genesis: 1 human + 5 bots = 6 = the profile's own `maxSeats`.
    await waitFor(
      () => localState.phase !== 'lobby',
      GENESIS_TIMEOUT_MS,
      'single-player expanded match did not auto-start on seats-full',
    );
    expect(localState.profileId).toBe('expanded');

    // The room's OWN seat cap derives purely from `loadRuleProfile('expanded').maxSeats`
    // (no `maxSeats` was ever passed, on the wire or to `createHttpServer`).
    const liveRoom = matchMaker.getLocalRoomById(room.roomId) as GameRoom;
    expect(liveRoom.maxClients).toBe(6);

    // Drive ONLY the human seat over the socket; the other 5 seats are
    // server-owned bots that play themselves via `GameRoom`'s bot-drive
    // seam — we just wait for the resulting broadcasts.
    let steps = 0;
    while (localState.phase !== 'finished' && steps < STEP_CAP) {
      const intent = decideAction(localState, humanId);
      const before = localState.eventIndex;
      if (intent) {
        room.send('intent', { v: 1, type: 'intent', payload: intent });
      }
      await waitFor(
        () => localState.eventIndex > before || localState.phase === 'finished',
        STEP_TIMEOUT_MS,
        `waiting for a broadcast after step ${steps} (human turn=${intent !== null})`,
      );
      steps += 1;
    }
    if (localState.phase !== 'finished') {
      throw new Error(
        `single-player expanded match did not finish within ${STEP_CAP} steps`,
      );
    }

    expect(ended).not.toBeNull();
    expect(localState.players).toHaveLength(6);

    // Seed secrecy holds on the expanded path too.
    expect(seen.join('\n')).toContain(localState.seedHash);
    expect(seen.join('\n').includes(SEED)).toBe(false);

    await room.leave();
  }, 120000);
});

// ---------------------------------------------------------------------------
// 2. Multi-client: five REAL sockets, no bots.
// ---------------------------------------------------------------------------
describe('expanded — five real clients seat and play a full match (S2.1.7b-07)', () => {
  let handle: HttpServerHandle;
  let matchesDir: string;
  let baseHttp: string;
  let baseWs: string;
  const SEED: Seed = 'skervik-expanded-multi-client';
  /** Room-level override (within the profile's own 5-6 `minSeats`/`maxSeats` range, S2.1.7b D1). */
  const N_SEATS = 5;

  beforeAll(async () => {
    matchesDir = await mkdtemp(join(tmpdir(), 'skervik-e2e-expanded-mc-'));
    handle = await createHttpServer({ matchesDir, maxSeats: N_SEATS, seed: SEED });
    const { port } = await handle.listen(0, '127.0.0.1');
    baseHttp = `http://127.0.0.1:${port}`;
    baseWs = `ws://127.0.0.1:${port}`;
  }, 60000);

  afterAll(async () => {
    await handle?.close();
    if (matchesDir) {
      await rm(matchesDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  });

  it('five real @colyseus/sdk clients all see profileId:expanded and reach a winner', async () => {
    let localState: GameState = {
      matchId: '',
      phase: 'lobby',
      turn: 0,
      currentPlayerId: '',
      players: [],
      eventIndex: 0,
      seedHash: '',
    };
    let ended: GameEndedEvent | null = null;
    const { waitFor, notify } = makeWaiter();

    const rooms: Room[] = [];
    const roomBySession = new Map<PlayerId, Room>();
    // Per-client received-message log (seed secrecy + "ALL clients saw it").
    const seenByClient: string[][] = [];

    for (let i = 0; i < N_SEATS; i += 1) {
      const guest = await fetchGuest(baseHttp, `Driver-${i}`);
      const client = new Client(baseWs);
      const room = await client.joinOrCreate(GAME_ROOM_NAME, {
        protocolVersion: PROTOCOL_VERSION,
        guestId: guest.guestId,
        displayName: guest.displayName,
        profileId: 'expanded',
      });
      rooms.push(room);
      roomBySession.set(room.sessionId as PlayerId, room);
      const mySeen: string[] = [];
      seenByClient.push(mySeen);

      room.onMessage('state.snapshot', (m) => {
        mySeen.push(JSON.stringify(m));
        if (i === 0) localState = (m as { payload: GameState }).payload;
      });
      room.onMessage('event.batch', (m) => {
        mySeen.push(JSON.stringify(m));
        if (i === 0) {
          const batch = m as { payload: GameEvent[] };
          for (const event of batch.payload) {
            localState = reduce(localState, event);
            if (event.type === 'game.ended') ended = event;
          }
          notify();
        }
      });
    }

    await waitFor(
      () => localState.phase !== 'lobby',
      GENESIS_TIMEOUT_MS,
      '5-client expanded match did not auto-start on seats-full',
    );
    expect(localState.profileId).toBe('expanded');

    // Every one of the 5 sockets received the genesis batch carrying
    // `profileId:'expanded'` in its OWN `match.started` — not just the
    // one client whose broadcasts we folded.
    for (const clientSeen of seenByClient) {
      expect(
        clientSeen.some(
          (msg) =>
            msg.includes('"type":"match.started"') &&
            msg.includes('"profileId":"expanded"'),
        ),
      ).toBe(true);
    }

    let steps = 0;
    while (localState.phase !== 'finished' && steps < STEP_CAP) {
      let sentPlayer: PlayerId | null = null;
      for (const player of localState.players) {
        const intent = decideAction(localState, player.id);
        if (!intent) continue;
        const before = localState.eventIndex;
        const room = roomBySession.get(player.id);
        if (!room) {
          throw new Error(`no socket for seat ${player.id}`);
        }
        room.send('intent', { v: 1, type: 'intent', payload: intent });
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
        throw new Error(`5-client expanded match DEADLOCKED at step ${steps}`);
      }
    }
    if (localState.phase !== 'finished') {
      throw new Error(`5-client expanded match did not finish within ${STEP_CAP} steps`);
    }

    expect(ended).not.toBeNull();
    expect(localState.players).toHaveLength(5);
    const winnerId =
      ended !== null ? (ended as GameEndedEvent).winnerId : ('' as PlayerId);
    // The EFFECTIVE threshold, not the profile constant (m2-gate-02): adaptive
    // duration is now applied at genesis, so a live 5-seat expanded room starts
    // with `vpToWinOverride` in force and legitimately ends BELOW the profile's
    // own `vpToWin: 10`. The assertion's intent is unchanged — a real winner
    // reached the threshold this match was actually played to.
    const vpToWin =
      localState.vpToWinOverride ?? loadRuleProfile('expanded').victory.vpToWin;
    expect(
      ended !== null ? (ended as GameEndedEvent).finalStandings[winnerId] : 0,
    ).toBeGreaterThanOrEqual(vpToWin);

    // Seed secrecy across every socket, not just one.
    for (const clientSeen of seenByClient) {
      const joined = clientSeen.join('\n');
      expect(joined).toContain(localState.seedHash);
      expect(joined.includes(SEED)).toBe(false);
    }

    await Promise.all(rooms.map((r) => r.leave()));
  }, 120000);
});

// ---------------------------------------------------------------------------
// 3. Seat-cap boundaries, profile-derived, in the SAME server run.
// ---------------------------------------------------------------------------
describe('seat caps are profile-derived, not hardcoded (S2.1.7b-07)', () => {
  let handle: HttpServerHandle;
  let matchesDir: string;
  let baseHttp: string;
  let baseWs: string;
  const SEED: Seed = 'skervik-expanded-seatcap';

  beforeAll(async () => {
    matchesDir = await mkdtemp(join(tmpdir(), 'skervik-e2e-expanded-cap-'));
    // No `maxSeats` override anywhere in this describe block — every room's
    // cap must come purely from its OWN resolved profile.
    handle = await createHttpServer({ matchesDir, seed: SEED });
    const { port } = await handle.listen(0, '127.0.0.1');
    baseHttp = `http://127.0.0.1:${port}`;
    baseWs = `ws://127.0.0.1:${port}`;
  }, 60000);

  afterAll(async () => {
    await handle?.close();
    if (matchesDir) {
      await rm(matchesDir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  });

  it('a 7th client cannot join an already-full 6-seat expanded room', async () => {
    let phase = 'lobby';
    const { waitFor, notify } = makeWaiter();

    const rooms: Room[] = [];
    let roomId = '';
    for (let i = 0; i < 6; i += 1) {
      const guest = await fetchGuest(baseHttp, `Cap-${i}`);
      const client = new Client(baseWs);
      const room = await client.joinOrCreate(GAME_ROOM_NAME, {
        protocolVersion: PROTOCOL_VERSION,
        guestId: guest.guestId,
        displayName: guest.displayName,
        profileId: 'expanded',
      });
      rooms.push(room);
      roomId = room.roomId;
      if (i === 0) {
        room.onMessage('state.snapshot', (m) => {
          phase = (m as { payload: GameState }).payload.phase;
        });
        room.onMessage('event.batch', () => {
          const live = matchMaker.getLocalRoomById(roomId) as GameRoom | undefined;
          if (live) phase = live.gameState.phase;
          notify();
        });
      }
    }

    await waitFor(
      () => phase !== 'lobby',
      GENESIS_TIMEOUT_MS,
      '6-client expanded room did not auto-start on seats-full',
    );

    const liveRoom = matchMaker.getLocalRoomById(roomId) as GameRoom;
    expect(liveRoom.maxClients).toBe(6);

    const guest7 = await fetchGuest(baseHttp, 'Cap-6');
    const client7 = new Client(baseWs);
    await expect(
      client7.joinById(roomId, {
        protocolVersion: PROTOCOL_VERSION,
        guestId: guest7.guestId,
        displayName: guest7.displayName,
      }),
    ).rejects.toThrow();

    // Deliberately no explicit `.leave()` here: the match is still mid-`setup`
    // (never driven to a winner), so a consented leave would trigger
    // `#botFillSeat` for whichever seat is processed first — harmless
    // (best-effort, caught internally) but pure async noise racing this
    // block's `afterAll` teardown. `handle.close()` tears every socket down.
  }, 120000);

  it('a 5th client still cannot join an already-full 4-seat Classic room, in the same server run', async () => {
    let phase = 'lobby';
    const { waitFor, notify } = makeWaiter();

    const rooms: Room[] = [];
    let roomId = '';
    for (let i = 0; i < 4; i += 1) {
      const guest = await fetchGuest(baseHttp, `Classic-${i}`);
      const client = new Client(baseWs);
      // No `profileId` — defaults to `'classic'` (`maxSeats` 4).
      const room = await client.joinOrCreate(GAME_ROOM_NAME, {
        protocolVersion: PROTOCOL_VERSION,
        guestId: guest.guestId,
        displayName: guest.displayName,
      });
      rooms.push(room);
      roomId = room.roomId;
      if (i === 0) {
        room.onMessage('state.snapshot', (m) => {
          phase = (m as { payload: GameState }).payload.phase;
        });
        room.onMessage('event.batch', () => {
          const live = matchMaker.getLocalRoomById(roomId) as GameRoom | undefined;
          if (live) phase = live.gameState.phase;
          notify();
        });
      }
    }

    await waitFor(
      () => phase !== 'lobby',
      GENESIS_TIMEOUT_MS,
      '4-client Classic room did not auto-start on seats-full',
    );

    const liveRoom = matchMaker.getLocalRoomById(roomId) as GameRoom;
    expect(liveRoom.maxClients).toBe(4);

    const guest5 = await fetchGuest(baseHttp, 'Classic-4');
    const client5 = new Client(baseWs);
    await expect(
      client5.joinById(roomId, {
        protocolVersion: PROTOCOL_VERSION,
        guestId: guest5.guestId,
        displayName: guest5.displayName,
      }),
    ).rejects.toThrow();

    // See the sibling test above for why `.leave()` is deliberately skipped.
  }, 120000);
});
