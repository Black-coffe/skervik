// S1.7.2 Phase B — the deterministic scripted TEST driver (NOT a product bot;
// bots are M2). Given an authoritative `GameState` and a seat id, `decideAction`
// returns the single LEGAL intent that seat should send next, or `null` when it
// is not that seat's move. It is a pure function of state: fixed move priority,
// deterministic tie-breaks (topology / resource-name order), NO `Math.random` —
// determinism is the property the E2E asserts. The same function drives both the
// boot-free in-core simulation (fast seed/logic proof) and the real N-client
// socket run, so "what a client does" is authored exactly once.
//
// Termination is the caller's contract (a hard step cap): a greedy legal player
// that also bank-trades surplus into what it needs makes monotonic VP progress
// (resources only accumulate across turns; a turn's own actions strictly spend),
// so SOME seat reaches the Classic 10-VP threshold. The caller fails loudly with
// the stuck state if the cap is hit.
import {
  type BoardState,
  buildTopology,
  type EdgeId,
  findEdge,
  findVertex,
  type GameState,
  type PlayerId,
  type PlayerIntent,
  type PortContent,
  type ResourceType,
  type TileId,
  type VertexId,
} from '@skervik/core';

/** Built once — pure geometry, never changes for the fixed radius-2 board. */
const TOPO = buildTopology();

/** The five Classic resources, in a FIXED order (deterministic tie-breaks). */
const RESOURCES: readonly ResourceType[] = ['timber', 'clay', 'fleece', 'barley', 'iron'];

/** Classic build costs (mirror of `CLASSIC_BUILD_PROFILE.costs`, not imported to keep this test-local). */
const COST = {
  road: { timber: 1, clay: 1 } as Readonly<Record<ResourceType, number>>,
  settlement: {
    timber: 1,
    clay: 1,
    fleece: 1,
    barley: 1,
  } as Readonly<Record<ResourceType, number>>,
  city: { iron: 3, barley: 2 } as Readonly<Record<ResourceType, number>>,
} as const;

/** A soft per-player road ceiling so pure road-spam can't run away (well above longest-road). */
const ROAD_CAP = 10;

/** Classic per-player piece supply (mirror of `CLASSIC_BUILD_PROFILE.supply`) — skip a build the
 *  core would reject with SUPPLY_EXHAUSTED so the driver never emits an illegal intent. */
const BUILD_SUPPLY = { settlements: 5, cities: 4 } as const;

type Buildings = NonNullable<GameState['buildings']>;

const EMPTY_BUILDINGS: Buildings = { settlements: {}, roads: {} };

function buildingsOf(state: GameState): Buildings {
  return state.buildings ?? EMPTY_BUILDINGS;
}

function resourcesOf(state: GameState, playerId: PlayerId): Record<ResourceType, number> {
  const player = state.players.find((p) => p.id === playerId);
  return { ...(player?.resources ?? {}) };
}

function canAfford(
  resources: Readonly<Record<ResourceType, number>>,
  cost: Readonly<Record<ResourceType, number>>,
): boolean {
  return Object.entries(cost).every(
    ([resource, amount]) => (resources[resource] ?? 0) >= amount,
  );
}

/** A vertex holds a building (settlement OR city) of anyone. */
function vertexOccupied(b: Buildings, vertexId: VertexId): boolean {
  return b.settlements[vertexId] !== undefined || b.cities?.[vertexId] !== undefined;
}

/** Distance rule: no building on any vertex adjacent to `vertexId`. */
function distanceOk(b: Buildings, vertexId: VertexId): boolean {
  const vertex = findVertex(TOPO, vertexId);
  if (!vertex) return false;
  return !vertex.adjacentVertexIds.some((adj) => vertexOccupied(b, adj));
}

/** True if any edge incident to `vertexId` is `playerId`'s own road. */
function touchesOwnRoad(b: Buildings, playerId: PlayerId, vertexId: VertexId): boolean {
  const vertex = findVertex(TOPO, vertexId);
  if (!vertex) return false;
  return vertex.edgeIds.some((edgeId) => b.roads[edgeId] === playerId);
}

