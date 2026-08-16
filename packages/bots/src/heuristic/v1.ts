// S2.4.2 — the heuristic bot v1 brain: a SCORED phase dispatcher over the shared
// evaluation module (`../eval/`), at ×3 difficulty. Where v0 (frozen) applies a
// fixed hardcoded move priority, v1 GENERATES a candidate set, scores each move
// through `evaluateVertex`/`evaluateAction` (one scorer, reused everywhere
// strategy lives), and picks via `selectByDifficulty` — argmax on `hard`, small
// noise on `medium`, top-K noise on `easy`. Noise draws come from the bot's OWN
// `BotRng` (an independent bot seed), never the match seed, so the bot stays
// seed-BLIND to the match (authoritative-server invariant) while tests stay
// deterministic.
//
// Seed-robustness (the story's point — fixes the v0 stall): the main candidate
// set ALWAYS includes `endTurn` (never empty), roads are only generated TOWARD an
// open settlement site (never a dead-end that wastes scarce timber/clay), a
// bank-trade-toward-the-cheapest-reachable-target candidate lets a build-blocked
// bot convert surplus, and — for a resource-rich bot that has used every
// settlement/city slot (a board/supply LOCK at ≤9 VP) — a `buyDevCard` +
// knight-play path gives a board-INDEPENDENT VP route to 10 (VP cards + largest
// army). Higher-pip spot selection grows the economy faster than v0's
// first-buildable. Proven by the harness seed-sweep (`../harness.test.ts`).
//
// This became robust only once the S2.4.2a core fix (`8129962`) made the finite
// bank CONSERVE — it now refunds spent/discarded resources (physical-Catan
// parity), so production no longer freezes mid-match. Before that fix a long
// self-play match drained the ~95-resource pool to zero and every greedy bot
// (incl. v0) stalled — the true root of [[v0-seed-fragility-carryforward]].
//
// Profile-aware, never Classic-hardcoded: costs/supply/bank/robber knobs come
// from `loadRuleProfile(state.profileId)`, and robber victims respect
// `isStealable` (the S2.2.1 friendlyRobber gate) — so v1 plays correctly under
// every preset.
import {
  type BoardTopology,
  computePublicVictoryPoints,
  type EdgeId,
  findVertex,
  type GameState,
  isStealable,
  loadRuleProfile,
  NEUTRAL_OWNER_ID,
  type PlayerId,
  type PlayerIntent,
  type ResourceType,
  type RobberProfile,
  type VertexId,
} from '@skervik/core';

import {
  type Difficulty,
  evaluateAction,
  evaluateVertex,
  FEATURE_WEIGHTS,
  type Weights,
} from '../eval/evaluate.js';
import {
  bestBankRate,
  blockingValue,
  type Buildings,
  buildingsOf,
  countOwned,
  distanceOk,
  isOpenSettlementSite,
  povertyDiscountRate,
  RESOURCES,
  topologyOf,
  touchesOwnNetwork,
  touchesOwnRoad,
  vertexOccupied,
} from '../eval/features.js';
import type { BotRng } from '../rng.js';

/** Probability `medium` explores the runner-up instead of the argmax (small selection noise). */
const MEDIUM_EXPLORE_PROB = 0.25;

/** How many top candidates `easy` picks uniformly among (large selection noise). */
const EASY_TOP_K = 3;

/**
 * A soft per-player road ceiling (mirrors v0) — a belt-and-suspenders bound on
 * top of the roads-toward-open-settlement rule so pure road-spam can't run away.
 */
const ROAD_SOFT_CAP = 10;

// --- Small local resource helpers (mirror v0's private ones) -----------------

function resourcesOf(state: GameState, playerId: PlayerId): Record<ResourceType, number> {
  const player = state.players.find((p) => p.id === playerId);
  return { ...(player?.resources ?? {}) };
}

function handSize(resources: Readonly<Record<ResourceType, number>>): number {
  return Object.values(resources).reduce((sum, n) => sum + n, 0);
}

