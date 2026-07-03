// @skervik/core — `validate`: turns a legal PlayerIntent into GameEvent(s), or
// rejects it. ADR-0003: only events mutate state; intents never do directly.
// Per the deterministic-core invariant, validate never throws for an expected
// rejection — it always returns the discriminated ValidateResult below.

import {
  type BoardTopology,
  buildTopology,
  type EdgeId,
  type EdgeTopology,
  findEdge,
  findVertex,
  type VertexTopology,
} from './board.js';
import { CLASSIC_DEV_CARD_PROFILE, shuffledDevDeck } from './devcards.js';
import { gameplayStreamIndex, rollDie, type Seed } from './rng.js';
import type {
  BuildingsState,
  CityBuiltEvent,
  DevCardBoughtEvent,
  DevCardKind,
  DiceRolledEvent,
  GameEvent,
  GamePhase,
  GameState,
  MonopolyPlayedEvent,
  PlayerId,
  PlayerIntent,
  PlayerState,
  RejectReason,
  ResourcesProducedEvent,
  ResourceType,
  RoadBuildingPlayedEvent,
  RoadBuiltEvent,
  RoadPlacedEvent,
  SettlementBuiltEvent,
  SettlementPlacedEvent,
  TurnEndedEvent,
  YearOfPlentyPlayedEvent,
} from './types.js';

/**
 * Result of {@link validate}: either the intent is legal and is translated
 * into the {@link GameEvent}s that would realize it, or it is rejected with a
 * {@link RejectReason}. Discriminated on `ok` (tech spec §4.1).
 */
export type ValidateResult =
  | { readonly ok: true; readonly events: GameEvent[] }
  | { readonly ok: false; readonly reason: RejectReason };

function reject(reason: RejectReason): ValidateResult {
  return { ok: false, reason };
}

/**
 * Classic setup-phase constants (rule-profile discipline, plan §1): the one
 * count legality logic actually consumes. The fixed forward-then-reverse
 * snake shape (see {@link snakeOrder}) is Classic-specific by construction
 * and isn't parameterized here — it only ever means 2 rounds.
 */
export const CLASSIC_SETUP_PROFILE = {
  settlementsPerPlayer: 2,
} as const;

/**
 * Classic production constants (rule-profile discipline, plan §1): the
 * finite bank pool per resource type. Physical-Catan parity (19 cards of
 * each of the 5 resources) — a swappable profile object, not a magic number
 * scattered through {@link computeProduction}.
 */
const CLASSIC_PRODUCTION_PROFILE = {
  bankPerResource: 19,
} as const;

/**
 * Classic build costs + per-player piece-supply limits (rule-profile
 * discipline, plan §1, S1.2.2 spec): the price list and caps live here as a
 * single swappable object, never scattered magic numbers through the build
 * branches below.
 */
export const CLASSIC_BUILD_PROFILE = {
  costs: {
    road: { timber: 1, clay: 1 },
    settlement: { timber: 1, clay: 1, fleece: 1, barley: 1 },
    city: { iron: 3, barley: 2 },
  },
  supply: {
    roads: 15,
    settlements: 5,
    cities: 4,
  },
} as const;

/**
 * The gameplay RNG stream's per-event slot map (S1.2.1, fixed here,
 * documented in `docs/wiki/rng-stream-map.md` §1 — **never renumber a slot
 * once shipped**, an auditor's recomputation depends on it). `validate.ts`
 * is this scheme's owner (parallel to `boardgen.ts` owning
 * `BOARD_GEN_STREAM`); `gameplayStreamIndex` (`rng.ts`) only knows the
 * stride `K`, not what each slot means.
 */
const GAMEPLAY_SLOT = {
  DICE_A: 0,
  DICE_B: 1,
  // 2-7 reserved for later same-event draws (e.g. the robber steal-pick, S1.3.1).
} as const;

// `buildTopology()` is pure and its result never changes for a given board
// radius (see its docstring: "callers should memoize the result") — cached
// once per module rather than rebuilt on every `validate` call.
let cachedTopology: BoardTopology | undefined;
function topology(): BoardTopology {
  cachedTopology ??= buildTopology();
  return cachedTopology;
}

/**
 * The Classic snake draft order: forward `P1..PN`, then reverse `PN..P1`
 * (length `2 * playerIds.length`) — round 1 places each player's first
 * settlement+road, round 2 (reversed) places the second (S1.1.3 spec).
 */
