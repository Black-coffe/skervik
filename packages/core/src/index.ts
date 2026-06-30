// @skervik/core — pure deterministic rule engine (zero runtime dependencies).
// ADR-0003: no Date.now(), no Math.random(), no I/O.
// reduce/validate land in S0.5.2.
export const CORE_VERSION = '0.0.1' as const;

export type * from './types.js';
