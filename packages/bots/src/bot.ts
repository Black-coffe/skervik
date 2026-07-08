// S2.4.1 — the `Bot` seam: decision ≠ transport. A `Bot` is a pure decision
// module — it consumes the PUBLIC `GameState` + a seat id and proposes a
// `PlayerIntent`, exactly like "a client's brain without a socket" (see the
// story's architecture note). It holds NO authority: `decide` takes no seed,
// so a bot structurally cannot predict future dice/deck draws — only the
// server's `validate` (fed the real, server-secret seed) can do that.
//
// This seam intentionally stays this thin. The owner's "shared board/action
// evaluation module" (so a scored bot and the M4 assist-mode advisor share one
// brain) belongs to S2.4.2, once difficulty knobs + real scoring exist — v0 is
// rule-based, not scored, so pre-abstracting evaluation here would be
// speculative (Law 2). S2.4.2 swaps the brain behind this seam; callers don't change.
import type { GameState, PlayerId, PlayerIntent } from '@skervik/core';

import { decideAction } from './heuristic/v0.js';

export interface Bot {
  /** Difficulty/label, e.g. 'v0'. */
  readonly id: string;
  /** Pure function of the PUBLIC state — no seed, no side effects, no authority. */
  decide(state: GameState, playerId: PlayerId): PlayerIntent | null;
}

/** Wraps the v0 heuristic brain ({@link decideAction}) behind the `Bot` seam. */
export function createHeuristicBot(): Bot {
  return {
    id: 'v0',
    decide: decideAction,
  };
}