function canAfford(
  resources: Readonly<Record<ResourceType, number>>,
  cost: Readonly<Record<ResourceType, number>>,
): boolean {
  return Object.entries(cost).every(
    ([resource, amount]) => (resources[resource] ?? 0) >= amount,
  );
}

/** The resources `cost` needs more of than `resources` holds, in fixed order (mirror v0). */
function shortfalls(
  resources: Readonly<Record<ResourceType, number>>,
  cost: Readonly<Record<ResourceType, number>>,
): ResourceType[] {
  return RESOURCES.filter((r) => (cost[r] ?? 0) > (resources[r] ?? 0));
}

// --- Difficulty selection ----------------------------------------------------

/** A scored candidate: the concrete item, its score, and a stable deterministic tie-break key. */
interface Scored<T> {
  readonly item: T;
  readonly score: number;
  readonly key: string;
}

/**
 * Picks among scored candidates per difficulty:
 * - **hard** — the argmax (deterministic; ties broken by the stable `key`, NEVER
 *   the rng — a hard bot never draws, so it's byte-reproducible without a seed).
 * - **medium** — usually the argmax, occasionally the runner-up (one small rng draw).
 * - **easy** — a uniform pick from the top-K (large rng noise).
 *
 * medium/easy restrict the noise to POSITIVE-scoring candidates when any exist,
 * so a weaker bot still always makes progress (it only ever "passes" — picks the
 * 0-score `endTurn` — when nothing productive is on offer). This is a load-
 * bearing part of the seed-robustness guarantee.
 */
function selectByDifficulty<T>(
  scored: readonly Scored<T>[],
  difficulty: Difficulty,
  rng: BotRng,
): T {
  const sorted = [...scored].sort(
    (a, z) => z.score - a.score || (a.key < z.key ? -1 : a.key > z.key ? 1 : 0),
  );
  const best = sorted[0];
  if (best === undefined) {
    throw new Error(
      'selectByDifficulty: empty candidate set (a brain bug — always include endTurn)',
    );
  }
  if (difficulty === 'hard') return best.item;

  const positive = sorted.filter((s) => s.score > 0);
  const band = positive.length > 0 ? positive : sorted;

  if (difficulty === 'medium') {
    const runnerUp = band[1];
    if (runnerUp !== undefined && rng.next() < MEDIUM_EXPLORE_PROB) return runnerUp.item;
    return band[0]?.item ?? best.item;
  }

  // easy
  const k = Math.min(EASY_TOP_K, band.length);
  return rng.pick(band.slice(0, k)).item;
}

/** A stable tie-break key for an intent (deterministic across runs/machines). */
function actionKey(action: PlayerIntent): string {
  switch (action.type) {
    case 'intent.buildSettlement':
    case 'intent.buildCity':
      return `${action.type}:${action.vertexId}`;
    case 'intent.buildRoad':
      return `${action.type}:${action.edgeId}`;
    case 'intent.bankTrade':
      return `${action.type}:${action.give}>${action.get}:${action.count}`;
    case 'intent.moveRobber':
      return `${action.type}:${action.tileId}:${action.victimId ?? ''}`;
    default:
      return action.type;
  }
}

/** Wraps intent candidates with their evaluation score + key for {@link selectByDifficulty}. */
function scoreActions(
  state: GameState,
  playerId: PlayerId,
  actions: readonly PlayerIntent[],
  weights: Weights,
): Scored<PlayerIntent>[] {
  return actions.map((action) => ({
    item: action,
    score: evaluateAction(state, playerId, action, weights).score,
    key: actionKey(action),
  }));
}

// --- Setup-phase placement ---------------------------------------------------

