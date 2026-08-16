// S2.1.7b-03 — the client's ONE per-match topology seam (plan Decision D2).
// Everything the client needs to know about board SHAPE for the active match
// funnels through here: `topologyForProfile` resolves a `RuleProfileId` to
// its `BoardTopology` via core's already-memoized `topologyForRadius`
// (`portSlotCount = board.ports.length`, ADR-0013 Invariant 2 — one source
// of truth, no client-side cache of our own), and `useMatchTopology()` reads
// the active match's `profileId` off the HUD store. Every consumer
// (`GameTable`, the four placement hooks, `devFixture`) calls this INSTEAD
// of caching its own module-level `buildTopology()` constant, so rendering,
// hit-testing and placement legality follow whatever board the match is
// actually on (radius 2 for Classic, radius 3 for the expanded 5–6 player
// board) rather than a hardcoded radius-2 assumption baked in at import time.

import type { BoardTopology, RuleProfileId } from '@skervik/core';
import { loadRuleProfile, topologyForRadius } from '@skervik/core';

import { selectProfileId, useUiStore } from '../hud/store.js';

/**
 * Resolves `profileId` to its `BoardTopology` — a thin wrapper over
 * `loadRuleProfile` + core's `topologyForRadius` memo. Referentially STABLE
 * across calls for the same profile (the memo, not a copy): calling this
 * twice with `'classic'` returns the exact same object.
 */
export function topologyForProfile(profileId: RuleProfileId): BoardTopology {
  const { board } = loadRuleProfile(profileId);
  return topologyForRadius(board.radius, board.ports.length);
}

/**
 * The active match's `BoardTopology`, derived from the HUD store's
 * `gameState.profileId` (set once by `match.started`, defaulting to
 * `'classic'` before a match starts — see `hud/store.ts`'s
 * `selectProfileId`). Every board-rendering/legality consumer calls this
 * hook instead of reading a module-level constant, so a match on the
 * `expanded` board renders/hit-tests/validates against the real 37-tile
 * shape rather than a stale Classic one.
 */
export function useMatchTopology(): BoardTopology {
  const profileId = useUiStore((state) => selectProfileId(state.gameState));
  return topologyForProfile(profileId);
}