/** True if an OPPONENT building sits on `vertexId` (severs the network there, S1.3.4). */
function opponentBuildingAt(
  b: Buildings,
  playerId: PlayerId,
  vertexId: VertexId,
): boolean {
  const s = b.settlements[vertexId];
  if (s !== undefined && s !== playerId) return true;
  const c = b.cities?.[vertexId];
  return c !== undefined && c !== playerId;
}

/** Road-network legality (mirror of core `touchesOwnNetwork`, incl. the enemy-cut). */
function touchesOwnNetwork(b: Buildings, playerId: PlayerId, edgeId: EdgeId): boolean {
  const edge = findEdge(TOPO, edgeId);
  if (!edge) return false;
  return edge.vertexIds.some((vertexId) => {
    if (b.settlements[vertexId] === playerId) return true;
    if (b.cities?.[vertexId] === playerId) return true;
    if (opponentBuildingAt(b, playerId, vertexId)) return false;
    const vertex = findVertex(TOPO, vertexId);
    return vertex?.edgeIds.some((e) => b.roads[e] === playerId) ?? false;
  });
}

function countOwned(
  record: Readonly<Record<string, PlayerId>>,
  playerId: PlayerId,
): number {
  return Object.values(record).filter((owner) => owner === playerId).length;
}

// --- Port-aware bank rate (mirror of core `bestBankRate`) --------------------
// Must match core EXACTLY or a bank trade earns WRONG_RATE_COUNT — the driver's
// bank trades pass the same rate core will re-derive from the player's ports.
function ownedPortContents(
  board: BoardState,
  b: Buildings,
  playerId: PlayerId,
): PortContent[] {
  const owned: PortContent[] = [];
  TOPO.portSlots.forEach((slot, index) => {
    const edge = findEdge(TOPO, slot.edgeId);
    const ownsEndpoint =
      edge?.vertexIds.some(
        (vertexId) =>
          b.settlements[vertexId] === playerId || b.cities?.[vertexId] === playerId,
      ) ?? false;
    if (!ownsEndpoint) return;
    const content = board.portContents[index];
    if (content) owned.push(content);
  });
  return owned;
}

function bestBankRate(
  state: GameState,
  playerId: PlayerId,
  resource: ResourceType,
): number {
  const board = state.board;
  const b = state.buildings;
  if (!board || !b) return 4;
  const owned = ownedPortContents(board, b, playerId);
  if (owned.some((c) => c.kind === 'resource' && c.resource === resource)) return 2;
  if (owned.some((c) => c.kind === 'generic')) return 3;
  return 4;
}

// --- Placement search --------------------------------------------------------

/** First empty, distance-legal vertex (setup placement — no road-connection rule). */
function firstSetupVertex(b: Buildings): VertexId | null {
  for (const vertex of TOPO.vertices) {
    if (vertexOccupied(b, vertex.id)) continue;
    if (!distanceOk(b, vertex.id)) continue;
    return vertex.id;
  }
  return null;
}

/** First free edge incident to the pending settlement vertex (setup road). */
function firstSetupRoad(b: Buildings, pendingVertexId: VertexId): EdgeId | null {
  const vertex = findVertex(TOPO, pendingVertexId);
  if (!vertex) return null;
  for (const edgeId of vertex.edgeIds) {
    if (b.roads[edgeId] === undefined) return edgeId;
  }
  return null;
}

/** First empty, distance-legal, own-road-connected vertex (main-phase settlement). */
function firstBuildableSettlement(b: Buildings, playerId: PlayerId): VertexId | null {
  for (const vertex of TOPO.vertices) {
    if (vertexOccupied(b, vertex.id)) continue;
    if (!distanceOk(b, vertex.id)) continue;
    if (!touchesOwnRoad(b, playerId, vertex.id)) continue;
    return vertex.id;
  }
  return null;
}

