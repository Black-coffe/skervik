// S2.4.2 — the shared, pure, reusable FEATURE extractors: the raw quantities a
// weighted-feature evaluator combines into a board/action score. This module is
// the deliverable the M4 E4.8 assist-mode advisor consumes too (owner directive
// 2026-07-07 — "bot and advisor share one brain; don't bury scoring in the
// decision loop"), so scoring lives HERE, out of `heuristic/v1.ts`'s decision
// loop. Every function is pure over `(state, ...)` — no wall-clock, no RNG, no
// side effects — so a score is reproducible and machine-independent (ADR-0003).
//
// Feature values are deliberately UNWEIGHTED here (raw pips, raw diversity, raw
// port rate). `evaluate.ts` owns the WEIGHT profiles that turn features into a
// single comparable score; the per-difficulty knobs live there.
import {
  type BoardState,
  type BoardTopology,
  computePublicVictoryPoints,
  type EdgeId,
  findEdge,
  findTile,
  findVertex,
  type GameState,
  isTrailing,
  loadRuleProfile,
  type PlayerId,
  type PortContent,
  type ResourceType,
  type TileId,
  topologyForRadius,
  type VertexId,
} from '@skervik/core';

/**
 * This match's board topology, resolved per call from its active rule profile
 * (`state.profileId ?? 'classic'`) rather than assumed fixed at radius 2 —
 * core's per-radius memo (`topologyForRadius`) makes repeated calls free, so
 * every geometry lookup below stays correct on ANY board size (mirrors v0).
 */
export function topologyOf(state: GameState): BoardTopology {
  const { board } = loadRuleProfile(state.profileId ?? 'classic');
  return topologyForRadius(board.radius, board.ports.length);
}

/** The five Classic resources, in a FIXED order (deterministic tie-breaks; mirrors v0). */
export const RESOURCES: readonly ResourceType[] = [
  'timber',
  'clay',
  'fleece',
  'barley',
  'iron',
];

/** The engine's own buildings shape; `undefined` before the first placement. */
export type Buildings = NonNullable<GameState['buildings']>;

const EMPTY_BUILDINGS: Buildings = { settlements: {}, roads: {} };

/** The match's buildings, or an empty stand-in (pre-setup states). */
export function buildingsOf(state: GameState): Buildings {
  return state.buildings ?? EMPTY_BUILDINGS;
}

/**
 * The 2d6 frequency "pip" of a number token: how many of the 36 equiprobable
 * two-die outcomes land on it (`6 − |7 − token|`). 6 & 8 are the richest
 * producers (5 pips), 2 & 12 the poorest (1 pip); a DESERT tile has no token
 * (`undefined`) and produces nothing (0). Core exposes no pip helper (it doesn't
 * need one — production is a fact carried on events, never re-derived), so this
 * table is owned here. The academic `7 → 6` case never occurs on a real board (a
 * production tile is never numbered 7), but the closed-form keeps the table
 * total: it's the honest 2d6 distribution.
 */
export function pipWeight(token: number | undefined): number {
  if (token === undefined) return 0;
  const pips = 6 - Math.abs(7 - token);
  return pips > 0 ? pips : 0;
}

/**
 * A vertex's raw PRODUCTION worth: Σ of `pipWeight(token)` over its adjacent
 * on-board tiles (a settlement earns once per producing neighbor, a city twice —
 * the caller applies the city multiplier). Desert neighbors contribute 0. This
 * is the single biggest driver of long-run VP, so it dominates spot selection —
 * and picking HIGH-pip spots (vs v0's first-buildable topology order) is what
 * makes v1 seed-robust where v0 stalled: the economy actually grows enough to
 * reach the VP threshold on more boards.
 */
export function vertexProductionValue(state: GameState, vertexId: VertexId): number {
  const vertex = findVertex(topologyOf(state), vertexId);
  const board = state.board;
  if (!vertex || !board) return 0;
  let total = 0;
  for (const tileId of vertex.adjacentTileIds) {
    total += pipWeight(board.tileTokens[tileId]);
  }
  return total;
}

/**
 * The count of DISTINCT producing resource kinds among a vertex's adjacent tiles
 * (0–3). A diverse spot (e.g. timber+clay+fleece) is worth more than three tiles
 * of one resource: it feeds more build recipes without trading. Desert neighbors
 * don't count.
 */
export function vertexResourceDiversity(state: GameState, vertexId: VertexId): number {
  const vertex = findVertex(topologyOf(state), vertexId);
  const board = state.board;
  if (!vertex || !board) return 0;
  const kinds = new Set<ResourceType>();
  for (const tileId of vertex.adjacentTileIds) {
    const kind = board.tileKinds[tileId];
    if (kind !== undefined && kind !== 'desert') kinds.add(kind);
  }
  return kinds.size;
}

