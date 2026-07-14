// S2.8.3b — pure ADVISORY legality hints for MAIN-phase building. Mirrors
// `validate.ts`'s `intent.buildRoad`/`intent.buildSettlement`/`intent.buildCity`
// branches (`validate.ts:1344-1454`) WITHOUT calling core `validate` — the
// client has no seed and is never the authority (see the story's Constraints).
// Consumed only to highlight legal targets + gate the build-type selector; a
// click is dispatched as-is regardless of membership here — the SERVER remains
// the sole gate. Distinct from `setupLegality.ts`: main-phase settlements
// REQUIRE road connectivity (`touchesOwnRoad`) which setup waives.
//
// The graph helpers (`touchesOwnNetwork`/`touchesOwnRoad`/`violatesDistanceRule`/
// `countOwned`/`canAffordCost`) are RE-DERIVED here — the core versions are
// private to `validate.ts` and deliberately NOT exported (keeps core's surface
// minimal; this mirror is advisory anyway). They are kept faithful to the cited
// `validate.ts` lines and unit-tested against hand-built states.

import type {
  BoardTopology,
  BuildingsState,
  EdgeId,
  EdgeTopology,
  GameState,
  PlayerId,
  ResourceType,
  VertexId,
  VertexTopology,
} from '@skervik/core';
import { CLASSIC_BUILD_PROFILE, findVertex } from '@skervik/core';

/**
 * The three buildable piece kinds. `CLASSIC_BUILD_PROFILE` is used as the cost/
 * supply source (not the active-profile resolution): Classic is the only
 * profile that reaches `main` today (see the story), so this keeps the mirror
 * simple without a `loadRuleProfile` round-trip.
 */
export type BuildType = 'settlement' | 'road' | 'city';

/** UI submode: no active build, or the piece kind whose board picking is armed. */
export type BuildMode = 'none' | BuildType;

const EMPTY_BUILDINGS: BuildingsState = { settlements: {}, roads: {} };

/** Mirrors `validate.ts`'s `canAfford` (`:735`): every cost line is covered by the hand. */
export function canAffordCost(
  resources: Readonly<Record<ResourceType, number>>,
  cost: Readonly<Record<ResourceType, number>>,
): boolean {
  return Object.entries(cost).every(
    ([resource, amount]) => (resources[resource] ?? 0) >= amount,
  );
}

/** Mirrors `validate.ts`'s `countOwned` (`:674`): this player's entries in a building record. */
function countOwned(
  record: Readonly<Record<string, PlayerId>> | undefined,
  playerId: PlayerId,
): number {
  if (!record) return 0;
  return Object.values(record).filter((owner) => owner === playerId).length;
}

/** Mirrors `validate.ts`'s `violatesDistanceRule` (`:166`): a settlement/city on any adjacent vertex. */
function violatesDistanceRule(
  vertex: VertexTopology,
  buildings: BuildingsState,
): boolean {
  return vertex.adjacentVertexIds.some(
    (adjacentId) =>
      buildings.settlements[adjacentId] !== undefined ||
      buildings.cities?.[adjacentId] !== undefined,
  );
}

/** Mirrors `validate.ts`'s `touchesOwnRoad` (`:665`): the vertex has an incident own road. */
function touchesOwnRoad(
  vertex: VertexTopology,
  playerId: PlayerId,
  buildings: BuildingsState,
): boolean {
  return vertex.edgeIds.some((edgeId) => buildings.roads[edgeId] === playerId);
}

/** Mirrors `validate.ts`'s `vertexHasOpponentBuilding` (`:186`). */
function vertexHasOpponentBuilding(
  vertexId: VertexId,
  playerId: PlayerId,
  buildings: BuildingsState,
): boolean {
  const settlementOwner = buildings.settlements[vertexId];
  if (settlementOwner !== undefined && settlementOwner !== playerId) return true;
  const cityOwner = buildings.cities?.[vertexId];
  if (cityOwner !== undefined && cityOwner !== playerId) return true;
  return false;
}

/**
 * Mirrors `validate.ts`'s `touchesOwnNetwork` (`:214`): the edge is incident to
 * a vertex carrying the player's own settlement/city, OR to a vertex touched by
 * one of the player's own roads — but an OPPONENT building on an endpoint severs
 * the network there (that endpoint offers no connection).
 */
