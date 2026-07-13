import { CLASSIC_PROFILE } from '@skervik/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDb } from '../testDb.js';
import { MatchPlayerRepository } from './matchPlayerRepository.js';
import { MatchRepository } from './matchRepository.js';
import { UserRepository } from './userRepository.js';

describe('MatchPlayerRepository', () => {
  let testDb: TestDb | undefined;

  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it('round-trips a created row and lists all seats for a match (AC2)', async () => {
    testDb = await createTestDb();
    const matchRepo = new MatchRepository(testDb.db);
    const playerRepo = new MatchPlayerRepository(testDb.db);
    const match = await matchRepo.create({
      roomId: 'room-mp-roundtrip',
      profile: CLASSIC_PROFILE,
      seedHash: 'abc123',
    });

    const created = await playerRepo.create({
      matchId: match.id,
      seat: 0,
      finalVp: 10,
      result: 'win',
    });
    expect(created).toEqual({
      matchId: match.id,
      userId: null,
      seat: 0,
      finalVp: 10,
      result: 'win',
    });

    await playerRepo.create({ matchId: match.id, seat: 1, result: 'loss' });
    const seats = await playerRepo.findByMatch(match.id);
    expect(seats).toHaveLength(2);
    expect(seats.map((row) => row.seat).sort()).toEqual([0, 1]);
  });

  it('rejects a duplicate seat for the same match (composite PK, AC2)', async () => {
    testDb = await createTestDb();
    const matchRepo = new MatchRepository(testDb.db);
    const playerRepo = new MatchPlayerRepository(testDb.db);
    const match = await matchRepo.create({
      roomId: 'room-mp-dupseat',
      profile: CLASSIC_PROFILE,
      seedHash: 'abc123',
    });

    await playerRepo.create({ matchId: match.id, seat: 0 });
    await expect(playerRepo.create({ matchId: match.id, seat: 0 })).rejects.toThrow();
  });

  it('rejects an orphan match_id (FK, AC3)', async () => {
    testDb = await createTestDb();
    const playerRepo = new MatchPlayerRepository(testDb.db);

    await expect(
      playerRepo.create({ matchId: '00000000-0000-0000-0000-000000000000', seat: 0 }),
    ).rejects.toThrow();
  });

  it('findByUser returns only the given user’s seats, across matches (S2.6.4 export)', async () => {
    testDb = await createTestDb();
    const userRepo = new UserRepository(testDb.db);
    const matchRepo = new MatchRepository(testDb.db);
    const playerRepo = new MatchPlayerRepository(testDb.db);

    const alice = await userRepo.create({ username: 'alice', displayName: 'Alice' });
    const bob = await userRepo.create({ username: 'bob', displayName: 'Bob' });
    const m1 = await matchRepo.create({
      roomId: 'room-fbu-1',
      profile: CLASSIC_PROFILE,
      seedHash: 'h1',
    });
    const m2 = await matchRepo.create({
      roomId: 'room-fbu-2',
      profile: CLASSIC_PROFILE,
      seedHash: 'h2',
    });

    // Alice plays two matches; Bob one; one bot seat (null user) — none of which
    // should show in Alice's export.
    await playerRepo.create({ matchId: m1.id, userId: alice.id, seat: 0, result: 'win' });
    await playerRepo.create({ matchId: m1.id, userId: bob.id, seat: 1, result: 'loss' });
    await playerRepo.create({ matchId: m1.id, seat: 2, result: 'loss' }); // bot seat
    await playerRepo.create({
      matchId: m2.id,
      userId: alice.id,
      seat: 0,
      result: 'loss',
    });

    const aliceSeats = await playerRepo.findByUser(alice.id);
    expect(aliceSeats).toHaveLength(2);
    expect(aliceSeats.map((s) => s.matchId).sort()).toEqual([m1.id, m2.id].sort());
    expect(aliceSeats.every((s) => s.userId === alice.id)).toBe(true);
  });
});
