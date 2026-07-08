// @skervik/bots — AI bots consuming @skervik/core.
// S2.4.1: the v0 heuristic brain (moved from the S1.7.2 E2E scripted driver),
// the `Bot` seam (decision ≠ transport), and the in-process `simulateMatch`
// harness. S2.4.2: the scored v1 brain over a shared, reusable weighted-feature
// EVALUATION module (`eval/`) at ×3 difficulty — the eval public surface is
// exported for the M4 E4.8 assist-mode advisor. Server wiring (S2.4.3) lands later.
export const BOTS_VERSION = '0.0.1' as const;

export { type Bot, type BotOptions, createHeuristicBot } from './bot.js';
// The shared evaluation module — the M4 advisor's entry point.
export {
  type Difficulty,
  evaluateAction,
  evaluateVertex,
  FEATURE_WEIGHTS,
  type ScoredEval,
  TARGET_PRODUCTION_SPOTS,
  type Weights,
} from './eval/evaluate.js';
export {
  bestBankRate,
  blockingValue,
  pipWeight,
  portsOwnedBy,
  vertexPortValue,
  vertexProductionValue,
  vertexResourceDiversity,
  vpProximity,
} from './eval/features.js';
export { type SimResult, simulateMatch, type SimulateMatchOptions } from './harness.js';
// v0 stays exported UNCHANGED — the S1.7.2 server E2E imports it via the server shim.
export { decideAction } from './heuristic/v0.js';
export { decideV1 } from './heuristic/v1.js';
export { BotRng, DEFAULT_BOT_SEED } from './rng.js';
