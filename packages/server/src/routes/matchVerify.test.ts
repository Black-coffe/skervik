// @skervik/server — S1.7.3 the fairness verify GATE (the M1-gate closer). Boots
// the real server on an ephemeral port (the S1.7.1/S1.7.2 pattern), seeds a
// finished-match log + reveal sidecar into its `matchesDir`, and drives
// `GET /matches/:id/verify` over real HTTP. Proves: a faithful match verifies
// `ok:true`; a tampered persisted draw OR a swapped reveal seed → `ok:false`
// (corruption caught, not masked — A2 discipline); a not-yet-revealed / unknown
// match returns a clean error that NEVER contains a seed (commit-reveal's commit
// half stays sealed until `game.ended`).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  BoardGeneratedEvent,
  DiceRolledEvent,
  GameEndedEvent,
  GameEvent,
  MatchStartedEvent,
  Seed,
} from '@skervik/core';
import {
  buildTopology,
  gameplayStreamIndex,
  generateBoard,
  rollDie,
} from '@skervik/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHttpServer, type HttpServerHandle } from '../index.js';
import { SEED_REVEAL_FILENAME } from '../matchMetadata.js';
import { sha256Hex } from '../seed.js';

// GAMEPLAY_SLOT is core-private (single source of truth at the draw site); the
// two dice slots are stable public scheme constants (S1.2.1) — mirrored here
// only to author a faithful fixture. verifyMatchRandomness uses the real ones.
const DICE_A_SLOT = 0;
const DICE_B_SLOT = 1;

/** The verify verdict / error body, as the HTTP client sees it after `res.json()`. */
interface VerifyBody {
  readonly ok: boolean;
  readonly winner?: string;
  readonly seedHash: string;
  readonly seed?: string;
  readonly error?: string;
  readonly checks: {
    readonly commitment: { readonly ok: boolean };
    readonly randomness: {
      readonly ok: boolean;
      readonly checked: number;
      readonly mismatches: ReadonlyArray<{
        readonly type: string;
        readonly field: string;
      }>;
    };
  };
}

const SEED: Seed = 'skervik-s1.7.3-endpoint-fixture-seed';
const MATCH_ID = 'verify-fixture-match';
const TOPO = buildTopology();

/** A faithful finished-match log: seedHash commits to SEED; board + dice are real draws. */
function faithfulLog(seed: Seed): GameEvent[] {
  const matchStarted: MatchStartedEvent = {
    type: 'match.started',
    index: 0,
    matchId: MATCH_ID,
    seedHash: sha256Hex(seed),
    playerIds: ['a', 'b', 'c'],
  };
  const layout = generateBoard(seed, TOPO);
  const boardGenerated: BoardGeneratedEvent = {
    type: 'board.generated',
    index: 1,
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: layout.robberTileId,
  };
  const dieA = rollDie(seed, gameplayStreamIndex(2, DICE_A_SLOT));
  const dieB = rollDie(seed, gameplayStreamIndex(2, DICE_B_SLOT));
  const diceRolled: DiceRolledEvent = {
    type: 'dice.rolled',
    index: 2,
    playerId: 'a',
    dieA,
    dieB,
    total: dieA + dieB,
  };
  const gameEnded: GameEndedEvent = {
    type: 'game.ended',
    index: 3,
    winnerId: 'a',
    finalStandings: { a: 10, b: 4, c: 3 },
  };
  return [matchStarted, boardGenerated, diceRolled, gameEnded];
}

function toNdjson(events: readonly GameEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n') + '\n';
}

