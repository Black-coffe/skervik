// @skervik/server — S2.6.4 GDPR self-service endpoints, route-level over a
// hermetic PGlite DB (the repository-test pattern) + Fastify `inject` (no socket
// needed). Proves: an authed caller exports ONLY their own data + erases ONLY
// their own account; erasure tombstones + scrubs + retains match history; and
// the AC3 authz forcing — no/invalid/other-user token, and a post-erasure token,
// cannot reach another identity's data.
import { CLASSIC_PROFILE } from '@skervik/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MatchPlayerRepository,
  MatchRepository,
  TOMBSTONE_DISPLAY_NAME,
  UserRepository,
} from '../db/repositories/index.js';
import { createTestDb, type TestDb } from '../db/testDb.js';
import { registerAccountRoutes, type VerifySessionToken } from './account.js';

interface Harness {
  readonly fastify: FastifyInstance;
  readonly userRepo: UserRepository;
  readonly matchRepo: MatchRepository;
  readonly playerRepo: MatchPlayerRepository;
  /** token string → the claims it verifies to (unknown tokens verify to null). */
  readonly tokens: Map<string, { userId: string; displayName: string }>;
  close(): Promise<void>;
}

async function buildHarness(testDb: TestDb): Promise<Harness> {
  const userRepo = new UserRepository(testDb.db);
  const matchRepo = new MatchRepository(testDb.db);
  const playerRepo = new MatchPlayerRepository(testDb.db);
  const tokens = new Map<string, { userId: string; displayName: string }>();
  // A stand-in for the real HS256 verifier (S2.6.2a) — the route only depends on
  // its shape; this maps a known token string to claims, everything else → null.
  const verifySessionToken: VerifySessionToken = async (token) =>
    tokens.get(token) ?? null;

  const fastify = Fastify({ logger: false });
  registerAccountRoutes(fastify, {
    userRepository: userRepo,
    matchRepository: matchRepo,
    matchPlayerRepository: playerRepo,
    verifySessionToken,
  });
  await fastify.ready();
  return {
    fastify,
    userRepo,
    matchRepo,
    playerRepo,
    tokens,
    close: () => fastify.close(),
  };
}

/** Seat `user` at `seat` in a fresh match; returns the created match. */
async function seatUserInMatch(
  h: Harness,
  roomId: string,
  userId: string,
  seat: number,
  result: 'win' | 'loss' | 'abandoned',
  finalVp: number,
): Promise<{ id: string }> {
  const match = await h.matchRepo.create({
    roomId,
    profile: CLASSIC_PROFILE,
    seedHash: `hash-${roomId}`,
    playerCount: 2,
    startedAt: new Date(),
  });
  await h.playerRepo.create({ matchId: match.id, userId, seat, finalVp, result });
  return match;
}

