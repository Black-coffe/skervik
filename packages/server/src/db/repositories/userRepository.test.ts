import { CLASSIC_PROFILE } from '@skervik/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { users } from '../schema/index.js';
import { createTestDb, type TestDb } from '../testDb.js';
import { MatchPlayerRepository } from './matchPlayerRepository.js';
import { MatchRepository } from './matchRepository.js';
import { TOMBSTONE_DISPLAY_NAME, UserRepository } from './userRepository.js';

describe('UserRepository', () => {
  let testDb: TestDb | undefined;

  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it('round-trips a created row (AC2)', async () => {
    testDb = await createTestDb();
    const repo = new UserRepository(testDb.db);

    const created = await repo.create({
      username: 'kestrel',
      displayName: 'Kestrel',
      isGuest: true,
    });

    // App-generated UUID (Invariant 5) — not empty, not a DB-default artifact.
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(created.username).toBe('kestrel');
    expect(created.displayName).toBe('Kestrel');
    expect(created.isGuest).toBe(true);
    expect(created.email).toBeNull();
    expect(created.deletedAt).toBeNull();

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);

    const foundByUsername = await repo.findByUsername('kestrel');
    expect(foundByUsername).toEqual(created);
  });

  it('rejects a duplicate username (unique constraint)', async () => {
    testDb = await createTestDb();
    const repo = new UserRepository(testDb.db);

    await repo.create({ username: 'duplicate', displayName: 'Dup' });
    await expect(
      repo.create({ username: 'duplicate', displayName: 'Dup' }),
    ).rejects.toThrow();
  });

  it('excludes soft-deleted rows from the live-user read (AC3)', async () => {
    testDb = await createTestDb();
    const repo = new UserRepository(testDb.db);

    const created = await repo.create({ username: 'erased', displayName: 'Erased' });
    await testDb.db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, created.id));

    // Still resolvable by id (e.g. a match history's foreign-key display)...
    const byId = await repo.findById(created.id);
    expect(byId?.deletedAt).not.toBeNull();

    // ...but excluded from the "live user" username lookup.
    const byUsername = await repo.findByUsername('erased');
    expect(byUsername).toBeNull();
  });

  // --- S2.6.4 GDPR erasure ---------------------------------------------------

  it('softDeleteAndAnonymize tombstones + scrubs PII and returns the tombstone (AC1)', async () => {
    testDb = await createTestDb();
    const repo = new UserRepository(testDb.db);

    const created = await repo.create({
      username: 'nemo',
      displayName: 'Captain Nemo',
      email: 'nemo@nautilus.sea',
    });
    expect(created.email).toBe('nemo@nautilus.sea');

    const tombstone = await repo.softDeleteAndAnonymize(created.id);
    expect(tombstone?.deletedAt).toBeInstanceOf(Date);
    expect(tombstone?.displayName).toBe(TOMBSTONE_DISPLAY_NAME);
    expect(tombstone?.email).toBeNull();
    // id/username are the durable keys the retained match_players rows point at.
    expect(tombstone?.id).toBe(created.id);
    expect(tombstone?.username).toBe('nemo');

    // Gone from live reads, but the row itself is retained (id lookup + FK display).
    expect(await repo.findLiveById(created.id)).toBeNull();
    expect((await repo.findById(created.id))?.deletedAt).not.toBeNull();
  });

  it('softDeleteAndAnonymize is idempotent — a second call is a no-op, deletedAt unchanged (AC1)', async () => {
    testDb = await createTestDb();
    const repo = new UserRepository(testDb.db);

    const created = await repo.create({ username: 'idem', displayName: 'Idem' });
    const first = await repo.softDeleteAndAnonymize(created.id);
    const second = await repo.softDeleteAndAnonymize(created.id);

    // The tombstone timestamp from the first call is preserved (not re-stamped).
    expect(second?.deletedAt?.getTime()).toBe(first?.deletedAt?.getTime());
    expect(second?.displayName).toBe(TOMBSTONE_DISPLAY_NAME);
    expect(second?.email).toBeNull();
  });

  it('softDeleteAndAnonymize on an unknown id returns null (no row created)', async () => {
    testDb = await createTestDb();
    const repo = new UserRepository(testDb.db);

    const result = await repo.softDeleteAndAnonymize(
      '00000000-0000-0000-0000-000000000000',
    );
    expect(result).toBeNull();
  });

  it('erasure retains the user’s match_players rows (never cascade-delete, AC1)', async () => {
    testDb = await createTestDb();
    const userRepo = new UserRepository(testDb.db);
    const matchRepo = new MatchRepository(testDb.db);
    const playerRepo = new MatchPlayerRepository(testDb.db);

    const user = await userRepo.create({ username: 'aronnax', displayName: 'Aronnax' });
    const match = await matchRepo.create({
      roomId: 'room-erasure-retain',
      profile: CLASSIC_PROFILE,
      seedHash: 'abc123',
    });
    await playerRepo.create({
      matchId: match.id,
      userId: user.id,
      seat: 0,
      finalVp: 10,
      result: 'win',
    });

    await userRepo.softDeleteAndAnonymize(user.id);

    // The match_players row persists, still pointing at the (now tombstoned) user.
    const seats = await playerRepo.findByUser(user.id);
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ matchId: match.id, seat: 0, result: 'win' });
    // The match itself is intact.
    expect((await matchRepo.findById(match.id))?.id).toBe(match.id);
  });
});
