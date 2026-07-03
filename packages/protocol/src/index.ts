// @skervik/protocol — shared WS/REST message types + zod runtime validation.
// Type-only envelope shapes (S1.4.1) + their zod schemas (S1.5.1): the server
// zod-parses inbound messages at the trust boundary before core `validate`.
import type { PlayerId } from '@skervik/core';

export const PROTOCOL_VERSION = '0.0.1' as const;

/**
 * Type-only smoke re-export proving the @skervik/protocol -> @skervik/core
 * workspace + path-alias wiring resolves end-to-end (E0.2 review nit #3).
 */
export type ProtocolPlayerId = PlayerId;

export type {
  ErrorMessage,
  EventBatchMessage,
  IntentMessage,
  PublicGameState,
  RejectMessage,
  StateSnapshotMessage,
  WsMessage,
} from './messages.js';
export {
  ClientMessageSchema,
  ErrorEnvelopeSchema,
  EventBatchEnvelopeSchema,
  GameEventSchema,
  IntentEnvelopeSchema,
  PlayerIntentSchema,
  PublicGameStateSchema,
  RejectEnvelopeSchema,
  ServerMessageSchema,
  StateSnapshotEnvelopeSchema,
} from './messages.js';
