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
}

defineTypes(SeatSchema, {
  playerId: 'string',
  seatIndex: 'number',
  connected: 'boolean',
});

/** The room's public lobby/late-join projection — see file header for the invariant this enforces. */
export class RoomSchema extends Schema {
  declare seedHash: string;
  declare phase: string;
  declare currentPlayerId: string;
  declare seats: ArraySchema<SeatSchema>;
}

defineTypes(RoomSchema, {
  seedHash: 'string',
  phase: 'string',
  currentPlayerId: 'string',
  seats: [SeatSchema],
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
  const state = new RoomSchema().assign(props);
  state.seats = new ArraySchema<SeatSchema>();
  return state;
}
