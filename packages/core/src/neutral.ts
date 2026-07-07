// @skervik/core — deterministic neutral/phantom placement policy (S2.1.6).
//
// The 2-player mode places a handful of NEUTRAL blocking settlements at match
// genesis to force the two real players to spread and compete on the full
// 19-tile board (the "phantom on the standard board" mechanic, owner-decided
// 2026-07-07). Placement is a DETERMINISTIC function of the public board — NOT
// a seed draw — so it needs no PRNG slot and no fairness-verify change (the
// S2.1.4 discard-policy precedent): the highest-production vertices, tie-broken
// by canonical `VertexId`, skipping any vertex adjacent to an already-chosen
// neutral so the placement itself respects the distance rule. Recorded as
// `neutral.placed` genesis events so replay reconstructs the identical board.
//
// The neutral pieces block via the EXISTING distance rule (`validate.ts`) — a
// settlement already forbids building on or adjacent to its vertex, so blocking
// costs zero new adjacency code here. Pure + zero-dep (ADR-0003).

import {
  type BoardTopology,
  buildTopology,
  type VertexId,
  type VertexTopology,
} from './board.js';
import type { BoardState, NeutralPlacedEvent } from './types.js';

/**
 * Dice pips (relative probability weight) of a number token — the standard
 * "dots" a token bears: 6/8 → 5, …, 2/12 → 1. Returns 0 for a 7 (never a token)
 * or an absent token (a desert / off-board tile, which produces nothing).
 */
function tokenPips(token: number | undefined): number {
  if (token === undefined || token < 2 || token > 12 || token === 7) return 0;
  return 6 - Math.abs(7 - token);
}

/**
 * A vertex's production weight: the summed pips of its adjacent producing tiles
 * (desert / off-board contribute 0). The higher the weight, the more contested
 * the spot — exactly where a neutral blocker does the most to force the two real
 * players apart.
 */
function vertexProduction(
  vertex: VertexTopology,
  board: Pick<BoardState, 'tileTokens'>,
): number {
  return vertex.adjacentTileIds.reduce(
    (sum, tileId) => sum + tokenPips(board.tileTokens[tileId]),
    0,
  );
}

/**
 * Chooses `count` neutral-settlement vertices by a DETERMINISTIC board policy
 * (S2.1.6): the highest-production vertices, tie-broken by canonical `VertexId`
 * (ascending), skipping any vertex adjacent to an already-chosen neutral so the
 * placement respects the distance rule at placement time. Pure: same board →
 * same vertices, every time (no seed, no wall-clock, no ambient ordering — the
 * topology's vertex order is fixed). Returns fewer than `count` only if the
 * board somehow can't host that many distance-legal blockers (never on the
 * 19-tile board for the small v1 counts). A future setup forced-placement story
 * (the deferred S2.1.4 gap) can reuse this deterministic-legal-placement helper.
 */
export function computeNeutralPlacements(
  board: Pick<BoardState, 'tileTokens'>,
  count: number,
  topology: BoardTopology = buildTopology(),
): VertexId[] {
  const ranked = [...topology.vertices]
    .map((vertex) => ({ vertex, weight: vertexProduction(vertex, board) }))
    .sort((a, b) =>
      b.weight !== a.weight ? b.weight - a.weight : a.vertex.id < b.vertex.id ? -1 : 1,
    );

  const chosen: VertexId[] = [];
  for (const { vertex } of ranked) {
    if (chosen.length >= count) break;
    // Distance rule among neutrals: no two neutral settlements adjacent.
    if (vertex.adjacentVertexIds.some((id) => chosen.includes(id))) continue;
    chosen.push(vertex.id);
  }
  return chosen;
}

/**
 * Builds the `neutral.placed` genesis events (S2.1.6) for the chosen vertices,
 * indexed contiguously from `startIndex`. Emitted right after `board.generated`
 * (before the setup draft) by both the server's `#startMatch` and the 2p tests,
 * so replay/verify fold them at their true positions. Returns `[]` when
 * `count <= 0` (a non-`twoPlayer` profile), keeping Classic genesis unchanged.
 */
export function neutralPlacementEvents(
  board: Pick<BoardState, 'tileTokens'>,
  count: number,
  startIndex: number,
  topology: BoardTopology = buildTopology(),
): NeutralPlacedEvent[] {
  if (count <= 0) return [];
  return computeNeutralPlacements(board, count, topology).map((vertexId, i) => ({
    type: 'neutral.placed',
    index: startIndex + i,
    vertexId,
  }));
}