/** An own settlement (not yet a city) to upgrade — first by topology order. */
function firstUpgradableSettlement(b: Buildings, playerId: PlayerId): VertexId | null {
  for (const vertex of TOPO.vertices) {
    if (b.settlements[vertex.id] === playerId) return vertex.id;
  }
  return null;
}

/** Is `vertexId` a legal future settlement site (empty + distance-legal)? */
function isOpenSettlementSite(b: Buildings, vertexId: VertexId): boolean {
  return !vertexOccupied(b, vertexId) && distanceOk(b, vertexId);
}

/**
 * A PURPOSEFUL network-extending road: one whose new (empty) endpoint either IS
 * an open settlement site (opens a spot directly) or is a stepping-stone one hop
 * from one (the far endpoint is itself adjacent to a setup/own building, so the
 * distance rule forbids building there — but a road beyond it reaches a legal
 * site). No blind "toward open water" fallback: every road spent must advance
 * toward a settlement, because timber/clay is the game's scarcest, deflationary
 * resource (builds destroy it permanently; ~19 total for the whole match) —
 * wasted roads starve expansion for ALL seats. Bounded by {@link ROAD_CAP}.
 * Prefers a spot-opening road (topology order) over a stepping-stone.
 */
function roadTowardSettlement(b: Buildings, playerId: PlayerId): EdgeId | null {
  if (countOwned(b.roads, playerId) >= ROAD_CAP) return null;
  let steppingStone: EdgeId | null = null;
  for (const edge of TOPO.edges) {
    if (b.roads[edge.id] !== undefined) continue;
    if (!touchesOwnNetwork(b, playerId, edge.id)) continue;
    for (const endpoint of edge.vertexIds) {
      if (vertexOccupied(b, endpoint)) continue;
      if (isOpenSettlementSite(b, endpoint)) {
        return edge.id; // opens a buildable vertex directly — best kind of road
      }
      // Stepping-stone: this empty endpoint is one hop from an open site.
      if (steppingStone === null) {
        const vertex = findVertex(TOPO, endpoint);
        const leadsSomewhere =
          vertex?.adjacentVertexIds.some((adj) => isOpenSettlementSite(b, adj)) ?? false;
        if (leadsSomewhere) steppingStone = edge.id;
      }
    }
  }
  return steppingStone;
}

// --- Bank-trade planning -----------------------------------------------------

/** The Classic finite bank pool per resource (mirror of CLASSIC_PRODUCTION_PROFILE). */
const BANK_PER_RESOURCE = 19;

/** The resources `cost` needs more of than `resources` holds, in fixed order. */
function shortfalls(
  resources: Readonly<Record<ResourceType, number>>,
  cost: Readonly<Record<ResourceType, number>>,
): ResourceType[] {
  return RESOURCES.filter((r) => (cost[r] ?? 0) > (resources[r] ?? 0));
}

/**
 * A bank trade that moves one step toward affording `cost`: for a still-needed
 * resource the BANK can actually supply, give a surplus resource (held ≥ its
 * rate and not itself short for `cost`) for 1 of it. `null` when no such trade
 * exists — the turn then ends. Skipping bank-exhausted `get` resources avoids a
 * BANK_EXHAUSTED reject; the finite pool is real (19 per resource).
 */
function bankTradeToward(
  state: GameState,
  playerId: PlayerId,
  cost: Readonly<Record<ResourceType, number>>,
): PlayerIntent | null {
  const resources = resourcesOf(state, playerId);
  for (const need of shortfalls(resources, cost)) {
    const bankHas = state.bank?.[need] ?? BANK_PER_RESOURCE;
    if (bankHas < 1) continue; // bank can't supply this one — try the next need
    // Give the resource with the most surplus over what `cost` still needs.
    let best: { give: ResourceType; rate: number; surplus: number } | null = null;
    for (const give of RESOURCES) {
      if (give === need) continue;
      const rate = bestBankRate(state, playerId, give);
      const held = resources[give] ?? 0;
      const keep = cost[give] ?? 0; // keep what this cost still needs
      const surplus = held - keep;
      if (held >= rate && surplus >= rate) {
        if (best === null || surplus > best.surplus) best = { give, rate, surplus };
      }
    }
    if (best !== null) {
      return {
        type: 'intent.bankTrade',
        playerId,
        give: best.give,
        count: best.rate,
        get: need,
      };
    }
  }
  return null;
}

