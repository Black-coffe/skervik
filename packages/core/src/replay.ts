// @skervik/core — event-LOG layer: the on-disk/wire shape of a recorded match
// (tech spec §6.4, `matches/{id}/events.ndjson`, ADR-0009 Fork 2) and the pure
// function that turns it back into a {@link GameState}.
//
// The persisted line format is the BARE {@link GameEvent}: exactly the object
// `reduce` consumes, one `JSON.stringify(event)` per ndjson line — no separate
// UPPER_CASE wire schema to keep in lockstep with the event union. This retires
// the pre-E1.1 `EventLogLine` union, which only encoded 3 of ~18 event types
// (and, e.g., couldn't persist `resources.produced` at all); the bare format
// round-trips every event `reduce` understands, losslessly.
//
// This module stays browser-safe/isomorphic (ADR-0003): no `node:fs`, no
// `node:path`, no file I/O, no `Date.now`/`Math.random`. It takes the log
// content as an in-memory string — reading it off disk/S3 is the caller's job
// (server, or a test's fixture loader). Reconstruction delegates to `replay`
// (`./reduce.js`), the single source of truth for the fold.

import type { GameEvent } from './types.js';

/**
 * Parses an ndjson event log (tech spec §6.4, ADR-0009 Fork 2) — one
 * `JSON.stringify(GameEvent)` per line — into the bare {@link GameEvent}[]
 * that `reduce`/`replay` consume directly. Pure: takes the log content as a
 * string, never a path — reading the file/object is the caller's concern.
 * Blank lines are skipped (trailing-newline tolerance). Feed the result to
 * `replay(initialState, events)` to reconstruct the final {@link GameState}.
 */
export function parseGameEventLog(ndjson: string): GameEvent[] {
  return ndjson
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as GameEvent);
}