function touchesOwnNetwork(
  edge: EdgeTopology,
  playerId: PlayerId,
  buildings: BuildingsState,
  topology: BoardTopology,
): boolean {
  return edge.vertexIds.some((vertexId) => {
    if (buildings.settlements[vertexId] === playerId) return true;
    if (buildings.cities?.[vertexId] === playerId) return true;
    if (vertexHasOpponentBuilding(vertexId, playerId, buildings)) return false;
    const vertex = findVertex(topology, vertexId);
    return (
      vertex?.edgeIds.some((edgeId) => buildings.roads[edgeId] === playerId) ?? false
    );
  });
}

/**
 * Vertices where `playerId` may build a settlement (`validate.ts:1377`): empty
 * (no settlement/city) · distance-rule-clear · connected to an own road · and
 * only while settlement supply remains (else the whole set is empty).
 */
export function legalBuildSettlements(
  state: GameState,
  topology: BoardTopology,
  playerId: PlayerId,
): readonly VertexId[] {
  const buildings = state.buildings ?? EMPTY_BUILDINGS;
  if (
    countOwned(buildings.settlements, playerId) >=
    CLASSIC_BUILD_PROFILE.supply.settlements
  ) {
    return [];
  }
  const isOccupied = (id: VertexId): boolean =>
    buildings.settlements[id] !== undefined || buildings.cities?.[id] !== undefined;

  return topology.vertices
    .filter(
      (vertex) =>
        !isOccupied(vertex.id) &&
        !violatesDistanceRule(vertex, buildings) &&
        touchesOwnRoad(vertex, playerId, buildings),
    )
    .map((vertex) => vertex.id);
}

/**
 * Edges where `playerId` may build a road (`validate.ts:1344`): empty · connected
 * to the player's own network · and only while road supply remains.
 */
export function legalBuildRoads(
  state: GameState,
  topology: BoardTopology,
  playerId: PlayerId,
): readonly EdgeId[] {
  const buildings = state.buildings ?? EMPTY_BUILDINGS;
  if (countOwned(buildings.roads, playerId) >= CLASSIC_BUILD_PROFILE.supply.roads) {
    return [];
  }
  return topology.edges
    .filter(
      (edge) =>
        buildings.roads[edge.id] === undefined &&
        touchesOwnNetwork(edge, playerId, buildings, topology),
    )
    .map((edge) => edge.id);
}

/**
 * Vertices where `playerId` may build a city (`validate.ts:1421`): a vertex
 * carrying one of the player's OWN settlements (upgraded/empty/enemy all read
 * illegal, since a city vertex is no longer a `settlements` key) · and only
 * while city supply remains.
 */
export function legalBuildCities(
  state: GameState,
  playerId: PlayerId,
): readonly VertexId[] {
  const buildings = state.buildings ?? EMPTY_BUILDINGS;
  if (countOwned(buildings.cities, playerId) >= CLASSIC_BUILD_PROFILE.supply.cities) {
    return [];
  }
  return Object.entries(buildings.settlements)
    .filter(([, owner]) => owner === playerId)
    .map(([vertexId]) => vertexId);
}

/** The Classic cost of a piece kind — for the type-selector's cost display + affordability gate. */
export function buildCost(type: BuildType): Readonly<Record<ResourceType, number>> {
  return CLASSIC_BUILD_PROFILE.costs[type];
}

/**
 * `true` when `playerId` could build `type` right now — affordable AND supply
 * remains. Advisory gate for the type selector's disabled state; the SERVER is
 * still authoritative (connectivity/occupancy are not checked here, they're
 * shown via the legal-target highlights instead).
 */
export function canBuildType(
  state: GameState,
  resources: Readonly<Record<ResourceType, number>>,
  playerId: PlayerId,
  type: BuildType,
): boolean {
  const buildings = state.buildings ?? EMPTY_BUILDINGS;
  const supplyLeft =
    type === 'road'
      ? countOwned(buildings.roads, playerId) < CLASSIC_BUILD_PROFILE.supply.roads
      : type === 'settlement'
        ? countOwned(buildings.settlements, playerId) <
          CLASSIC_BUILD_PROFILE.supply.settlements
        : countOwned(buildings.cities, playerId) < CLASSIC_BUILD_PROFILE.supply.cities;
  return supplyLeft && canAffordCost(resources, buildCost(type));
}
