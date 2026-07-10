// @skervik/protocol — shared WS/REST message types + zod runtime validation.
// Type-only envelope shapes (S1.4.1) + their zod schemas (S1.5.1): the server
// zod-parses inbound messages at the trust boundary before core `validate`.
import type { PlayerId } from '@skervik/core';

export const PROTOCOL_VERSION = '0.0.1' as const;

/**
 * The matchmaking name the server registers the `GameRoom` under and the client
 * passes to `joinOrCreate` (S1.6.5). Single-sourced HERE because the room name
 * is part of the wire contract: hoisting it out of `@skervik/server` lets the
 * client join by name without depending on the server package, and kills the
 * magic-string drift risk of each side declaring its own copy. `@skervik/server`
 * re-exports this so its existing `GAME_ROOM_NAME` consumers keep working.
 */
export const GAME_ROOM_NAME = 'skervik_game';

/**
 * The ONE protocol-version compatibility gate (S1.5.2). Exact-string equality
 * with {@link PROTOCOL_VERSION}: a missing / non-string / mismatched client
 * version is INCOMPATIBLE (rejected at join), never treated as legacy-allowed.
 * The `unknown` parameter makes the helper self-guarding — a non-string value
 * (e.g. `undefined` from absent join options) short-circuits to `false` here
 * rather than at each call site. M2 loosens this rule (e.g. semver-major match)
 * by editing THIS function only; never scatter the comparison elsewhere.
 */
export function isCompatibleProtocolVersion(clientVersion: unknown): boolean {
  return typeof clientVersion === 'string' && clientVersion === PROTOCOL_VERSION;
}

/**
 * Type-only smoke re-export proving the @skervik/protocol -> @skervik/core
 * workspace + path-alias wiring resolves end-to-end (E0.2 review nit #3).
 */
export type ProtocolPlayerId = PlayerId;

export type {
  ConnectOptions,
  ErrorMessage,
  EventBatchMessage,
  IntentMessage,
  JoinLobbySelection,
  PublicGameState,
  RejectMessage,
  StateSnapshotMessage,
  VersionErrorMessage,
  WsMessage,
} from './messages.js';
export {
  ClientMessageSchema,
  ConnectOptionsSchema,
  ErrorEnvelopeSchema,
  EventBatchEnvelopeSchema,
  GameEventSchema,
  IntentEnvelopeSchema,
  JoinLobbySelectionSchema,
  PlayerIntentSchema,
  PublicGameStateSchema,
  RejectEnvelopeSchema,
  ServerMessageSchema,
  StateSnapshotEnvelopeSchema,
  VersionErrorEnvelopeSchema,
} from './messages.js';
