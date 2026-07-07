// @skervik/server — the seed-REVEAL seam (S1.4.3, ADR-0009 Fork 3 / invariant
// #4) + its durable FS writer/reader (S1.7.3). Mirrors the S1.4.2
// `GameEventSink` seam: the room hands its secret seed here — and ONLY here,
// ONLY after a `game.ended` event — so a durable writer can drop in with zero
// change to the room. The reveal deliberately does NOT go into the event log
// (Fork 3): `seed.reveal` is not a `GameEvent`, so it must never pollute the
// replayable one-line-per-event ndjson (invariant #3) — it lives in a JSON
// SIDECAR next to the log. This file holds the interface, the in-memory / no-op
// test defaults, and `FsMatchMetadataStore` — the writer/reader the S1.7.3
// verify endpoint reads the revealed seed back from.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { MatchId, Seed } from '@skervik/core';

/**
 * Receives (and later returns) a match's revealed seed. `recordSeedReveal` is
 * called by the room once the game has ended; `readSeedReveal` is the read path
 * the verify endpoint (S1.7.3) uses to recompute every draw from the log and
 * check it against the public `seedHash`. Both MAY be async (the FS/DB writer);
 * the room `await`s the write in its pipeline. The store is the durable home of
 * the commit-reveal secret — a `null` read means "not revealed yet" (the match
 * has not ended), which the endpoint must surface WITHOUT ever exposing a seed.
 */
export interface MatchMetadataStore {
  recordSeedReveal(matchId: MatchId, seed: Seed): void | Promise<void>;
  readSeedReveal(matchId: MatchId): Seed | null | Promise<Seed | null>;
}

/**
 * Rejects a `matchId` that could escape its `{matchesDir}/{matchId}/` folder
 * (fairness/anti-cheat boundary — the id becomes a filesystem path segment).
 * It is the Colyseus `roomId` today (never client-controlled), but the verify
 * endpoint resolves a URL `:id` to a path too, so this is validated rather than
 * trusted. Mirrors `FsEventSink`'s own constructor guard.
 */
export function assertSafeMatchId(matchId: string): void {
  if (
    matchId.length === 0 ||
    matchId.includes('/') ||
    matchId.includes('\\') ||
    matchId === '..' ||
    matchId.includes('..')
  ) {
    throw new Error(`unsafe matchId for a filesystem path: ${JSON.stringify(matchId)}`);
  }
}

/** Discards the reveal, reads nothing back — the "no durable metadata" default. */
export class NoopMatchMetadataStore implements MatchMetadataStore {
  recordSeedReveal(): void {
    // Intentionally empty — durability is off.
  }
  readSeedReveal(): null {
    return null;
  }
}

/**
 * Buffers each revealed seed in memory, keyed by match — the default the room
 * uses when no `matchesDir` is set, so a test can assert the reveal fired with
 * the exact seed without any filesystem I/O. NOT a persistence layer (nothing
 * survives the process); `FsMatchMetadataStore` is the durable form.
 */
export class InMemoryMatchMetadataStore implements MatchMetadataStore {
  readonly reveals = new Map<MatchId, Seed>();

  recordSeedReveal(matchId: MatchId, seed: Seed): void {
    this.reveals.set(matchId, seed);
  }

  readSeedReveal(matchId: MatchId): Seed | null {
    return this.reveals.get(matchId) ?? null;
  }
}

/** Sidecar filename written next to `events.ndjson`, holding the revealed seed. */
export const SEED_REVEAL_FILENAME = 'seed-reveal.json';

export interface FsMatchMetadataStoreOptions {
  /** Base directory holding one folder per match — the SAME dir `FsEventSink` writes the log to. */
  readonly matchesDir: string;
}

/** On-disk shape of the reveal sidecar (a timestamp is server-side wall-clock, fine here). */
interface SeedRevealFile {
  readonly seed: Seed;
  readonly revealedAt: string;
}

/**
 * The durable reveal store (S1.7.3): writes/reads
 * `{matchesDir}/{matchId}/seed-reveal.json` — a JSON sidecar NEXT TO the match's
 * `events.ndjson`, same dir keyed by the same `matchId` (= `roomId` today), so a
 * single `:id` addresses both. Selected by `matchesDir` exactly like
 * `FsEventSink`. The sidecar is NOT a `GameEvent` and never enters the ndjson
 * (Fork 3), so it cannot perturb the log's replay-equality. Stateless over the
 * files, so one instance can serve every match (the verify endpoint reads any
 * `matchId` through one store).
 */
export class FsMatchMetadataStore implements MatchMetadataStore {
  readonly #matchesDir: string;

  constructor(options: FsMatchMetadataStoreOptions) {
    this.#matchesDir = options.matchesDir;
  }

  #dir(matchId: MatchId): string {
    assertSafeMatchId(matchId);
    return join(this.#matchesDir, matchId);
  }

  async recordSeedReveal(matchId: MatchId, seed: Seed): Promise<void> {
    const dir = this.#dir(matchId);
    await mkdir(dir, { recursive: true });
    const payload: SeedRevealFile = { seed, revealedAt: new Date().toISOString() };
    await writeFile(join(dir, SEED_REVEAL_FILENAME), JSON.stringify(payload), 'utf8');
  }

  async readSeedReveal(matchId: MatchId): Promise<Seed | null> {
    let raw: string;
    try {
      raw = await readFile(join(this.#dir(matchId), SEED_REVEAL_FILENAME), 'utf8');
    } catch (error) {
      // Not-yet-revealed (or unknown match) reads as `null` — never a throw, so
      // the endpoint returns a clean "not revealed" without leaking anything.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const parsed = JSON.parse(raw) as SeedRevealFile;
    return parsed.seed;
  }
}
