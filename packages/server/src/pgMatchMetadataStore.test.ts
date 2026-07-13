// S2.6.3 AC1 — the durable Postgres match-metadata lifecycle, hermetic (PGlite +
// the REAL generated migrations, incl. 0002 `room_id`). Drives the store through
// its two lifecycle writes (start → result) and asserts the rows land exactly as
// designed: a `live` row at start, completed to `finished` with the revealed seed
// in `matches.seed`, one `match_players` row per seat, and the nullable
// `user_id`/`winner_id` honored for bot/tokenless seats.
import { CLASSIC_PROFILE, type Seed } from '@skervik/core';
import { afterEach, describe, expect, it } from 'vitest';

import { MatchPlayerRepository } from './db/repositories/matchPlayerRepository.js';
import { MatchRepository } from './db/repositories/matchRepository.js';
import { UserRepository } from './db/repositories/userRepository.js';
import { createTestDb, type TestDb } from './db/testDb.js';
import { PgMatchMetadataStore } from './pgMatchMetadataStore.js';

const SEED = 'a'.repeat(64) as Seed;

describe('PgMatchMetadataStore (S2.6.3 AC1 — durable lifecycle)', () => {
  let testDb: TestDb | undefined;

  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it('records a full start→result lifecycle, seed in matches.seed, per-seat rows, winner user resolved', async () => {
    testDb = await createTestDb();
    const matchRepo = new MatchRepository(testDb.db);
    const playerRepo = new MatchPlayerRepository(testDb.db);
    const userRepo = new UserRepository(testDb.db);
    const store = new PgMatchMetadataStore(matchRepo, playerRepo);

    const winner = await userRepo.create({ username: 'ada', displayName: 'Ada' });
    const startedAt = new Date('2026-07-13T00:00:00.000Z');
    const finishedAt = new Date('2026-07-13T00:45:00.000Z');

    // START — a `live` row with the Colyseus roomId (needs migration 0002).
    await store.recordMatchStart('room-abc', {
      roomId: 'room-abc',
      profile: CLASSIC_PROFILE,
      seedHash: 'hash-abc',
      playerCount: 2,
      startedAt,
      eventLogUri: '/matches/room-abc/events.ndjson',
    });

    const live = await matchRepo.findByRoomId('room-abc');
    expect(live).not.toBeNull();
    expect(live?.status).toBe('live');
    expect(live?.roomId).toBe('room-abc');
    expect(live?.playerCount).toBe(2);
    expect(live?.seed).toBeNull();
    expect(live?.eventLogUri).toBe('/matches/room-abc/events.ndjson');
    expect(live?.profile).toEqual(CLASSIC_PROFILE);
    expect(live?.startedAt).toEqual(startedAt);

    // REVEAL — the commit-reveal seed lands in matches.seed (ADR-0009 Fork 3).
    await store.recordSeedReveal('room-abc', SEED);
    expect((await matchRepo.findByRoomId('room-abc'))?.seed).toBe(SEED);
    expect(await store.readSeedReveal('room-abc')).toBe(SEED);

    // RESULT — completes the row + inserts one match_players row per seat.
    await store.recordMatchResult('room-abc', {
      seed: SEED,
      winnerUserId: winner.id,
      finishedAt,
      playerResults: [
        { seat: 0, userId: winner.id, finalVp: 10, result: 'win' },
        { seat: 1, finalVp: 6, result: 'loss' }, // bot / tokenless → user_id null
      ],
    });

    const finished = await matchRepo.findByRoomId('room-abc');
    expect(finished?.status).toBe('finished');
    expect(finished?.seed).toBe(SEED);
    expect(finished?.winnerId).toBe(winner.id);
    expect(finished?.finishedAt).toEqual(finishedAt);

    const seats = await playerRepo.findByMatch(finished!.id);
    expect(seats).toHaveLength(2);
    const seat0 = seats.find((s) => s.seat === 0);
    const seat1 = seats.find((s) => s.seat === 1);
    expect(seat0).toMatchObject({ userId: winner.id, finalVp: 10, result: 'win' });
    expect(seat1).toMatchObject({ userId: null, finalVp: 6, result: 'loss' });
  });

  it('leaves winner_id null when the winning seat has no userId (bot/tokenless winner)', async () => {
    testDb = await createTestDb();
    const matchRepo = new MatchRepository(testDb.db);
    const playerRepo = new MatchPlayerRepository(testDb.db);
    const store = new PgMatchMetadataStore(matchRepo, playerRepo);

    await store.recordMatchStart('room-bot', {
      roomId: 'room-bot',
      profile: CLASSIC_PROFILE,
      seedHash: 'hash-bot',
      playerCount: 2,
      startedAt: new Date('2026-07-13T00:00:00.000Z'),
    });
    await store.recordMatchResult('room-bot', {
      seed: SEED,
      // winnerUserId omitted — the winner is a bot.
      finishedAt: new Date('2026-07-13T00:30:00.000Z'),
      playerResults: [
        { seat: 0, finalVp: 10, result: 'win' }, // bot winner
        { seat: 1, finalVp: 4, result: 'loss' },
      ],
    });

    const row = await matchRepo.findByRoomId('room-bot');
    expect(row?.status).toBe('finished');
    expect(row?.winnerId).toBeNull();
    const seats = await playerRepo.findByMatch(row!.id);
    expect(seats.find((s) => s.seat === 0)).toMatchObject({
      userId: null,
      result: 'win',
    });
  });

  it('a reveal/result for an unknown room is a logged no-op, never a throw', async () => {
    testDb = await createTestDb();
    const store = new PgMatchMetadataStore(
      new MatchRepository(testDb.db),
      new MatchPlayerRepository(testDb.db),
    );
    // No recordMatchStart ran, so findByRoomId is null — must NOT throw outward.
    await expect(store.recordSeedReveal('ghost', SEED)).resolves.toBeUndefined();
    await expect(
      store.recordMatchResult('ghost', {
        seed: SEED,
        finishedAt: new Date(),
        playerResults: [],
      }),
    ).resolves.toBeUndefined();
    expect(await store.readSeedReveal('ghost')).toBeNull();
  });
});