function snakeOrder(playerIds: readonly PlayerId[]): PlayerId[] {
  return [...playerIds, ...[...playerIds].reverse()];
}

/**
 * Distance rule (S1.1.3 spec): true if any vertex adjacent to `vertex`
 * already holds a settlement or a city — no two buildings may ever sit next
 * to each other. Shared by the free setup placement and the paid S1.2.2
 * build branch below so the adjacency walk is written once (`vertex.adjacentVertexIds`,
 * S1.1.1 embedded topology), never duplicated.
 */
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

/**
 * Road-building network legality (S1.2.2 spec): true if `edge` touches the
 * player's own network at either endpoint — an own settlement/city sits on
 * that vertex, or an own road is already incident to it (`VertexTopology.edgeIds`,
 * S1.1.1). A single-hop check is sufficient: the network is built up
 * incrementally, so every prior own road already touched the network when
 * it was placed.
 */
function touchesOwnNetwork(
  edge: EdgeTopology,
  playerId: PlayerId,
  buildings: BuildingsState,
): boolean {
  return edge.vertexIds.some((vertexId) => {
    if (buildings.settlements[vertexId] === playerId) return true;
    if (buildings.cities?.[vertexId] === playerId) return true;
    const vertex = findVertex(topology(), vertexId);
    return (
      vertex?.edgeIds.some((edgeId) => buildings.roads[edgeId] === playerId) ?? false
    );
  });
}

/**
 * Settlement-building road legality (S1.2.2 spec, the gameplay rule setup
 * waives): true if any edge incident to `vertex` is the player's own road.
 */
function touchesOwnRoad(
  vertex: VertexTopology,
  playerId: PlayerId,
  buildings: BuildingsState,
): boolean {
  return vertex.edgeIds.some((edgeId) => buildings.roads[edgeId] === playerId);
}

/** How many of `record`'s entries this player already owns — the piece-supply count (S1.2.2). */
function countOwned(
  record: Readonly<Record<string, PlayerId>> | undefined,
  playerId: PlayerId,
): number {
  if (!record) return 0;
  return Object.values(record).filter((owner) => owner === playerId).length;
}

/** True if `resources` covers every line of `cost` (S1.2.2 affordability check). */
function canAfford(
  resources: Readonly<Record<ResourceType, number>>,
  cost: Readonly<Record<ResourceType, number>>,
): boolean {
  return Object.entries(cost).every(
    ([resource, amount]) => (resources[resource] ?? 0) >= amount,
  );
}

function findPlayer(state: GameState, playerId: PlayerId): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

/**
 * The second-settlement resource grant (S1.1.3 spec): 1 resource per
 * adjacent producing tile, desert pays nothing. Empty if `board` is absent
 * (defensive — setup should never reach placement before `board.generated`).
 */
function settlementPayout(
  vertex: VertexTopology,
  board: GameState['board'],
): Record<ResourceType, number> {
  const payout: Record<ResourceType, number> = {};
  if (!board) return payout;
  for (const tileId of vertex.adjacentTileIds) {
    const kind = board.tileKinds[tileId];
    if (kind === undefined || kind === 'desert') continue;
    payout[kind] = (payout[kind] ?? 0) + 1;
  }
  return payout;
}

/** Result of {@link computeProduction}: facts destined for `resources.produced` (ADR-0003). */
interface ProductionResult {
  readonly grants: Record<PlayerId, Record<ResourceType, number>>;
  readonly bank: Record<ResourceType, number>;
}

/**
 * Resolves one roll's Classic production (S1.2.1 spec): for every
 * non-desert tile bearing `total` that the robber is NOT sitting on, each
 * adjacent settlement's owner earns 1 of that tile's resource. Bank
 * exhaustion is all-or-nothing per resource type — if the bank can't pay
 * the FULL amount owed of a resource to every entitled player this roll,
 * nobody gets that resource this roll. Returns empty grants (bank
 * unchanged) if `board`/`buildings` are absent — never throws.
 *
 * A city (S1.2.2, `BuildingsState.cities`) pays double a settlement — see
 * the `amount` line below (this fills the seam an earlier TODO left here
 * before cities existed).
 */