describe('GET /matches/:id/verify — provably-fair gate (S1.7.3)', () => {
  let handle: HttpServerHandle;
  let baseHttp: string;
  let matchesDir: string;

  beforeEach(async () => {
    matchesDir = await mkdtemp(join(tmpdir(), 'skervik-verify-'));
    handle = await createHttpServer({ matchesDir });
    const { port } = await handle.listen(0, '127.0.0.1');
    baseHttp = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await handle.close();
    await rm(matchesDir, { recursive: true, force: true });
  });

  /** Write a match's log + (optionally) its revealed-seed sidecar into matchesDir. */
  async function seedMatch(
    id: string,
    events: GameEvent[],
    revealSeed: Seed | null,
  ): Promise<void> {
    const dir = join(matchesDir, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'events.ndjson'), toNdjson(events), 'utf8');
    if (revealSeed !== null) {
      await writeFile(
        join(dir, SEED_REVEAL_FILENAME),
        JSON.stringify({ seed: revealSeed, revealedAt: '2026-07-07T00:00:00.000Z' }),
        'utf8',
      );
    }
  }

  it('verifies a faithful finished match → ok:true with the winner and both checks green', async () => {
    await seedMatch(MATCH_ID, faithfulLog(SEED), SEED);

    const res = await fetch(`${baseHttp}/matches/${MATCH_ID}/verify`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VerifyBody;

    expect(body.ok).toBe(true);
    expect(body.winner).toBe('a');
    expect(body.seedHash).toBe(sha256Hex(SEED));
    expect(body.checks.commitment.ok).toBe(true);
    expect(body.checks.randomness.ok).toBe(true);
    // board + dice were both recomputed and matched.
    expect(body.checks.randomness.checked).toBe(2);
    expect(body.checks.randomness.mismatches).toEqual([]);
  });

  it('catches a tampered persisted draw → ok:false naming the mismatch (A2)', async () => {
    const events = faithfulLog(SEED);
    const dice = events[2] as DiceRolledEvent;
    // Flip the recorded die face — the seed still recomputes the true value.
    events[2] = {
      ...dice,
      dieA: (dice.dieA % 6) + 1,
      total: (dice.dieA % 6) + 1 + dice.dieB,
    };
    await seedMatch(MATCH_ID, events, SEED);

    const res = await fetch(`${baseHttp}/matches/${MATCH_ID}/verify`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VerifyBody;

    expect(body.ok).toBe(false);
    expect(body.checks.commitment.ok).toBe(true); // the seed still matches its hash
    expect(body.checks.randomness.ok).toBe(false);
    expect(
      body.checks.randomness.mismatches.some(
        (m: { type: string; field: string }) =>
          m.type === 'dice.rolled' && m.field === 'dieA',
      ),
    ).toBe(true);
  });

  it('catches a swapped reveal seed → commitment fails, ok:false', async () => {
    // The log commits to SEED, but the revealed sidecar holds a different seed.
    await seedMatch(MATCH_ID, faithfulLog(SEED), 'a-different-seed-entirely');

    const res = await fetch(`${baseHttp}/matches/${MATCH_ID}/verify`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VerifyBody;

    expect(body.ok).toBe(false);
    expect(body.checks.commitment.ok).toBe(false);
  });

  it('does NOT leak the seed for a not-yet-ended match (no reveal) → 409, no seed', async () => {
    await seedMatch(MATCH_ID, faithfulLog(SEED), null); // log exists, reveal absent

    const res = await fetch(`${baseHttp}/matches/${MATCH_ID}/verify`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as VerifyBody;

    expect(body.error).toBe('MATCH_NOT_ENDED');
    expect(body.seed).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(SEED);
  });

  it('does NOT leak the seed when a reveal sidecar exists but the log has no game.ended (N1)', async () => {
    // Belt-and-suspenders: a stray/partial sidecar (crash, manual copy) must
    // never leak the seed of an unfinished match. The log here omits
    // `game.ended`, so the endpoint must refuse even though the sidecar is present.
    const unfinished = faithfulLog(SEED).filter((event) => event.type !== 'game.ended');
    await seedMatch(MATCH_ID, unfinished, SEED); // sidecar present, but match unfinished

    const res = await fetch(`${baseHttp}/matches/${MATCH_ID}/verify`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as VerifyBody;

    expect(body.error).toBe('MATCH_NOT_ENDED');
    expect(body.seed).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(SEED);
  });

  it('returns 404 for an unknown match (no log) without leaking anything', async () => {
    const res = await fetch(`${baseHttp}/matches/no-such-match/verify`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as VerifyBody;
    expect(body.error).toBe('MATCH_NOT_FOUND');
    expect(body.seed).toBeUndefined();
  });
});
