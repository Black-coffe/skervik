// @skervik/server — the commit half of commit-reveal (ADR-0009 Fork 3,
// invariant #4). A match's raw PRNG seed is a server secret: generated here
// with Node crypto, held only in room memory + passed only to `validate`'s
// 4th arg, and hashed to the ONE public artifact — `seedHash` = sha256(seed)
// — that goes into `GameState.seedHash`. Extracted from `GameRoom` (folds the
// S1.4.1 review nit) so `sha256Hex` is a pure, independently-unit-tested fn:
// `GameState.seedHash === sha256Hex(seed)` is the commitment the S1.7.3 verify
// endpoint later checks against the revealed seed.
import { createHash, randomBytes } from 'node:crypto';

import type { Seed } from '@skervik/core';

/**
 * A fresh 32-byte cryptographic seed as a 64-char hex string — the match's
 * secret randomness source (ADR-0009 Fork 3). Uses Node's CSPRNG; never call
 * this in `@skervik/core`, which must stay pure/zero-dep (invariant #5).
 */
export function generateSeed(): Seed {
  return randomBytes(32).toString('hex');
}

/**
 * The public commitment for a seed: `SHA-256(seed)` as lowercase hex. Pure and
 * deterministic — the same seed always hashes to the same digest, so a verifier
 * given the revealed seed can recompute this and confirm it equals the
 * `seedHash` published at match start. This is the ONLY seed-derived value that
 * may ever be public.
 */
export function sha256Hex(seed: Seed): string {
  return createHash('sha256').update(seed).digest('hex');
}