/** First free edge incident to the pending settlement vertex (setup road, mirror v0). */
function firstSetupRoad(
  topology: BoardTopology,
  b: Buildings,
  pendingVertexId: VertexId,
): EdgeId | null {
  const vertex = findVertex(topology, pendingVertexId);
  if (!vertex) return null;
  for (const edgeId of vertex.edgeIds) {
    if (b.roads[edgeId] === undefined) return edgeId;
  }
  return null;
}

/** The scored setup settlement placement: every legal spot → `evaluateVertex` → select. */
function chooseSetupSettlement(
  state: GameState,
  playerId: PlayerId,
  b: Buildings,
  difficulty: Difficulty,
  rng: BotRng,
  weights: Weights,
): VertexId | null {
  const topology = topologyOf(state);
  const legal: Scored<VertexId>[] = [];
  for (const vertex of topology.vertices) {
    if (vertexOccupied(b, vertex.id)) continue;
    if (!distanceOk(topology, b, vertex.id)) continue;
    legal.push({
      item: vertex.id,
      score: evaluateVertex(state, playerId, vertex.id, weights).score,
      key: vertex.id,
    });
  }
  if (legal.length === 0) return null;
  return selectByDifficulty(legal, difficulty, rng);
}

// --- Main-phase candidate generation -----------------------------------------

/** Network-extending roads that OPEN or step toward an open settlement site (mirror v0's discipline). */
function purposefulRoads(
  topology: BoardTopology,
  b: Buildings,
  playerId: PlayerId,
  supplyRoads: number,
): EdgeId[] {
  const cap = Math.min(supplyRoads, ROAD_SOFT_CAP);
  if (countOwned(b.roads, playerId) >= cap) return [];
  const roads: EdgeId[] = [];
  for (const edge of topology.edges) {
    if (b.roads[edge.id] !== undefined) continue;
    if (!touchesOwnNetwork(topology, b, playerId, edge.id)) continue;
    const purposeful = edge.vertexIds.some((endpoint) => {
      if (vertexOccupied(b, endpoint)) return false;
      if (isOpenSettlementSite(topology, b, endpoint)) return true;
      const vertex = findVertex(topology, endpoint);
      return (
        vertex?.adjacentVertexIds.some((adj) => isOpenSettlementSite(topology, b, adj)) ??
        false
      );
    });
    if (purposeful) roads.push(edge.id);
  }
  return roads;
}

/**
 * A bank trade that moves one step toward affording `cost` (mirror of v0's
 * `bankTradeToward`, profile-aware): for a still-needed resource the bank can
 * supply, give the biggest surplus resource at its resolved rate — or, since
 * S2.4.4, the `robinHood` discounted rate when {@link povertyDiscountRate}
 * says one is legal and cheaper. `null` when no such trade exists.
 * Profile-aware bank pool (`production.bankPerResource`). Exported (rather
 * than module-local) so its behavior can be unit-tested directly, independent
 * of which candidate `mainCandidates` happens to score highest.
 */
export function bankTradeToward(
  state: GameState,
  playerId: PlayerId,
  cost: Readonly<Record<ResourceType, number>>,
  bankDefault: number,
): PlayerIntent | null {
  const resources = resourcesOf(state, playerId);
  for (const need of shortfalls(resources, cost)) {
    const bankHas = state.bank?.[need] ?? bankDefault;
    if (bankHas < 1) continue;
    let best: { give: ResourceType; rate: number; surplus: number } | null = null;
    for (const give of RESOURCES) {
      if (give === need) continue;
      const rate = bestBankRate(state, playerId, give);
      const held = resources[give] ?? 0;
      const keep = cost[give] ?? 0;
      const surplus = held - keep;
      if (held >= rate && surplus >= rate) {
        if (best === null || surplus > best.surplus) best = { give, rate, surplus };
      }
    }
    if (best !== null) {
      // S2.4.4: a TRAILING player holding a poverty token proposes the
      // discounted robinHood rate instead of its natural rate, whenever the
      // discount is actually cheaper (never worth a token for a rate the
      // player already has for free via a port) — see `povertyDiscountRate`'s
      // docstring. `null` on every shipping preset (robinHood:false), so this
      // is a no-op there — byte-identical to the pre-S2.4.4 proposal.
      const discountRate = povertyDiscountRate(state, playerId, best.give);
      return {
        type: 'intent.bankTrade',
        playerId,
        give: best.give,
        count: discountRate ?? best.rate,
        get: need,
      };
    }
  }
  return null;
}

