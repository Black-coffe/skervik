// @skervik/server — the log-append SEAM (S1.4.2, ADR-0009 Fork 2/S1.4.4).
// The intent pipeline hands every validated `GameEvent[]` to a `GameEventSink`
// BEFORE broadcasting it, so the durable ndjson writer S1.4.4 supplies can
// drop in here with zero change to the pipeline. This file deliberately builds
// NO persistence — only the interface plus in-memory/no-op defaults.
import type { GameEvent } from '@skervik/core';

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
