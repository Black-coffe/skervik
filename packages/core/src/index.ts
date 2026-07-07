// @skervik/core — pure deterministic rule engine (zero runtime dependencies).
// ADR-0003: no Date.now(), no Math.random(), no I/O.
export const CORE_VERSION = '0.0.1' as const;

export type {
  AdaptiveAdjustment,
  AdaptiveDurationResult,
  AdaptiveWarningCode,
} from './adaptiveDuration.js';
export {
  ADAPTIVE_CEILING_MINUTES,
  ADAPTIVE_MAX_PLAYERS,
  ADAPTIVE_MIN_PLAYERS,
  ADAPTIVE_VP_FLOOR,
  computeAdaptiveDuration,
  estimateMatchMinutes,
} from './adaptiveDuration.js';
export {
  BALANCED_ROLL_DECK,
  drawBalancedRoll,
  ROLL_DECK_STREAM,
  shuffledRollDeck,
} from './balancedDeck.js';
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
export { computeNeutralPlacements, neutralPlacementEvents } from './neutral.js';
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
export type {
  BankTradeProfile,
  BoardProfile,
  BuildProfile,
  DevCardProfile,
  ProductionProfile,
  RobberProfile,
  RuleProfile,
  RuleProfileId,
  SetupProfile,
  TimerProfile,
  VictoryProfile,
} from './ruleProfile.js';
export {
  BALANCED_PROFILE,
  BLITZ_PROFILE,
  CLASSIC_PROFILE,
  loadRuleProfile,
  TWO_PLAYER_PROFILE,
} from './ruleProfile.js';
export type * from './types.js';
// `NEUTRAL_OWNER_ID` is a runtime VALUE (unlike the rest of `types.js`, which is
// type-only) — re-exported separately so `export type *` above stays type-only.
export { NEUTRAL_OWNER_ID } from './types.js';
export type { ValidateResult } from './validate.js';
export {
  CLASSIC_BANK_TRADE_PROFILE,
  CLASSIC_BUILD_PROFILE,
  CLASSIC_SETUP_PROFILE,
  CLASSIC_VICTORY_PROFILE,
  computePublicVictoryPoints,
  validate,
} from './validate.js';
export type { RandomnessMismatch, VerifyRandomnessResult } from './verify.js';
export { verifyMatchRandomness } from './verify.js';
