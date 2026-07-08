// @skervik/server — the room's MINIMAL public projection (S1.4.1,
// ADR-0009 Fork 1 / invariant #2): seedHash + phase + currentPlayerId + seat
// list ONLY. Never a resource/hand/board field, never the raw seed —
// gameplay flows as `event.batch` broadcasts (S1.4.2), never through this
// Schema.
//
// Fields are declared via `defineTypes()` rather than `@type()` decorators:
// this package's tsconfig targets ES2022 (native class-field "define"
// semantics), which is a documented incompatibility with decorator-installed
// accessors — a class-field initializer would silently overwrite the
// getter/setter `defineTypes()` installs. `declare` fields carry no runtime
// initializer, so construction only ever goes through those getters/setters;
// callers populate an instance via `.assign()` (typed against the declared
// fields), not a custom constructor — `defineTypes()` requires the class'
// constructor signature to stay exactly `typeof Schema`'s.
import { ArraySchema, defineTypes, Schema } from '@colyseus/schema';

/** One seat's public projection: identity + turn order + connection status only — no resource/hand data. */
export class SeatSchema extends Schema {
  declare playerId: string;
  declare seatIndex: number;
  declare connected: boolean;
  /**
   * Anti-AFK projection (S2.1.4): how many of this seat's turns the server has
   * consecutively force-completed on a hard timeout (reset to 0 on any real
   * intent from the player). Session metadata — NOT a game rule, never in
   * `GameState`/the event log, so the deterministic core stays independent of
   * liveness.
   */
  declare consecutiveMisses: number;
  /**
   * True once {@link consecutiveMisses} crosses the profile's `afkThreshold`
   * (S2.1.4) — a "player is away" hint for the HUD that S2.3.3 bot-fill will
   * later consume. S2.1.4 only FLAGS: it never removes the player or swaps in a
   * bot (no karmic ban).
   */
  declare idle: boolean;
  /**
   * True for a bot seat (S2.4.3) — a server-minted `playerId` with no live
   * `Client` behind it, driven through the room's own `#queue` instead of a
   * socket. `false` (the default) for every human seat, unchanged from M1.
   */
  declare isBot: boolean;
  /**
   * The bot's difficulty code (S2.4.3) — `'easy' | 'medium' | 'hard'` for a bot
   * seat, `''` for a human seat (same "empty = not set" convention as this
   * schema's other presentational fields). A STRUCTURED code only: the UI
   * localizes it into a display name (ADR-0008) — never a localized/human-
   * readable label here.
   */
  declare botDifficulty: string;
}

defineTypes(SeatSchema, {
  playerId: 'string',
  seatIndex: 'number',
  connected: 'boolean',
  consecutiveMisses: 'number',
  idle: 'boolean',
  isBot: 'boolean',
  botDifficulty: 'string',
});

/** The room's public lobby/late-join projection — see file header for the invariant this enforces. */
export class RoomSchema extends Schema {
  declare seedHash: string;
  declare phase: string;
  declare currentPlayerId: string;
  declare seats: ArraySchema<SeatSchema>;
  /**
   * The current turn's HARD deadline as an epoch-ms wall-clock timestamp
   * (S2.1.4), or `0` when no hard timer is armed (lobby/finished/setup). The
   * client renders `remaining = turnDeadline − Date.now()`. PRESENTATIONAL
   * PROJECTION ONLY: this lives in the Colyseus schema (like `phase` /
   * `currentPlayerId`), NEVER in the deterministic `GameState`, a `GameEvent`,
   * or the persisted log — that separation is what keeps the event log
   * timestamp-free and byte-replayable.
   */
  declare turnDeadline: number;
  /**
   * Epoch-ms wall-clock instant at which the client should start visibly warning
   * the acting player (`turnDeadline − softWarningMs`), or `0` when no timer is
   * armed. Presentational only — same non-`GameState`/non-log discipline as
   * {@link turnDeadline}.
   */
  declare turnSoftWarnAt: number;
}

defineTypes(RoomSchema, {
  seedHash: 'string',
  phase: 'string',
  currentPlayerId: 'string',
  seats: [SeatSchema],
  turnDeadline: 'number',
  turnSoftWarnAt: 'number',
});

/**
 * Builds a `RoomSchema` with its `seats` collection initialized —
 * `defineTypes()` doesn't auto-default collection fields the way the newer
 * `schema()` factory does, so the empty `ArraySchema` has to be set
 * explicitly once, here, rather than at every call site.
 */
export function createRoomSchema(props: {
  seedHash: string;
  phase: string;
  currentPlayerId: string;
}): RoomSchema {
  // No timer is armed in the lobby, so both presentational deadlines start at 0.
  const state = new RoomSchema().assign({ ...props, turnDeadline: 0, turnSoftWarnAt: 0 });
  state.seats = new ArraySchema<SeatSchema>();
  return state;
}
