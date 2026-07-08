// S2.4.1/S2.4.2 — the `Bot` seam: decision ≠ transport. A `Bot` is a pure
// decision module — it consumes the PUBLIC `GameState` + a seat id and proposes a
// `PlayerIntent`, exactly like "a client's brain without a socket" (see the
// story's architecture note). It holds NO authority: `decide` takes no seed, so a
// bot structurally cannot predict future dice/deck draws — only the server's
// `validate` (fed the real, server-secret seed) can do that.
//
// S2.4.2 swaps the brain behind this seam from v0 (frozen — the S1.7.2 E2E
// determinism driver) to the scored v1, adding a difficulty knob and the bot's
// OWN noise seed. `decide(state, playerId)` stays seed-free (the invariant): the
// chosen difficulty + the `BotRng` (over the bot's independent seed, NOT the
// match seed) are captured in the closure at construction, so a `Bot` still
// cannot be handed the match's secret seed.
import type { GameState, PlayerId, PlayerIntent, Seed } from '@skervik/core';

import type { Difficulty } from './eval/evaluate.js';
import { decideV1 } from './heuristic/v1.js';
import { BotRng } from './rng.js';

export interface Bot {
  /** Difficulty/label, e.g. 'v1-hard'. */
  readonly id: string;
  /** Pure function of the PUBLIC state — no seed, no side effects, no authority. */
  decide(state: GameState, playerId: PlayerId): PlayerIntent | null;
}

/**
 * How to construct a heuristic v1 bot. `difficulty` (default `'medium'`) selects
 * the feature set + selection noise; `seed` (default the fixed
 * {@link BotRng} constant) is the bot's OWN noise seed — NEVER the match seed, so
 * the bot stays seed-blind to the match while remaining fully deterministic.
 */
export interface BotOptions {
  readonly difficulty?: Difficulty;
  readonly seed?: Seed;
}

/**
 * Builds a heuristic **v1** bot behind the {@link Bot} seam (S2.4.2). `id` is
 * `v1-${difficulty}`; `decide` is the scored v1 brain with the difficulty +
 * an independent-seed `BotRng` captured in the closure — so `decide(state,
 * playerId)` keeps its exactly-2-parameter, match-seed-free signature.
 */
export function createHeuristicBot(opts: BotOptions = {}): Bot {
  const difficulty: Difficulty = opts.difficulty ?? 'medium';
  const rng = new BotRng(opts.seed);
  return {
    id: `v1-${difficulty}`,
    decide: (state, playerId) => decideV1(state, playerId, difficulty, rng),
  };
}
