import { CLASSIC_PROFILE } from '@skervik/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDb } from '../testDb.js';
import { MatchRepository } from './matchRepository.js';
import { UserRepository } from './userRepository.js';

describe('MatchRepository', () => {
  let testDb: TestDb | undefined;

  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it('round-trips a created row, including the profile jsonb (AC2)', async () => {
    testDb = await createTestDb();
    const repo = new MatchRepository(testDb.db);

    const created = await repo.create({
      roomId: 'room-round-trip',
      profile: CLASSIC_PROFILE,
      seedHash: 'abc123',
      playerCount: 4,
      startedAt: new Date('2026-07-13T00:00:00.000Z'),
    });

    expect(created.status).toBe('live');
    expect(created.seed).toBeNull();
    // The FULLY-RESOLVED RuleProfile round-trips byte-for-byte through jsonb.
    expect(created.profile).toEqual(CLASSIC_PROFILE);

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);
  });

  it('applies the game.ended update (seed reveal, winner, close)', async () => {
    testDb = await createTestDb();
    const matchRepo = new MatchRepository(testDb.db);
    const userRepo = new UserRepository(testDb.db);

    const winner = await userRepo.create({
      username: 'winner-of-record',
      displayName: 'Winner',
    });
    const created = await matchRepo.create({
      roomId: 'room-ended-update',
      profile: CLASSIC_PROFILE,
      seedHash: 'abc123',
    });

    const finishedAt = new Date('2026-07-13T01:00:00.000Z');
    const updated = await matchRepo.update(created.id, {
      seed: 'the-revealed-seed',
      winnerId: winner.id,
      status: 'finished',
      finishedAt,
    });

    expect(updated?.seed).toBe('the-revealed-seed');
    expect(updated?.winnerId).toBe(winner.id);
    expect(updated?.status).toBe('finished');
    expect(updated?.finishedAt).toEqual(finishedAt);
  });

  it('findByRoomId resolves the durable row from the Colyseus roomId (S2.6.3)', async () => {
    testDb = await createTestDb();
    const repo = new MatchRepository(testDb.db);

    const created = await repo.create({
      roomId: 'room-lookup',
      profile: CLASSIC_PROFILE,
      seedHash: 'abc123',
    });

    const found = await repo.findByRoomId('room-lookup');
    expect(found).toEqual(created);
    expect(await repo.findByRoomId('no-such-room')).toBeNull();
  });

  it('update with an empty patch is a no-op returning the current row (nit #1 guard)', async () => {
    testDb = await createTestDb();
    const repo = new MatchRepository(testDb.db);
    const created = await repo.create({
      roomId: 'room-empty-patch',
      profile: CLASSIC_PROFILE,
      seedHash: 'abc123',
    });

    // Drizzle throws "No values to set" on `.set({})`; the guard returns the row.
    const unchanged = await repo.update(created.id, {});
    expect(unchanged).toEqual(created);
  });

  it('rejects a winner_id that does not exist (FK, AC3)', async () => {
    testDb = await createTestDb();
    const repo = new MatchRepository(testDb.db);
    const created = await repo.create({
      roomId: 'room-fk-reject',
      profile: CLASSIC_PROFILE,
      seedHash: 'abc123',
    });

    await expect(
      repo.update(created.id, { winnerId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow();
  });
});
