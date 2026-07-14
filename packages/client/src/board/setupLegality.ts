// S2.8.2 — pure ADVISORY legality hints for setup-phase placement. Mirrors
// `validate.ts`'s `intent.placeSettlement`/`intent.placeRoad` branches
// (`validate.ts:1264-1318`) WITHOUT calling core `validate` — the client has
// no seed and is never the authority (see the story's Constraints). Consumed
// only to highlight legal targets; a click is dispatched as-is regardless of
// whether it's in this set — the SERVER remains the sole gate.

import type { BoardTopology, EdgeId, GameState, VertexId } from '@skervik/core';

/**
 * Empty vertices satisfying the distance rule (`validate.ts`'s
 * `violatesDistanceRule`, `:166-175`): no settlement/city on the vertex
 * itself OR any of its `adjacentVertexIds`. Setup has no road-connection
 * requirement, unlike the S1.2.2 main-phase build branch.
 */
export function legalSetupSettlements(
  state: GameState,
  topology: BoardTopology,
): readonly VertexId[] {
  const settlements = state.buildings?.settlements ?? {};
  const cities = state.buildings?.cities ?? {};
  const isOccupied = (id: VertexId): boolean =>
    settlements[id] !== undefined || cities[id] !== undefined;

  return topology.vertices
    .filter(
      (vertex) => !isOccupied(vertex.id) && !vertex.adjacentVertexIds.some(isOccupied),
    )
    .map((vertex) => vertex.id);
}

/**
 * Empty edges incident to `pendingVertexId` (`validate.ts:1301-1318`): the
 * setup road must attach to the settlement just placed this draft turn, and
 * the edge itself must not already carry a road.
 */
export function legalSetupRoads(
  state: GameState,
  topology: BoardTopology,
  pendingVertexId: VertexId,
): readonly EdgeId[] {
  const roads = state.buildings?.roads ?? {};
  return topology.edges
    .filter(
      (edge) => roads[edge.id] === undefined && edge.vertexIds.includes(pendingVertexId),
    )
    .map((edge) => edge.id);
}
