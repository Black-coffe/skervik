// @skervik/server — the log-append SEAM (S1.4.2, ADR-0009 Fork 2) + the durable
// ndjson writer (S1.4.4b). The intent pipeline hands every validated
// `GameEvent[]` to a `GameEventSink` and `await`s it BEFORE broadcasting, so a
// durable implementation can never let a client observe an event it failed to
// record. This file holds the interface, the in-memory/no-op test defaults, and
// `FsEventSink` — the production writer that appends bare-`GameEvent` ndjson to
// `matches/{matchId}/events.ndjson` (tech spec §6.4).
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { GameEvent, MatchId } from '@skervik/core';

/**
 * Receives each batch of server-validated events the room is about to
 * broadcast. `append` MAY be async (S1.4.4's FS/S3 writer): the pipeline
 * `await`s it before broadcasting, so a durable implementation cannot let a
 * client observe an event it failed to record.
 */
export interface GameEventSink {
  append(events: readonly GameEvent[]): void | Promise<void>;
}

/** Discards every batch — the "no persistence yet" default when durability is off. */
export class NoopEventSink implements GameEventSink {
  append(): void {
    // Intentionally empty — S1.4.4 owns real persistence.
  }
}

/**
 * Buffers every appended event in memory (order preserved) — the default the
 * room uses so a test can assert the pipeline handed it the exact events,
 * without any filesystem I/O. NOT a persistence layer (nothing survives the
 * process); S1.4.4 replaces it with the ndjson writer.
 */
export class InMemoryEventSink implements GameEventSink {
  readonly events: GameEvent[] = [];

  append(events: readonly GameEvent[]): void {
    this.events.push(...events);
  }
}

/** Default base directory for {@link FsEventSink} match logs (tech spec §6.4). */
export const DEFAULT_MATCHES_DIR = './data/matches';

export interface FsEventSinkOptions {
  /** The match this log belongs to — becomes the `matches/{matchId}/` segment. */
  readonly matchId: MatchId;
  /** Base directory holding one folder per match. Defaults to {@link DEFAULT_MATCHES_DIR}. */
  readonly matchesDir?: string;
}

/**
 * The durable production writer (S1.4.4b, ADR-0009 Fork 2 / invariant #3):
 * appends each validated {@link GameEvent} as one `JSON.stringify(event)` ndjson
 * line to `matches/{matchId}/events.ndjson` — the BARE event shape `reduce`
 * consumes, so `parseGameEventLog` → `replay` reconstructs the exact `GameState`
 * (no separate wire schema to keep in lockstep). The dir/file are created lazily
 * on the first append. `append` is awaited by the pipeline BEFORE any broadcast,
 * so a rejecting write (disk error) leaves the room's state uncommitted and no
 * client ever observes an event that was not durably recorded.
 *
 * Append-order safety: Colyseus does NOT serialize a room's async message
 * handlers for you (it dispatches via a synchronous EventEmitter and does not
 * await the handler) — `GameRoom` is responsible for serializing the intent
 * pipeline itself (its per-room `#queue`) so this sink only ever sees one
 * `append` in flight at a time. This class does not defend against concurrent
 * calls on its own.
 */
export class FsEventSink implements GameEventSink {
  /** Absolute-or-relative path of this match's ndjson log. */
  readonly filePath: string;
  /** Lazily flips true once the match directory has been created. */
  #dirEnsured = false;

  constructor(options: FsEventSinkOptions) {
    const matchId = options.matchId;
    // Defensive path-safety (fairness/anti-cheat boundary): `matchId` becomes a
    // filesystem path segment. It is the Colyseus `roomId` today (never
    // client-controlled), but assert it can't smuggle a path separator or `..`
    // traversal rather than trust that invariant silently.
    if (
      matchId.length === 0 ||
      matchId.includes('/') ||
      matchId.includes('\\') ||
      matchId === '..' ||
      matchId.includes('..')
    ) {
      throw new Error(
        `FsEventSink: unsafe matchId for a filesystem path: ${JSON.stringify(matchId)}`,
      );
    }
    this.filePath = join(
      options.matchesDir ?? DEFAULT_MATCHES_DIR,
      matchId,
      'events.ndjson',
    );
  }

  async append(events: readonly GameEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    if (!this.#dirEnsured) {
      await mkdir(dirname(this.filePath), { recursive: true });
      this.#dirEnsured = true;
    }
    const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
    await appendFile(this.filePath, lines, 'utf8');
  }
}
