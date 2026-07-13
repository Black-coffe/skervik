// S2.6.2a AC1 — durable, DB-backed guest identity (PGlite + migrations incl. 0001).
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { UserRepository } from '../db/repositories/userRepository.js';
import { users } from '../db/schema/index.js';
import { createTestDb, type TestDb } from '../db/testDb.js';
import { DbGuestStore } from './dbGuestStore.js';

describe('DbGuestStore (S2.6.2a AC1)', () => {
  let testDb: TestDb | undefined;

  afterEach(async () => {
    await testDb?.close();
    testDb = undefined;
  });

  it('inserts a durable users row and returns guestId === users.id', async () => {
    testDb = await createTestDb();
    const store = new DbGuestStore(new UserRepository(testDb.db));

    const guest = await store.issueGuest('Alice');
    expect(guest.displayName).toBe('Alice');
    expect(guest.guestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const [row] = await testDb.db.select().from(users).where(eq(users.id, guest.guestId));
    expect(row).toBeDefined();
    expect(row?.isGuest).toBe(true);
    expect(row?.authProvider).toBe('guest');
    expect(row?.displayName).toBe('Alice');
    expect(row?.username).toMatch(/^guest_[0-9a-f]{12}$/);
  });

  it('mints a DISTINCT userId + unique username for a second same-name guest', async () => {
    testDb = await createTestDb();
    const store = new DbGuestStore(new UserRepository(testDb.db));

    const a = await store.issueGuest('Alice');
    const b = await store.issueGuest('Alice');

    expect(a.guestId).not.toBe(b.guestId);
    const rows = await testDb.db.select().from(users);
    const handles = rows.map((r) => r.username);
    expect(new Set(handles).size).toBe(handles.length); // handles never collide
    expect(a.displayName).toBe('Alice');
    expect(b.displayName).toBe('Alice'); // display names may collide
  });

  it('generates a Guest-XXXX name when none is usable (sanitize fallback)', async () => {
    testDb = await createTestDb();
    const store = new DbGuestStore(new UserRepository(testDb.db));

    const guest = await store.issueGuest('   ');
    expect(guest.displayName).toMatch(/^Guest-[0-9A-F]{4}$/);
  });
});