/**
 * The full scored main-phase candidate set: buildable settlements, purposeful
 * roads, city upgrades, one bank-trade toward the cheapest reachable target, an
 * optional dev-card buy, and ALWAYS `endTurn`. Every entry is a LEGAL intent
 * (affordability + supply + connection checked here), so the mock-authority /
 * server never rejects one.
 */
function mainCandidates(state: GameState, playerId: PlayerId): PlayerIntent[] {
  const profile = loadRuleProfile(state.profileId ?? 'classic');
  const topology = topologyOf(state);
  const costs = profile.build.costs;
  const supply = profile.build.supply;
  const b = buildingsOf(state);
  const resources = resourcesOf(state, playerId);

  const candidates: PlayerIntent[] = [{ type: 'intent.endTurn', playerId }];

  // Buildable settlements (empty + distance-ok + own-road-connected + supply).
  const settlementSupplyLeft = countOwned(b.settlements, playerId) < supply.settlements;
  let hasBuildableSettlement = false;
  if (settlementSupplyLeft) {
    const affordable = canAfford(resources, costs.settlement);
    for (const vertex of topology.vertices) {
      if (vertexOccupied(b, vertex.id)) continue;
      if (!distanceOk(topology, b, vertex.id)) continue;
      if (!touchesOwnRoad(topology, b, playerId, vertex.id)) continue;
      hasBuildableSettlement = true;
      if (affordable) {
        candidates.push({
          type: 'intent.buildSettlement',
          playerId,
          vertexId: vertex.id,
        });
      }
    }
  }

  // Purposeful roads toward an open settlement site.
  const roads = settlementSupplyLeft
    ? purposefulRoads(topology, b, playerId, supply.roads)
    : [];
  if (canAfford(resources, costs.road)) {
    for (const edgeId of roads) {
      candidates.push({ type: 'intent.buildRoad', playerId, edgeId });
    }
  }

  // City upgrades (own settlements not yet cities).
  const citySupplyLeft = countOwned(b.cities ?? {}, playerId) < supply.cities;
  let hasUpgradable = false;
  if (citySupplyLeft) {
    const affordable = canAfford(resources, costs.city);
    for (const vertex of topology.vertices) {
      if (b.settlements[vertex.id] !== playerId) continue;
      hasUpgradable = true;
      if (affordable) {
        candidates.push({ type: 'intent.buildCity', playerId, vertexId: vertex.id });
      }
    }
  }

  // Bank-trade toward the cheapest reachable target (the anti-stall fallback):
  // a directly-buildable settlement > a road that opens one > a city upgrade.
  const target = hasBuildableSettlement
    ? costs.settlement
    : roads.length > 0
      ? costs.road
      : hasUpgradable
        ? costs.city
        : null;
  if (target) {
    const trade = bankTradeToward(
      state,
      playerId,
      target,
      profile.production.bankPerResource,
    );
    if (trade) candidates.push(trade);
  }

  // Board-independent VP (breaks the building-supply / board LOCK, S2.4.2 post-
  // bank-fix): a resource-rich bot with every settlement/city slot used sits at
  // ≤9 VP with an idle hand — dev cards are its only path to 10. Buying is now
  // safe (the S2.4.2a core credits the bank on spend, so no resource death
  // spiral). VP cards count toward the win directly; knights build largest army.
  const deckLeft = state.devDeckRemaining ?? profile.devCards.deck.length;
  if (deckLeft > 0 && canAfford(resources, profile.devCards.buyCost)) {
    candidates.push({ type: 'intent.buyDevCard', playerId });
  }

  // Play a held knight — largest army (+2 VP) + robber tempo, no board space needed.
  if (canPlayKnight(state, playerId)) {
    const knightTarget = bestRobberTarget(state, playerId, profile.robber);
    if (knightTarget) {
      candidates.push({
        type: 'intent.playDevCard',
        playerId,
        card: 'knight',
        tileId: knightTarget.tileId,
        ...(knightTarget.victimId !== undefined
          ? { victimId: knightTarget.victimId }
          : {}),
      });
    }
  }

  return candidates;
}

