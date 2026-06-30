// @skervik/protocol — shared WS/REST message types.
// Message types and zod validation land in E1.5.
import type { PlayerId } from '@skervik/core';

export const PROTOCOL_VERSION = '0.0.1' as const;

/**
 * Type-only smoke re-export proving the @skervik/protocol -> @skervik/core
 * workspace + path-alias wiring resolves end-to-end (E0.2 review nit #3).
 * Real protocol message types land in E1.5.
 */
export type ProtocolPlayerId = PlayerId;