/**
 * The best trade rate a port at `vertexId` would grant, as a raw feature: `2`
 * for a specific 2:1 resource port, `1` for a generic 3:1 port, `0` if the
 * vertex touches no port slot. (Higher = better; the weight profile decides how
 * much a port is worth relative to production.) Reuses the fixed `portSlots`
 * geometry — a slot's `edgeId` endpoints are its two port vertices.
 */
export function vertexPortValue(state: GameState, vertexId: VertexId): number {
  const board = state.board;
  if (!board) return 0;
  let best = 0;
  const topology = topologyOf(state);
  topology.portSlots.forEach((slot, index) => {
    const edge = findEdge(topology, slot.edgeId);
    if (!edge?.vertexIds.includes(vertexId)) return;
    const content = board.portContents[index];
    if (!content) return;
    const value = content.kind === 'resource' ? 2 : 1;
    if (value > best) best = value;
  });
  return best;
}

/**
 * The port contents a player owns (a settlement/city sits on a port slot's
 * endpoint) — the shared extraction of v0's module-local `ownedPortContents`
 * (v0 stays frozen; this is the reusable copy the eval + `bestBankRate` read).
 * Order follows `portSlots`, so it's deterministic. `topology` is threaded in
 * (rather than resolved here) because this function only receives a
 * `BoardState`/`Buildings` pair, not the full `GameState` a per-call
 * `topologyOf` resolution needs — callers with `state` pass `topologyOf(state)`.
 */