function computeProduction(state: GameState, total: number): ProductionResult {
  const board = state.board;
  const buildings = state.buildings;

  // owed[resource][playerId] = amount owed to that player this roll, summed
  // across every producing, unblocked tile of that resource.
  const owed: Record<ResourceType, Record<PlayerId, number>> = {};
  if (board && buildings) {
    for (const tile of topology().tiles) {
      const kind = board.tileKinds[tile.id];
      if (kind === undefined || kind === 'desert') continue;
      if (board.tileTokens[tile.id] !== total) continue;
      if (tile.id === board.robberTileId) continue; // robber blocks the tile entirely

      for (const vertexId of tile.vertexIds) {
        const cityOwner = buildings.cities?.[vertexId];
        const owner = cityOwner ?? buildings.settlements[vertexId];
        if (owner === undefined) continue;
        const amount = cityOwner !== undefined ? 2 : 1; // S1.2.2: a city pays double
        owed[kind] ??= {};
        owed[kind][owner] = (owed[kind][owner] ?? 0) + amount;
      }
    }
  }

  const grants: Record<PlayerId, Record<ResourceType, number>> = {};
  const bank: Record<ResourceType, number> = { ...(state.bank ?? {}) };

  for (const [resource, byPlayer] of Object.entries(owed)) {
    const totalOwed = Object.values(byPlayer).reduce((sum, amount) => sum + amount, 0);
    const available = bank[resource] ?? CLASSIC_PRODUCTION_PROFILE.bankPerResource;
    if (totalOwed > available) continue; // all-or-nothing: bank can't cover it, nobody gets it

    bank[resource] = available - totalOwed;
    for (const [playerId, amount] of Object.entries(byPlayer)) {
      grants[playerId] ??= {};
      grants[playerId][resource] = (grants[playerId][resource] ?? 0) + amount;
    }
  }

  return { grants, bank };
}

/**
 * Validates a player's {@link PlayerIntent} against the current
 * {@link GameState} and turns it into the {@link GameEvent}s that should be
 * applied via {@link reduce}, or refuses it with a {@link RejectReason}.
 * `playerId` is the server-authenticated actor for this request — it is
 * checked against `intent.playerId` so a spoofed payload is caught even
 * though the network layer already knows who is asking (ADR-0003 /
 * server-authority).
 *
 * `seed` is the match's raw PRNG seed — a **server secret** that drives the
 * commit-reveal fair RNG (`docs/wiki/fair-rng-commit-reveal.md`). It is
 * passed in rather than read from `state` on purpose: `GameState` carries
 * only `seedHash` (the public commit) and is serialized to clients, so
 * putting the raw seed there would let a client predict every future roll
 * and defeat the whole scheme. Randomness is derived as
 * `rollDie(seed, state.eventIndex)` — pure indexing into the seed stream,
 * never an ambient draw (ADR-0003).
 *
 * Pure and deterministic: never throws for an expected rejection.
 */
