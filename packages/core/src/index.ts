// @skervik/core — pure deterministic rule engine (zero runtime dependencies).
// ADR-0003: no Date.now(), no Math.random(), no I/O.
export const CORE_VERSION = '0.0.1' as const;

export type {
  AxialCoord,
  BoardTopology,
  EdgeId,
  EdgeTopology,
  PortSlot,
  TileId,
  TileTopology,
  VertexId,
  VertexTopology,
} from './board.js';
export { buildTopology, findEdge, findTile, findVertex, tileId } from './board.js';
export type { BoardLayout } from './boardgen.js';
export { BOARD_GEN_STREAM, CLASSIC_BOARD_PROFILE, generateBoard } from './boardgen.js';
export {
  CLASSIC_DEV_CARD_PROFILE,
  DEV_DECK_STREAM,
  publicDevCardCount,
  shuffledDevDeck,
} from './devcards.js';
export { reduce, replay } from './reduce.js';
export { parseGameEventLog } from './replay.js';
export type { Seed } from './rng.js';
export {
  deriveValue,
  GAMEPLAY_STREAM_SLOTS,
  gameplayStreamIndex,
  rollDie,
  shuffle,
} from './rng.js';
export type * from './types.js';
export type { ValidateResult } from './validate.js';
export {
  CLASSIC_BANK_TRADE_PROFILE,
  CLASSIC_BUILD_PROFILE,
  CLASSIC_SETUP_PROFILE,
  CLASSIC_VICTORY_PROFILE,
  validate,
} from './validate.js';
