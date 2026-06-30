// @skervik/core — pure deterministic rule engine (zero runtime dependencies).
// ADR-0003: no Date.now(), no Math.random(), no I/O.
export const CORE_VERSION = '0.0.1' as const;

export { reduce, replay } from './reduce.js';
export type { Seed } from './rng.js';
export { deriveValue, rollDie, shuffle } from './rng.js';
export type * from './types.js';
export type { ValidateResult } from './validate.js';
export { validate } from './validate.js';