export function portsOwnedBy(
  topology: BoardTopology,
  board: BoardState,
  b: Buildings,
  playerId: PlayerId,
): PortContent[] {
  const owned: PortContent[] = [];
  topology.portSlots.forEach((slot, index) => {
    const edge = findEdge(topology, slot.edgeId);
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

/**
 * A player's best bank rate for `resource` — 2:1 with a matching resource port,
 * 3:1 with any generic port, else the profile's base rate (4:1 on every shipping
 * preset). Must equal core's `bestBankRate` EXACTLY or a proposed bank trade
 * earns `WRONG_RATE_COUNT`; profile-aware (reads `bankTrade.baseRate` from
 * `loadRuleProfile(state.profileId)`) precisely so it stays in lock-step across
 * all presets, never hardcoding Classic.
 */
export function bestBankRate(
  state: GameState,
  playerId: PlayerId,
  resource: ResourceType,
): number {
  const board = state.board;
  const b = state.buildings;
  if (!board || !b)
    return loadRuleProfile(state.profileId ?? 'classic').bankTrade.baseRate;
  const owned = portsOwnedBy(topologyOf(state), board, b, playerId);
  if (owned.some((c) => c.kind === 'resource' && c.resource === resource)) return 2;
  if (owned.some((c) => c.kind === 'generic')) return 3;
  return loadRuleProfile(state.profileId ?? 'classic').bankTrade.baseRate;
}

/**
 * A player's proximity to the win threshold, as PUBLIC VP (dev-card/hidden VP
 * deliberately excluded — the bot never reads hidden state, mirroring the
 * catch-up gates). Used both to prioritize the leader as a robber target and,
 * later, as an urgency term the advisor can surface. Reuses core's
 * `computePublicVictoryPoints` so it tracks awards/cities exactly.
 */
export function vpProximity(state: GameState, playerId: PlayerId): number {
  return computePublicVictoryPoints(state, playerId);
}

/**
 * S2.4.4 — the discounted bank-trade rate a TRAILING player holding a poverty
 * token may use for `give`, or `null` when no discounted trade is worth
 * proposing (the caller should fall back to {@link bestBankRate}). Mirrors
 * `validate.ts`'s discount legality EXACTLY (`profile.catchUp.robinHood &&
 * intent.count === robinHoodExchangeRate && povertyTokens>=1 &&
 * isTrailing`), plus one thing a PROPOSER must check that a legality gate
 * does not: the discount is only worth spending a token on when it is
 * STRICTLY CHEAPER than the rate the player already has for free — a 2:1
 * port beats a 2:1 `robinHoodExchangeRate` at no cost, and G3/S2.2.6 only
 * guarantees `robinHoodExchangeRate < bankTrade.baseRate`, never anything
 * about a port rate. A token is finite and capped
 * (`catchUp.robinHoodTokenCap`), so v1 spends it GREEDILY whenever it is
 * legal and strictly cheaper — a hoarding heuristic is a speculative
 * optimisation this story deliberately does not build.
 *
 * Lives in `eval/`, not `heuristic/v1.ts`'s decision loop, so the M4
 * assist-mode advisor can consume the SAME evaluation to hint "you can trade
 * at X:1 right now" (owner directive 2026-07-07 — bot and advisor share one
 * brain).
 */
export function povertyDiscountRate(
  state: GameState,
  playerId: PlayerId,
  give: ResourceType,
): number | null {
  const profile = loadRuleProfile(state.profileId ?? 'classic');
  if (!profile.catchUp.robinHood) return null;
  if ((state.povertyTokens?.[playerId] ?? 0) < 1) return null;
  const discountRate = profile.catchUp.robinHoodExchangeRate;
  if (discountRate >= bestBankRate(state, playerId, give)) return null;
  if (!isTrailing(state, playerId)) return null;
  return discountRate;
}

// --- Shared board-geometry legality (mirrors the FROZEN v0 helpers) ----------
// v0 keeps its own module-local copies (it stays byte-frozen for the S1.7.2 E2E
// gate); these are the reusable copies the eval + v1 candidate generation read,
// so both the bot brain and the M4 advisor test move-legality from ONE place.

/** A vertex holds a building (settlement OR city) of anyone. */
export function vertexOccupied(b: Buildings, vertexId: VertexId): boolean {
  return b.settlements[vertexId] !== undefined || b.cities?.[vertexId] !== undefined;
}

/** Distance rule: no building on any vertex adjacent to `vertexId`. */
export function distanceOk(
  topology: BoardTopology,
  b: Buildings,
  vertexId: VertexId,
): boolean {
  const vertex = findVertex(topology, vertexId);
  if (!vertex) return false;
  return !vertex.adjacentVertexIds.some((adj) => vertexOccupied(b, adj));
}

/** True if any edge incident to `vertexId` is `playerId`'s own road. */
export function touchesOwnRoad(
  topology: BoardTopology,
  b: Buildings,
  playerId: PlayerId,
  vertexId: VertexId,
): boolean {
  const vertex = findVertex(topology, vertexId);
  if (!vertex) return false;
  return vertex.edgeIds.some((edgeId) => b.roads[edgeId] === playerId);
}

/** True if an OPPONENT building sits on `vertexId` (severs the network there, S1.3.4). */
export function opponentBuildingAt(
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
export function touchesOwnNetwork(
  topology: BoardTopology,
  b: Buildings,
  playerId: PlayerId,
  edgeId: EdgeId,
): boolean {
  const edge = findEdge(topology, edgeId);
  if (!edge) return false;
  return edge.vertexIds.some((vertexId) => {
    if (b.settlements[vertexId] === playerId) return true;
    if (b.cities?.[vertexId] === playerId) return true;
    if (opponentBuildingAt(b, playerId, vertexId)) return false;
    const vertex = findVertex(topology, vertexId);
    return vertex?.edgeIds.some((e) => b.roads[e] === playerId) ?? false;
  });
}

/** Is `vertexId` a legal FUTURE settlement site (empty + distance-legal)? */
export function isOpenSettlementSite(
  topology: BoardTopology,
  b: Buildings,
  vertexId: VertexId,
): boolean {
  return !vertexOccupied(b, vertexId) && distanceOk(topology, b, vertexId);
}

/** Count of records owned by `playerId` (settlements/roads/cities). */
export function countOwned(
  record: Readonly<Record<string, PlayerId>>,
  playerId: PlayerId,
): number {
  return Object.values(record).filter((owner) => owner === playerId).length;
}

/**
 * How much placing the robber on `tileId` HURTS opponents: Σ over the tile's
 * vertices of `pipWeight(token)` for each OPPONENT building there (a city counts
 * double — it draws two cards per roll). Higher = a more disruptive block. The
 * acting player's own buildings never count (you don't rob yourself).
 */
export function blockingValue(
  state: GameState,
  playerId: PlayerId,
  tileId: TileId,
): number {
  const board = state.board;
  const tile = findTile(topologyOf(state), tileId);
  if (!board || !tile) return 0;
  const b = buildingsOf(state);
  const pip = pipWeight(board.tileTokens[tileId]);
  if (pip === 0) return 0;
  let value = 0;
  for (const vertexId of tile.vertexIds) {
    const cityOwner = b.cities?.[vertexId];
    if (cityOwner !== undefined && cityOwner !== playerId) {
      value += pip * 2;
      continue;
    }
    const settler = b.settlements[vertexId];
    if (settler !== undefined && settler !== playerId) value += pip;
  }
  return value;
}