export function validate(
  state: GameState,
  intent: PlayerIntent,
  playerId: PlayerId,
  seed: Seed,
): ValidateResult {
  if (intent.playerId !== playerId) {
    return reject('MALFORMED_INTENT');
  }
  if (!state.players.some((player) => player.id === playerId)) {
    return reject('UNKNOWN_PLAYER');
  }
  // Setup-phase intents (the snake draft, S1.1.3) require `phase === 'setup'`;
  // every other intent requires the normal turn loop's `phase === 'main'`.
  const requiredPhase: GamePhase =
    intent.type === 'intent.placeSettlement' || intent.type === 'intent.placeRoad'
      ? 'setup'
      : 'main';
  if (state.phase !== requiredPhase) {
    return reject('INVALID_PHASE');
  }
  if (state.currentPlayerId !== playerId) {
    return reject('NOT_YOUR_TURN');
  }

  switch (intent.type) {
    case 'intent.rollDice': {
      // Fair-RNG draw: Classic play is 2d6, each die its own slot of the
      // gameplay stream (S1.2.1 scheme, `docs/wiki/rng-stream-map.md` §1) —
      // `gameplayStreamIndex(state.eventIndex, slot)` — so anyone with the
      // revealed seed can recompute both faces from the public event log
      // post-match (commit-reveal, `docs/wiki/fair-rng-commit-reveal.md`).
      // No ambient randomness (ADR-0003).
      const dieA = rollDie(
        seed,
        gameplayStreamIndex(state.eventIndex, GAMEPLAY_SLOT.DICE_A),
      );
      const dieB = rollDie(
        seed,
        gameplayStreamIndex(state.eventIndex, GAMEPLAY_SLOT.DICE_B),
      );
      const total = dieA + dieB;
      const diceEvent: DiceRolledEvent = {
        type: 'dice.rolled',
        index: state.eventIndex,
        playerId,
        dieA,
        dieB,
        total,
      };

      // TODO(S1.3.1): a 7 moves the robber + triggers discards for players
      // holding >7 cards — that's the robber story's job, not this one's.
      // Production is a deliberate no-op on 7 (nobody's tiles pay out while
      // the robber relocates); only `dice.rolled` is emitted, no
      // `resources.produced`.
      if (total === 7) {
        return { ok: true, events: [diceEvent] };
      }

      const production = computeProduction(state, total);
      const producedEvent: ResourcesProducedEvent = {
        type: 'resources.produced',
        index: state.eventIndex + 1,
        grants: production.grants,
        bank: production.bank,
      };
      return { ok: true, events: [diceEvent, producedEvent] };
    }
    case 'intent.endTurn': {
      const players = state.players;
      const currentIndex = players.findIndex((player) => player.id === playerId);
      const nextPlayer = players[(currentIndex + 1) % players.length];
      if (nextPlayer === undefined) {
        // Unreachable: the membership check above already guarantees
        // `playerId` (and therefore `currentIndex`) is valid and
        // `players.length >= 1`. Guarded defensively instead of asserted
        // away, so a future regression rejects rather than throws.
        return reject('UNKNOWN_PLAYER');
      }
      const event: TurnEndedEvent = {
        type: 'turn.ended',
        index: state.eventIndex,
        playerId,
        nextPlayerId: nextPlayer.id,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.placeSettlement': {
      // A settlement is already pending its road — this player's draft turn
      // isn't over, so a second settlement is out of sequence.
      if (state.pendingRoadVertexId !== undefined) {
        return reject('WRONG_PHASE');
      }
      const vertex = findVertex(topology(), intent.vertexId);
      if (!vertex) {
        return reject('MALFORMED_INTENT');
      }

      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      if (buildings.settlements[intent.vertexId] !== undefined) {
        return reject('OCCUPIED');
      }
      // Distance rule (setup phase has no road-connection requirement,
      // unlike the S1.2.2 build branch below).
      if (violatesDistanceRule(vertex, buildings)) {
        return reject('DISTANCE_VIOLATION');
      }

      const priorSettlements = Object.values(buildings.settlements).filter(
        (owner) => owner === playerId,
      ).length;
      const isSecondSettlement =
        priorSettlements === CLASSIC_SETUP_PROFILE.settlementsPerPlayer - 1;
      const payout = isSecondSettlement ? settlementPayout(vertex, state.board) : {};

      const event: SettlementPlacedEvent = {
        type: 'settlement.placed',
        index: state.eventIndex,
        playerId,
        vertexId: intent.vertexId,
        payout,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.placeRoad': {
      const pendingVertexId = state.pendingRoadVertexId;
      // No settlement placed yet this draft turn — nothing to attach a road to.
      if (pendingVertexId === undefined) {
        return reject('WRONG_PHASE');
      }
      const edge = findEdge(topology(), intent.edgeId);
      if (!edge) {
        return reject('MALFORMED_INTENT');
      }

      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      if (buildings.roads[intent.edgeId] !== undefined) {
        return reject('OCCUPIED');
      }
      if (!edge.vertexIds.includes(pendingVertexId)) {
        return reject('DETACHED_ROAD');
      }

      // This turn's road completes the draft turn — work out who (and what
      // phase) comes next so `reduce` only ever applies a fact (ADR-0003).
      const order = snakeOrder(state.players.map((player) => player.id));
      const completedTurns = Object.keys(buildings.roads).length;
      const nextStep = completedTurns + 1;
      const isLastTurn = nextStep >= order.length;
      // The draft's very last road hands the turn back to P1 for the normal
      // turn loop's first roll (S1.1.3 spec's "exit" rule).
      const nextPlayerId = (isLastTurn ? order[0] : order[nextStep]) as PlayerId;
      const nextPhase: GamePhase = isLastTurn ? 'main' : 'setup';

      const event: RoadPlacedEvent = {
        type: 'road.placed',
        index: state.eventIndex,
        playerId,
        edgeId: intent.edgeId,
        nextPlayerId,
        nextPhase,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.buildRoad': {
      const edge = findEdge(topology(), intent.edgeId);
      if (!edge) {
        return reject('MALFORMED_INTENT');
      }

      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      if (buildings.roads[intent.edgeId] !== undefined) {
        return reject('OCCUPIED');
      }
      if (!touchesOwnNetwork(edge, playerId, buildings)) {
        return reject('NOT_CONNECTED');
      }
      if (countOwned(buildings.roads, playerId) >= CLASSIC_BUILD_PROFILE.supply.roads) {
        return reject('SUPPLY_EXHAUSTED');
      }

      const cost = CLASSIC_BUILD_PROFILE.costs.road;
      const player = findPlayer(state, playerId);
      if (!player || !canAfford(player.resources, cost)) {
        return reject('CANNOT_AFFORD');
      }

      const event: RoadBuiltEvent = {
        type: 'road.built',
        index: state.eventIndex,
        playerId,
        edgeId: intent.edgeId,
        cost,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.buildSettlement': {
      const vertex = findVertex(topology(), intent.vertexId);
      if (!vertex) {
        return reject('MALFORMED_INTENT');
      }

      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      if (
        buildings.settlements[intent.vertexId] !== undefined ||
        buildings.cities?.[intent.vertexId] !== undefined
      ) {
        return reject('OCCUPIED');
      }
      // Distance rule reuses the S1.1.3 helper; the road-connection check is
      // the gameplay rule setup waives (S1.2.2 spec).
      if (violatesDistanceRule(vertex, buildings)) {
        return reject('DISTANCE_VIOLATION');
      }
      if (!touchesOwnRoad(vertex, playerId, buildings)) {
        return reject('NOT_CONNECTED');
      }
      if (
        countOwned(buildings.settlements, playerId) >=
        CLASSIC_BUILD_PROFILE.supply.settlements
      ) {
        return reject('SUPPLY_EXHAUSTED');
      }

      const cost = CLASSIC_BUILD_PROFILE.costs.settlement;
      const player = findPlayer(state, playerId);
      if (!player || !canAfford(player.resources, cost)) {
        return reject('CANNOT_AFFORD');
      }

      const event: SettlementBuiltEvent = {
        type: 'settlement.built',
        index: state.eventIndex,
        playerId,
        vertexId: intent.vertexId,
        cost,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.buildCity': {
      const vertex = findVertex(topology(), intent.vertexId);
      if (!vertex) {
        return reject('MALFORMED_INTENT');
      }

      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      // A city upgrades the player's OWN existing settlement — this also
      // covers "vertex is empty" and "vertex already a city" (a city vertex
      // is no longer a key in `settlements`, see BuildingsState docstring),
      // both correctly read as "you have no settlement here".
      if (buildings.settlements[intent.vertexId] !== playerId) {
        return reject('NOT_OWN_SETTLEMENT');
      }
      if (countOwned(buildings.cities, playerId) >= CLASSIC_BUILD_PROFILE.supply.cities) {
        return reject('SUPPLY_EXHAUSTED');
      }

      const cost = CLASSIC_BUILD_PROFILE.costs.city;
      const player = findPlayer(state, playerId);
      if (!player || !canAfford(player.resources, cost)) {
        return reject('CANNOT_AFFORD');
      }

      const event: CityBuiltEvent = {
        type: 'city.built',
        index: state.eventIndex,
        playerId,
        vertexId: intent.vertexId,
        cost,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.buyDevCard': {
      const cost = CLASSIC_DEV_CARD_PROFILE.buyCost;
      const player = findPlayer(state, playerId);
      if (!player || !canAfford(player.resources, cost)) {
        return reject('CANNOT_AFFORD');
      }

      const deckSize = CLASSIC_DEV_CARD_PROFILE.deck.length;
      const remainingBefore = state.devDeckRemaining ?? deckSize;
      if (remainingBefore <= 0) {
        return reject('DECK_EMPTY');
      }

      // Same "recompute from seed, never store the order" discipline as
      // dice rolls (`devcards.ts` docstring) — the draw index is simply how
      // many cards have already left the deck.
      const drawIndex = deckSize - remainingBefore;
      const card = shuffledDevDeck(seed)[drawIndex] as DevCardKind;

      const event: DevCardBoughtEvent = {
        type: 'devCard.bought',
        index: state.eventIndex,
        playerId,
        card,
        cost,
        deckRemaining: remainingBefore - 1,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.playDevCard': {
      if (intent.card === 'knight') {
        // TODO(S1.3.1): the knight's effect (move robber + steal) is a
        // robber action — S1.3.1 owns robber relocation for both the
        // 7-roll and the knight, and will replace this unconditional
        // rejection with the real play branch. Held/bought knight counts
        // are already tracked in `state.devCards[playerId].held.knight`
        // (incremented on buy) so S1.3.1/S1.3.4's largest-army calc has
        // the data waiting.
        return reject('KNIGHT_DEFERRED');
      }
      if (state.devCardPlayedThisTurn) {
        return reject('DEV_CARD_ALREADY_PLAYED');
      }
      const holdings = state.devCards?.[playerId];
      const held = holdings?.held[intent.card] ?? 0;
      if (held <= 0) {
        return reject('CARD_NOT_HELD');
      }
      const boughtThisTurn = holdings?.boughtThisTurn[intent.card] ?? 0;
      if (held - boughtThisTurn <= 0) {
        return reject('BOUGHT_THIS_TURN');
      }

      switch (intent.card) {
        case 'roadBuilding': {
          const buildings = state.buildings ?? { settlements: {}, roads: {} };
          const workingRoads: Record<EdgeId, PlayerId> = { ...buildings.roads };
          let ownedRoads = countOwned(buildings.roads, playerId);
          const edgeIds: EdgeId[] = [];
          for (const edgeId of intent.edgeIds) {
            if (edgeIds.length >= 2) break; // road-building grants at most 2 roads
            const edge = findEdge(topology(), edgeId);
            if (!edge) {
              return reject('MALFORMED_INTENT');
            }
            if (workingRoads[edgeId] !== undefined) continue; // occupied — place fewer
            if (ownedRoads >= CLASSIC_BUILD_PROFILE.supply.roads) break; // supply exhausted
            if (
              !touchesOwnNetwork(edge, playerId, {
                settlements: buildings.settlements,
                roads: workingRoads,
                ...(buildings.cities ? { cities: buildings.cities } : {}),
              })
            ) {
              continue; // detached from the network so far — place fewer
            }
            workingRoads[edgeId] = playerId;
            ownedRoads += 1;
            edgeIds.push(edgeId);
          }

          const event: RoadBuildingPlayedEvent = {
            type: 'devCard.roadBuildingPlayed',
            index: state.eventIndex,
            playerId,
            edgeIds,
          };
          return { ok: true, events: [event] };
        }
        case 'yearOfPlenty': {
          const bank = { ...(state.bank ?? {}) };
          const requested: Record<ResourceType, number> = {};
          for (const resource of intent.resources) {
            requested[resource] = (requested[resource] ?? 0) + 1;
          }
          for (const [resource, amount] of Object.entries(requested)) {
            const available =
              bank[resource] ?? CLASSIC_PRODUCTION_PROFILE.bankPerResource;
            if (available < amount) {
              return reject('BANK_EXHAUSTED');
            }
          }
          for (const [resource, amount] of Object.entries(requested)) {
            bank[resource] =
              (bank[resource] ?? CLASSIC_PRODUCTION_PROFILE.bankPerResource) - amount;
          }

          const event: YearOfPlentyPlayedEvent = {
            type: 'devCard.yearOfPlentyPlayed',
            index: state.eventIndex,
            playerId,
            resources: requested,
            bank,
          };
          return { ok: true, events: [event] };
        }
        case 'monopoly': {
          const resource = intent.resource;
          const transfers: Record<PlayerId, number> = {};
          for (const other of state.players) {
            if (other.id === playerId) continue;
            const amount = other.resources[resource] ?? 0;
            if (amount > 0) transfers[other.id] = amount;
          }

          const event: MonopolyPlayedEvent = {
            type: 'devCard.monopolyPlayed',
            index: state.eventIndex,
            playerId,
            resource,
            transfers,
          };
          return { ok: true, events: [event] };
        }
        default: {
          const exhaustive: never = intent;
          throw new Error(
            `unhandled playDevCard card kind: ${JSON.stringify(exhaustive)}`,
          );
        }
      }
    }
    default: {
      const exhaustive: never = intent;
      throw new Error(`unhandled intent type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
