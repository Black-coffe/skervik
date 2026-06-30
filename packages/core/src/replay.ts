// @skervik/core — event-LOG layer (S0.5.4): the on-disk/wire shape of a
// recorded match (tech spec §6.4, `matches/{id}/events.ndjson`) and the pure
// functions that turn it back into a {@link GameState}.
//
// This module stays browser-safe/isomorphic (ADR-0003): no `node:fs`, no
// `node:path`, no file I/O, no `Date.now`/`Math.random`. Every function here
// takes already-in-memory data (a string or parsed entries) — reading the
// log off disk/S3 is the caller's job (server, or a test's fixture loader).
//
// `replayLog` does not reimplement the fold: it maps {@link EventLogLine}s to
// {@link GameEvent}s and delegates to `replay`/`reduce` from `./reduce.js`
// (S0.5.2), the single source of truth for "apply one event".

import { replay } from './reduce.js';
import type { GameEvent, GameState, MatchId, PlayerId } from './types.js';

/** `data` payload of a `MATCH_STARTED` log line — mirrors {@link MatchStartedEvent}. */
export interface MatchStartedLogData {
  readonly matchId: MatchId;
  readonly seedHash: string;
  readonly playerIds: readonly PlayerId[];
}

/**
 * `data` payload of a `DICE_ROLLED` log line — mirrors {@link DiceRolledEvent}.
 * `result` is the resolved face value; the line's `rngStreamIndex` (sibling
 * of `data`, required on this variant) is what makes it recomputable —
 * anyone with the revealed `seed` can call `rollDie(seed, rngStreamIndex)`
 * and confirm it equals `result` (`docs/wiki/fair-rng-commit-reveal.md`).
 */
export interface DiceRolledLogData {
  readonly playerId: PlayerId;
  readonly result: number;
}

/** `data` payload of a `TURN_ENDED` log line — mirrors {@link TurnEndedEvent}. */
export interface TurnEndedLogData {
  readonly playerId: PlayerId;
  readonly nextPlayerId: PlayerId;
}

/** Fields shared by every {@link EventLogLine} variant (tech spec §6.4). */
interface BaseLogLine {
  /** Position in the log / PRNG stream — becomes `GameEvent.index` on replay. */
  readonly seq: number;
  /** Recording timestamp (unix seconds). Metadata only — never read by replay logic. */
  readonly ts: number;
  /** Who caused the event: a `PlayerId`, or `"system"` for server-resolved facts. */
  readonly actor: string;
}

/**
 * One line of a recorded match event log (tech spec §6.4): `{ seq, ts, type,
 * actor, data, rngStreamIndex }`, one JSON object per ndjson line. A
 * discriminated union on `type` so a random-event line (`DICE_ROLLED`) is
 * required to carry `rngStreamIndex` at the type level — the fair-RNG audit
 * field can't be silently omitted.
 */
export type EventLogLine =
  | (BaseLogLine & { readonly type: 'MATCH_STARTED'; readonly data: MatchStartedLogData })
  | (BaseLogLine & {
      readonly type: 'DICE_ROLLED';
      readonly data: DiceRolledLogData;
      readonly rngStreamIndex: number;
    })
  | (BaseLogLine & { readonly type: 'TURN_ENDED'; readonly data: TurnEndedLogData });

/**
 * Parses an ndjson event log (one JSON object per line, tech spec §6.4) into
 * typed {@link EventLogLine}s. Pure: takes the log content as a string, never
 * a path — reading the file/object is the caller's concern. Blank lines are
 * skipped (trailing newline tolerance).
 */
export function parseEventLog(ndjson: string): EventLogLine[] {
  return ndjson
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EventLogLine);
}

/**
 * Maps one {@link EventLogLine} to the {@link GameEvent} `reduce` understands.
 * `seq` becomes `index`; the random-event line's `result` becomes the
 * event's `value` (the fact `reduce` applies — recomputing/verifying it
 * against `rngStreamIndex` is the audit step, not part of replay itself).
 */
function toGameEvent(line: EventLogLine): GameEvent {
  switch (line.type) {
    case 'MATCH_STARTED':
      return {
        type: 'match.started',
        index: line.seq,
        matchId: line.data.matchId,
        seedHash: line.data.seedHash,
        playerIds: line.data.playerIds,
      };
    case 'DICE_ROLLED':
      return {
        type: 'dice.rolled',
        index: line.seq,
        playerId: line.data.playerId,
        value: line.data.result,
      };
    case 'TURN_ENDED':
      return {
        type: 'turn.ended',
        index: line.seq,
        playerId: line.data.playerId,
        nextPlayerId: line.data.nextPlayerId,
      };
    default: {
      const exhaustive: never = line;
      throw new Error(`unhandled event-log line type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Replays a parsed event log from `initialState` to the final
 * {@link GameState}: maps each {@link EventLogLine} to a `GameEvent` (in
 * order) and folds them through `reduce` via `replay` from `./reduce.js` —
 * "replay = truth" (`docs/wiki/deterministic-core.md`). Named distinctly
 * from `replay` (which folds already-typed `GameEvent`s) so both stay
 * exported without colliding.
 */
export function replayLog(
  initialState: GameState,
  entries: readonly EventLogLine[],
): GameState {
  return replay(initialState, entries.map(toGameEvent));
}
