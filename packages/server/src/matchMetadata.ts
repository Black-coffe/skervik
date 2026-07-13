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

import type { MatchId, RuleProfile, Seed } from '@skervik/core';

import type { MatchPlayerResult } from './db/schema/index.js';

/**
 * Receives (and later returns) a match's revealed seed. `recordSeedReveal` is
 * called by the room once the game has ended; `readSeedReveal` is the read path
 * the verify endpoint (S1.7.3) uses to recompute every draw from the log and
 * check it against the public `seedHash`. Both MAY be async (the FS/DB writer);
 * the room `await`s the write in its pipeline. The store is the durable home of
 * the commit-reveal secret — a `null` read means "not revealed yet" (the match
 * has not ended), which the endpoint must surface WITHOUT ever exposing a seed.
 */
/**
 * The `match.started` metadata (S2.6.3): everything known when a match opens, so
 * a durable store can insert a `status:'live'` row that a later `game.ended`
 * completes. `roomId` duplicates the interface's `matchId` key (they are the same
 * Colyseus `roomId` today) so the Pg impl can write the `room_id` column without
 * re-deriving it. A wall-clock `startedAt` is fine here — this is a pure metadata
 * side-effect, NEVER a `GameEvent` (ADR-0009 Fork 3), so it can never perturb the
 * deterministic core / event log.
 */
export interface MatchStartMetadata {
  readonly roomId: string;
  /** The FULLY-RESOLVED rule profile the match runs under (jsonb, not a profileId). */
  readonly profile: RuleProfile;
  readonly seedHash: string;
  readonly playerCount: number;
  readonly startedAt: Date;
  /** Pointer to the ndjson log (FS path today), or omitted when durability is off. */
  readonly eventLogUri?: string;
}

/** One seat's final standing (S2.6.3) — a `match_players` row's payload. */
export interface MatchPlayerResultMetadata {
  readonly seat: number;
  /** The token-authenticated userId, or omitted for a bot / tokenless-guest seat (→ null). */
  readonly userId?: string;
  readonly finalVp: number;
  readonly result: MatchPlayerResult;
}

/**
 * The `game.ended` metadata (S2.6.3): the commit-reveal `seed`, the resolved
 * winner (or none if the winning seat has no userId), and one entry per seat. A
 * pure side-effect on the room's queue, like {@link MatchStartMetadata} — it runs
 * AFTER the event log + broadcast already committed and can never feed back in.
 */
export interface MatchResultMetadata {
  readonly seed: Seed;
  /** The winning seat's resolved userId, or omitted for a bot / tokenless winner (→ null). */
  readonly winnerUserId?: string;
  readonly finishedAt: Date;
  readonly playerResults: readonly MatchPlayerResultMetadata[];
}

export interface MatchMetadataStore {
  recordSeedReveal(matchId: MatchId, seed: Seed): void | Promise<void>;
  readSeedReveal(matchId: MatchId): Seed | null | Promise<Seed | null>;
  /**
   * Records a freshly-started match (`status:'live'`). A pure metadata
   * side-effect (S2.6.3): NEVER a `GameEvent`, never in `events.ndjson`, never
   * feeds `reduce`/`validate`. MAY be async (the Pg/FS writer); the room fires it
   * best-effort AFTER the genesis batch is appended + committed.
   */
  recordMatchStart(matchId: MatchId, meta: MatchStartMetadata): void | Promise<void>;
  /**
   * Completes a match at `game.ended` (`status:'finished'`, seed, winner, per-seat
   * results). Same purity contract as {@link recordMatchStart}; fired alongside
   * `recordSeedReveal` on the queue tail, best-effort.
   */
  recordMatchResult(matchId: MatchId, meta: MatchResultMetadata): void | Promise<void>;
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

/** Discards every write, reads nothing back — the "no durable metadata" default. */
export class NoopMatchMetadataStore implements MatchMetadataStore {
  recordSeedReveal(): void {
    // Intentionally empty — durability is off.
  }
  readSeedReveal(): null {
    return null;
  }
  recordMatchStart(): void {
    // Intentionally empty — durability is off.
  }
  recordMatchResult(): void {
    // Intentionally empty — durability is off.
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
  /** Buffered `recordMatchStart` payloads, keyed by match — for test assertions (S2.6.3). */
  readonly starts = new Map<MatchId, MatchStartMetadata>();
  /** Buffered `recordMatchResult` payloads, keyed by match — for test assertions (S2.6.3). */
  readonly results = new Map<MatchId, MatchResultMetadata>();

  recordSeedReveal(matchId: MatchId, seed: Seed): void {
    this.reveals.set(matchId, seed);
  }

  readSeedReveal(matchId: MatchId): Seed | null {
    return this.reveals.get(matchId) ?? null;
  }

  recordMatchStart(matchId: MatchId, meta: MatchStartMetadata): void {
    this.starts.set(matchId, meta);
  }

  recordMatchResult(matchId: MatchId, meta: MatchResultMetadata): void {
    this.results.set(matchId, meta);
  }
}

/** Sidecar filename written next to `events.ndjson`, holding the revealed seed. */
export const SEED_REVEAL_FILENAME = 'seed-reveal.json';

/** Sidecar filename holding the durable match metadata (start + result, S2.6.3). */
export const MATCH_METADATA_FILENAME = 'match.json';

/**
 * On-disk shape of the `match.json` sidecar (S2.6.3) — the start payload,
 * completed with the result at `game.ended`. `start` is optional so a
 * result-before-start write (shouldn't happen; best-effort) still persists.
 */
interface MatchMetadataFile {
  readonly start?: MatchStartMetadata;
  readonly result?: MatchResultMetadata;
}

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

  async #readMetadataFile(matchId: MatchId): Promise<MatchMetadataFile | null> {
    try {
      const raw = await readFile(
        join(this.#dir(matchId), MATCH_METADATA_FILENAME),
        'utf8',
      );
      return JSON.parse(raw) as MatchMetadataFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async recordMatchStart(matchId: MatchId, meta: MatchStartMetadata): Promise<void> {
    const dir = this.#dir(matchId);
    await mkdir(dir, { recursive: true });
    // A `match.json` sidecar NEXT TO the log (same dir/id as `seed-reveal.json`) —
    // never a `GameEvent`, so it can't pollute the replayable ndjson (Fork 3).
    const payload: MatchMetadataFile = { start: meta };
    await writeFile(join(dir, MATCH_METADATA_FILENAME), JSON.stringify(payload), 'utf8');
  }

  async recordMatchResult(matchId: MatchId, meta: MatchResultMetadata): Promise<void> {
    const dir = this.#dir(matchId);
    await mkdir(dir, { recursive: true });
    // Fold the result into the existing start sidecar; tolerate a missing start
    // (best-effort metadata) by writing the result alone rather than throwing.
    const existing = await this.#readMetadataFile(matchId);
    const payload: MatchMetadataFile = { ...existing, result: meta };
    await writeFile(join(dir, MATCH_METADATA_FILENAME), JSON.stringify(payload), 'utf8');
  }
}
