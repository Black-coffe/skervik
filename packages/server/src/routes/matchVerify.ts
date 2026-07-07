// @skervik/server — the provably-fair verify endpoint (S1.7.3, the M1-gate
// closer). `GET /matches/:id/verify` is the public "Verify" half of
// commit-reveal (`docs/wiki/fair-rng-commit-reveal.md` step 4): for a FINISHED
// match it reads the persisted event log + the revealed seed sidecar and
// returns a machine-checkable verdict proving no roll was altered — anyone can
// call it, no auth (public verifiability IS the point).
//
// Clean split of the two proofs (Key decision #2): core proves the DRAWS
// (`verifyMatchRandomness` recomputes every dice/steal/dev-card/board draw from
// the seed and deep-compares to the log); the server proves the COMMITMENT
// (`sha256Hex(seed) === match.started.seedHash`). Both must hold for `ok`.
//
// Never leaks the seed early (Key decision #4): if the reveal sidecar is absent
// (match not ended / unknown id) the response is a clean error envelope
// (`404`/`409`) that NEVER contains a seed — the commit half stays sealed until
// `game.ended`.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type GameEvent, parseGameEventLog, verifyMatchRandomness } from '@skervik/core';
import type { FastifyInstance } from 'fastify';

import { assertSafeMatchId, type MatchMetadataStore } from '../matchMetadata.js';
import { sha256Hex } from '../seed.js';

export interface MatchVerifyDeps {
  /**
   * Base dir holding one `{matchId}/events.ndjson` per match (the SAME
   * `FsEventSink` writes to). Absent when durability is off — then verify has
   * no logs to read and every id is a clean `404`.
   */
  readonly matchesDir?: string;
  /** The reveal store the endpoint reads the seed back from (S1.7.3). */
  readonly metadataStore: MatchMetadataStore;
}

/** The verdict body for a finished, verifiable match. */
interface VerifyVerdict {
  readonly ok: boolean;
  readonly matchId: string;
  readonly seedHash: string;
  readonly seed: string;
  readonly winner?: string;
  readonly checks: {
    readonly commitment: {
      readonly ok: boolean;
      readonly seedHash: string;
      readonly computedHash: string;
    };
    readonly randomness: {
      readonly ok: boolean;
      readonly checked: number;
      readonly mismatches: ReturnType<typeof verifyMatchRandomness>['mismatches'];
    };
  };
}

/**
 * Register `GET /matches/:id/verify`. Deps are threaded in (mirrors how the
 * guest route threads its store) so the handler stays a thin I/O wrapper around
 * the core proof.
 */
export function registerMatchVerifyRoute(
  fastify: FastifyInstance,
  deps: MatchVerifyDeps,
): void {
  fastify.get('/matches/:id/verify', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Path-safety on the URL id before it touches the filesystem.
    try {
      assertSafeMatchId(id);
    } catch {
      reply.code(400);
      return { error: 'INVALID_MATCH_ID' };
    }

    if (deps.matchesDir === undefined) {
      // No durable logs at all — nothing to verify.
      reply.code(404);
      return { error: 'MATCH_NOT_FOUND' };
    }

    // Read the public event log (unknown match → 404, never a seed).
    let ndjson: string;
    try {
      ndjson = await readFile(join(deps.matchesDir, id, 'events.ndjson'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reply.code(404);
        return { error: 'MATCH_NOT_FOUND' };
      }
      throw error;
    }
    const events: GameEvent[] = parseGameEventLog(ndjson);

    // The seed is revealed ONLY once the match ended (S1.4.3). No reveal ⇒ the
    // match is still in progress ⇒ 409 with NO seed (reveal-timing invariant).
    const seed = await deps.metadataStore.readSeedReveal(id);
    if (seed === null) {
      reply.code(409);
      return { error: 'MATCH_NOT_ENDED' };
    }

    const started = events.find((event) => event.type === 'match.started');
    const ended = events.find((event) => event.type === 'game.ended');
    const seedHash = started?.seedHash ?? '';
    const computedHash = sha256Hex(seed);

    const commitmentOk = computedHash === seedHash;
    const randomness = verifyMatchRandomness(seed, events);

    const verdict: VerifyVerdict = {
      ok: commitmentOk && randomness.ok,
      matchId: id,
      seedHash,
      seed,
      ...(ended?.winnerId !== undefined ? { winner: ended.winnerId } : {}),
      checks: {
        commitment: { ok: commitmentOk, seedHash, computedHash },
        randomness: {
          ok: randomness.ok,
          checked: randomness.checked,
          mismatches: randomness.mismatches,
        },
      },
    };
    return verdict;
  });
}