// --- Robber phase ------------------------------------------------------------

/** Discard `required` cards, taken from the most-abundant resources first (mirror v0, deterministic). */
function planDiscard(
  resources: Readonly<Record<ResourceType, number>>,
  required: number,
): Record<ResourceType, number> {
  const remaining: Record<ResourceType, number> = { ...resources };
  const discard: Record<ResourceType, number> = {};
  let left = required;
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
    if (!took) break;
  }
  return discard;
}

/** The highest PUBLIC-VP eligible victim (steal from the leader), tie-broken by id (deterministic). */
function pickLeaderVictim(
  state: GameState,
  victims: readonly PlayerId[],
): PlayerId | undefined {
  let best: PlayerId | undefined;
  let bestVp = -1;
  for (const victim of [...victims].sort((a, z) => (a < z ? -1 : a > z ? 1 : 0))) {
    const vp = computePublicVictoryPoints(state, victim);
    if (vp > bestVp) {
      bestVp = vp;
      best = victim;
    }
  }
  return best;
}

/** True if the player holds a knight it may LEGALLY play now (not bought this turn, none played yet). */
function canPlayKnight(state: GameState, playerId: PlayerId): boolean {
  if (state.devCardPlayedThisTurn) return false;
  const holdings = state.devCards?.[playerId];
  if (!holdings) return false;
  const held = holdings.held.knight ?? 0;
  const bought = holdings.boughtThisTurn.knight ?? 0;
  return held - bought > 0;
}

/**
 * The single best robber relocation (block value + victim public VP), argmax
 * with a deterministic tie-break — used to aim a played KNIGHT. `null` when no
 * legal tile exists.
 */
function bestRobberTarget(
  state: GameState,
  playerId: PlayerId,
  robber: RobberProfile,
): { tileId: string; victimId?: PlayerId } | null {
  const moves = candidateRobberMoves(state, playerId, robber);
  let best: {
    move: Extract<PlayerIntent, { type: 'intent.moveRobber' }>;
    score: number;
    key: string;
  } | null = null;
  for (const move of moves) {
    if (move.type !== 'intent.moveRobber') continue;
    const block = blockingValue(state, playerId, move.tileId);
    const victimVp =
      move.victimId !== undefined ? computePublicVictoryPoints(state, move.victimId) : 0;
    const score = block * 3 + victimVp * 6;
    const key = `${move.tileId}:${move.victimId ?? ''}`;
    if (best === null || score > best.score || (score === best.score && key < best.key)) {
      best = { move, score, key };
    }
  }
  if (best === null) return null;
  return best.move.victimId !== undefined
    ? { tileId: best.move.tileId, victimId: best.move.victimId }
    : { tileId: best.move.tileId };
}

/**
 * One candidate robber relocation per legal tile: move to any tile but the
 * robber's current one, naming the highest-VP eligible victim there (adjacent
 * opponent holding ≥1 card AND `isStealable` — the friendlyRobber gate), or no
 * victim when none qualifies. Every entry is a LEGAL `moveRobber` (never
 * ROBBER_SAME_TILE / NO_SUCH_VICTIM / VICTIM_HAS_NO_CARDS / VICTIM_PROTECTED).
 */