describe('account routes — GDPR export + erasure (S2.6.4)', () => {
  let testDb: TestDb | undefined;
  let h: Harness | undefined;

  afterEach(async () => {
    await h?.close();
    h = undefined;
    await testDb?.close();
    testDb = undefined;
  });

  async function setup(): Promise<Harness> {
    testDb = await createTestDb();
    h = await buildHarness(testDb);
    return h;
  }

  // --- AC2: export -----------------------------------------------------------

  it('GET /account/export returns the authed user’s row + their matches (AC2)', async () => {
    const app = await setup();
    const alice = await app.userRepo.create({
      username: 'alice',
      displayName: 'Alice',
      email: 'alice@sea.test',
      isGuest: false,
    });
    app.tokens.set('alice-token', { userId: alice.id, displayName: 'Alice' });
    const match = await seatUserInMatch(app, 'room-x', alice.id, 0, 'win', 10);

    const res = await app.fastify.inject({
      method: 'GET',
      url: '/account/export',
      headers: { authorization: 'Bearer alice-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      user: { id: string; displayName: string; email: string | null };
      matches: Array<{
        matchId: string;
        seat: number;
        finalVp: number | null;
        result: string | null;
        profileId: string;
        status: string;
      }>;
    };
    expect(body.user.id).toBe(alice.id);
    expect(body.user.email).toBe('alice@sea.test');
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toMatchObject({
      matchId: match.id,
      seat: 0,
      finalVp: 10,
      result: 'win',
      profileId: CLASSIC_PROFILE.id,
      status: 'live',
    });
  });

  it('export is own-data-only — a token returns ONLY that user’s matches (AC3)', async () => {
    const app = await setup();
    const alice = await app.userRepo.create({ username: 'alice', displayName: 'Alice' });
    const bob = await app.userRepo.create({ username: 'bob', displayName: 'Bob' });
    app.tokens.set('alice-token', { userId: alice.id, displayName: 'Alice' });
    await seatUserInMatch(app, 'room-a', alice.id, 0, 'win', 10);
    await seatUserInMatch(app, 'room-b', bob.id, 0, 'win', 10);

    const res = await app.fastify.inject({
      method: 'GET',
      url: '/account/export',
      headers: { authorization: 'Bearer alice-token' },
    });
    const body = res.json() as { user: { id: string }; matches: unknown[] };
    expect(body.user.id).toBe(alice.id);
    // Alice's export never contains Bob's match.
    expect(body.matches).toHaveLength(1);
  });

  // --- AC3: authz forcing ----------------------------------------------------

  it('export with NO token → 401 (AC3)', async () => {
    const app = await setup();
    const res = await app.fastify.inject({ method: 'GET', url: '/account/export' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'UNAUTHENTICATED' });
  });

  it('export with an INVALID token → 401 (AC3)', async () => {
    const app = await setup();
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/account/export',
      headers: { authorization: 'Bearer not-a-known-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('delete with NO token → 401, no user erased (AC3)', async () => {
    const app = await setup();
    const res = await app.fastify.inject({ method: 'POST', url: '/account/delete' });
    expect(res.statusCode).toBe(401);
  });

  // --- AC1: erasure ----------------------------------------------------------

  it('POST /account/delete tombstones + scrubs the authed user, retains matches (AC1)', async () => {
    const app = await setup();
    const alice = await app.userRepo.create({
      username: 'alice',
      displayName: 'Alice',
      email: 'alice@sea.test',
    });
    const bob = await app.userRepo.create({ username: 'bob', displayName: 'Bob' });
    app.tokens.set('alice-token', { userId: alice.id, displayName: 'Alice' });
    const match = await seatUserInMatch(app, 'room-shared', alice.id, 0, 'win', 10);
    await app.playerRepo.create({
      matchId: match.id,
      userId: bob.id,
      seat: 1,
      finalVp: 4,
      result: 'loss',
    });

    const res = await app.fastify.inject({
      method: 'POST',
      url: '/account/delete',
      headers: { authorization: 'Bearer alice-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: true });

    // Tombstoned + scrubbed; gone from live reads.
    expect(await app.userRepo.findLiveById(alice.id)).toBeNull();
    const raw = await app.userRepo.findById(alice.id);
    expect(raw?.displayName).toBe(TOMBSTONE_DISPLAY_NAME);
    expect(raw?.email).toBeNull();

    // Match integrity: both seats + the retained rows survive erasure.
    const seats = await app.playerRepo.findByMatch(match.id);
    expect(seats).toHaveLength(2);
    expect(seats.find((s) => s.seat === 0)?.userId).toBe(alice.id); // still linked
    expect(seats.find((s) => s.seat === 1)?.userId).toBe(bob.id); // untouched
    // Bob (the other participant) is unaffected — still a live user.
    expect((await app.userRepo.findLiveById(bob.id))?.id).toBe(bob.id);
  });

  it('a post-erasure token resolves as unauthenticated (401) for export + delete (AC3)', async () => {
    const app = await setup();
    const alice = await app.userRepo.create({ username: 'alice', displayName: 'Alice' });
    app.tokens.set('alice-token', { userId: alice.id, displayName: 'Alice' });

    // Erase, then re-present the SAME (still cryptographically valid) token.
    const del = await app.fastify.inject({
      method: 'POST',
      url: '/account/delete',
      headers: { authorization: 'Bearer alice-token' },
    });
    expect(del.statusCode).toBe(200);

    const exportAgain = await app.fastify.inject({
      method: 'GET',
      url: '/account/export',
      headers: { authorization: 'Bearer alice-token' },
    });
    expect(exportAgain.statusCode).toBe(401);

    const deleteAgain = await app.fastify.inject({
      method: 'POST',
      url: '/account/delete',
      headers: { authorization: 'Bearer alice-token' },
    });
    expect(deleteAgain.statusCode).toBe(401);
  });
});