// --- Robber / discard --------------------------------------------------------

/** Discard `required` cards, taken from the most-abundant resources first (deterministic). */
function planDiscard(
  resources: Readonly<Record<ResourceType, number>>,
  required: number,
): Record<ResourceType, number> {
  const remaining: Record<ResourceType, number> = { ...resources };
  const discard: Record<ResourceType, number> = {};
  let left = required;
  // Sort by (count desc, name asc) for a fixed order.
  const order = [...RESOURCES].sort(
    (a, z) => (remaining[z] ?? 0) - (remaining[a] ?? 0) || (a < z ? -1 : 1),
  );
  while (left > 0) {
    let took = false;
    for (const resource of order) {
      if (left === 0) break;
      if ((remaining[resource] ?? 0) > 0) {
        remaining[resource] = (remaining[resource] ?? 0) - 1;
        discard[resource] = (discard[resource] ?? 0) + 1;
        left -= 1;
        took = true;
      }
    }
    if (!took) break; // hand smaller than required (shouldn't happen) — bail safely
  }
  return discard;
}

/**
 * A legal robber relocation: the first tile that isn't the robber's current one,
 * naming a valid victim when that tile has an adjacent OPPONENT holding cards
 * (core requires a named victim then — an omitted one earns NO_SUCH_VICTIM),
 * else no steal. Deterministic (topology order + resource... first card-holder).
 */
function planRobberMove(
  state: GameState,
  playerId: PlayerId,
): { tileId: TileId; victimId?: PlayerId } | null {
  const board = state.board;
  if (!board) return null;
  const b = buildingsOf(state);
  for (const tile of TOPO.tiles) {
    if (tile.id === board.robberTileId) continue;
    // Opponents with a building adjacent to this tile who still hold >=1 card.
    const victims: PlayerId[] = [];
    for (const vertexId of tile.vertexIds) {
      const owner = b.cities?.[vertexId] ?? b.settlements[vertexId];
      if (owner === undefined || owner === playerId || victims.includes(owner)) continue;
      const hand = Object.values(resourcesOf(state, owner)).reduce((s, n) => s + n, 0);
      if (hand > 0) victims.push(owner);
    }
    const victimId = victims[0];
    return victimId !== undefined ? { tileId: tile.id, victimId } : { tileId: tile.id };
  }
  return null;
}

// --- The decision function ---------------------------------------------------

/**
 * The single legal intent `playerId` should send next given `state`, or `null`
 * if it is not this seat's move. Reactive: after the intent's events broadcast,
 * the caller re-invokes this on the new state, so multiple build actions in one
 * turn happen across successive broadcasts (one intent per call).
 */
