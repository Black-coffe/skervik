// @skervik/bots — AI bots consuming @skervik/core.
// S2.4.1: the v0 heuristic brain (moved from the S1.7.2 E2E scripted driver),
// the `Bot` seam (decision ≠ transport), and the in-process `simulateMatch`
// harness. Scoring/difficulty (S2.4.2) and server wiring (S2.4.3) land later.
export const BOTS_VERSION = '0.0.1' as const;

export { type Bot, createHeuristicBot } from './bot.js';
export { type SimResult, simulateMatch, type SimulateMatchOptions } from './harness.js';
export { decideAction } from './heuristic/v0.js';