function candidateRobberMoves(
  state: GameState,
  playerId: PlayerId,
  robber: RobberProfile,
): PlayerIntent[] {
  const board = state.board;
  if (!board) return [];
  const b = buildingsOf(state);
  const moves: PlayerIntent[] = [];
  for (const tile of topologyOf(state).tiles) {
    if (tile.id === board.robberTileId) continue;
    const victims: PlayerId[] = [];
    for (const vertexId of tile.vertexIds) {
      const owner = b.cities?.[vertexId] ?? b.settlements[vertexId];
      if (
        owner === undefined ||
        owner === playerId ||
        owner === NEUTRAL_OWNER_ID ||
        victims.includes(owner)
      ) {
        continue;
      }
      if (handSize(resourcesOf(state, owner)) <= 0) continue;
      if (!isStealable(state, owner, robber)) continue;
      victims.push(owner);
    }
    const victimId = pickLeaderVictim(state, victims);
    moves.push(
      victimId !== undefined
        ? { type: 'intent.moveRobber', playerId, tileId: tile.id, victimId }
        : { type: 'intent.moveRobber', playerId, tileId: tile.id },
    );
  }
  return moves;
}

// --- The decision function ---------------------------------------------------

/**
 * The single legal intent `playerId` should send next given `state`, scored per
 * `difficulty`, with `rng` supplying selection noise (medium/easy only — hard is
 * deterministic). Returns `null` when it is not this seat's move. Reactive like
 * v0: one intent per call, re-invoked on the broadcast next state.
 */
export function decideV1(
  state: GameState,
  playerId: PlayerId,
  difficulty: Difficulty,
  rng: BotRng,
): PlayerIntent | null {
  if (state.phase === 'finished' || state.phase === 'lobby') return null;

  const weights = FEATURE_WEIGHTS[difficulty];
  const profile = loadRuleProfile(state.profileId ?? 'classic');
  const b = buildingsOf(state);

  // Post-7 robber resolution (any owing player discards; the mover then relocates).
  if (state.phase === 'robber') {
    const owing = state.playersToDiscard ?? [];
    if (owing.includes(playerId)) {
      const resources = resourcesOf(state, playerId);
      const required = Math.floor(handSize(resources) / profile.robber.halfDivisor);
      return {
        type: 'intent.discard',
        playerId,
        resources: planDiscard(resources, required),
      };
    }
    if (owing.length === 0 && state.currentPlayerId === playerId && state.board) {
      const moves = candidateRobberMoves(state, playerId, profile.robber);
      if (moves.length === 0) return null;
      const scored = scoreActions(state, playerId, moves, weights);
      return selectByDifficulty(scored, difficulty, rng);
    }
    return null;
  }

  // A standing trade offer this seat is targeted by — decline (v1 never opens p2p offers).
  if (state.openTradeOffer?.targets.includes(playerId)) {
    return { type: 'intent.rejectTrade', playerId };
  }

  // Snake-draft setup (only the current player acts).
  if (state.phase === 'setup') {
    if (state.currentPlayerId !== playerId) return null;
    if (state.pendingRoadVertexId !== undefined) {
      const edgeId = firstSetupRoad(topologyOf(state), b, state.pendingRoadVertexId);
      return edgeId ? { type: 'intent.placeRoad', playerId, edgeId } : null;
    }
    const vertexId = chooseSetupSettlement(state, playerId, b, difficulty, rng, weights);
    return vertexId ? { type: 'intent.placeSettlement', playerId, vertexId } : null;
  }

  // The turn's mandatory first step.
  if (state.phase === 'roll') {
    if (state.currentPlayerId !== playerId) return null;
    return { type: 'intent.rollDice', playerId };
  }

  // Main phase: scored expansion-first — build the candidate set, score, select.
  if (state.phase === 'main') {
    if (state.currentPlayerId !== playerId) return null;
    const scored = scoreActions(
      state,
      playerId,
      mainCandidates(state, playerId),
      weights,
    );
    return selectByDifficulty(scored, difficulty, rng);
  }

  return null;
}