export function decideAction(state: GameState, playerId: PlayerId): PlayerIntent | null {
  if (state.phase === 'finished' || state.phase === 'lobby') return null;

  const b = buildingsOf(state);

  // Post-7 robber resolution (any owing player discards; the mover then relocates).
  if (state.phase === 'robber') {
    const owing = state.playersToDiscard ?? [];
    if (owing.includes(playerId)) {
      const resources = resourcesOf(state, playerId);
      const required = Math.floor(
        Object.values(resources).reduce((s, n) => s + n, 0) / 2,
      );
      return {
        type: 'intent.discard',
        playerId,
        resources: planDiscard(resources, required),
      };
    }
    if (owing.length === 0 && state.currentPlayerId === playerId && state.board) {
      const move = planRobberMove(state, playerId);
      if (move !== null) {
        return {
          type: 'intent.moveRobber',
          playerId,
          tileId: move.tileId,
          ...(move.victimId !== undefined ? { victimId: move.victimId } : {}),
        };
      }
    }
    return null;
  }

  // A standing trade offer this seat is targeted by — decline (bank trades are
  // how the driver trades; it never opens p2p offers).
  if (state.openTradeOffer?.targets.includes(playerId)) {
    return { type: 'intent.rejectTrade', playerId };
  }

  // Snake-draft setup (only the current player acts).
  if (state.phase === 'setup') {
    if (state.currentPlayerId !== playerId) return null;
    if (state.pendingRoadVertexId !== undefined) {
      const edgeId = firstSetupRoad(b, state.pendingRoadVertexId);
      return edgeId ? { type: 'intent.placeRoad', playerId, edgeId } : null;
    }
    const vertexId = firstSetupVertex(b);
    return vertexId ? { type: 'intent.placeSettlement', playerId, vertexId } : null;
  }

  // The turn's mandatory first step.
  if (state.phase === 'roll') {
    if (state.currentPlayerId !== playerId) return null;
    return { type: 'intent.rollDice', playerId };
  }

  // Main phase: EXPANSION-first greedy. New settlements grow production, which
  // is the actual engine of VP progress — so the driver expands (settlement →
  // road-to-open-one) BEFORE hoarding ~20 raw resources for a single city, and
  // it bank-trades surplus toward the CHEAPEST reachable target (not always the
  // city) so every surplus turn converts into achievable progress. This makes
  // it provably terminate: production accumulates across turns while each turn's
  // own actions strictly spend, so a seat keeps adding settlements/cities until
  // it crosses the 10-VP threshold (an all-city hoard never grew the economy).
  if (state.phase === 'main') {
    if (state.currentPlayerId !== playerId) return null;
    const resources = resourcesOf(state, playerId);

    const settlementSupplyLeft =
      countOwned(b.settlements, playerId) < BUILD_SUPPLY.settlements;
    const citySupplyLeft = countOwned(b.cities ?? {}, playerId) < BUILD_SUPPLY.cities;

    // 1. Settlement — cheap (1 each of 4 resources), diverse, and every one adds
    //    production (the snowball). Built BEFORE cities so the economy grows.
    const settlementSpot = settlementSupplyLeft
      ? firstBuildableSettlement(b, playerId)
      : null;
    if (settlementSpot && canAfford(resources, COST.settlement)) {
      return { type: 'intent.buildSettlement', playerId, vertexId: settlementSpot };
    }

    // 2. Road toward a new settlement spot — when none is directly buildable yet.
    const roadEdge =
      settlementSpot === null && settlementSupplyLeft
        ? roadTowardSettlement(b, playerId)
        : null;
    if (roadEdge && canAfford(resources, COST.road)) {
      return { type: 'intent.buildRoad', playerId, edgeId: roadEdge };
    }

    // 3. City — opportunistic 2-VP upgrade (when affluent, or expansion is
    //    blocked). Helps close out to 10 but is never the sole hoard-target.
    const upgradable = citySupplyLeft ? firstUpgradableSettlement(b, playerId) : null;
    if (upgradable && canAfford(resources, COST.city)) {
      return { type: 'intent.buildCity', playerId, vertexId: upgradable };
    }

    // 4. Bank-trade toward the CHEAPEST reachable target so surplus converts into
    //    achievable progress: a directly-buildable settlement > a road that opens
    //    one > a city upgrade. `null` when nothing is reachable → the turn ends.
    const target =
      settlementSpot !== null
        ? COST.settlement
        : roadEdge !== null
          ? COST.road
          : upgradable !== null
            ? COST.city
            : null;
    if (target) {
      const trade = bankTradeToward(state, playerId, target);
      if (trade) return trade;
    }

    // 5. Nothing affordable/tradeable this turn — pass.
    return { type: 'intent.endTurn', playerId };
  }

  return null;
}
