import { CLASSIC_PROFILE } from '@skervik/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDb } from '../testDb.js';
import { MatchPlayerRepository } from './matchPlayerRepository.js';
import { MatchRepository } from './matchRepository.js';

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
});
