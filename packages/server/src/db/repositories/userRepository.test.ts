import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { users } from '../schema/index.js';
import { createTestDb, type TestDb } from '../testDb.js';
import { UserRepository } from './userRepository.js';

describe('UserRepository', () => {
  let testDb: TestDb | undefined;

  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it('round-trips a created row (AC2)', async () => {
    testDb = await createTestDb();
    const repo = new UserRepository(testDb.db);

    const created = await repo.create({ username: 'kestrel', isGuest: true });

    // App-generated UUID (Invariant 5) — not empty, not a DB-default artifact.
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(created.username).toBe('kestrel');
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

    await repo.create({ username: 'duplicate' });
    await expect(repo.create({ username: 'duplicate' })).rejects.toThrow();
  });

  it('excludes soft-deleted rows from the live-user read (AC3)', async () => {
    testDb = await createTestDb();
    const repo = new UserRepository(testDb.db);

    const created = await repo.create({ username: 'erased' });
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
});
