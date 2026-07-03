// @skervik/core — `validate`: turns a legal PlayerIntent into GameEvent(s), or
// rejects it. ADR-0003: only events mutate state; intents never do directly.
// Per the deterministic-core invariant, validate never throws for an expected
// rejection — it always returns the discriminated ValidateResult below.

import {
  type BoardTopology,
  buildTopology,
  findEdge,
  findVertex,
  type VertexTopology,
} from './board.js';
import { gameplayStreamIndex, rollDie, type Seed } from './rng.js';
import type {
  DiceRolledEvent,
  GameEvent,
  GamePhase,
  GameState,
  PlayerId,
  PlayerIntent,
  RejectReason,
  ResourcesProducedEvent,
  ResourceType,
  RoadPlacedEvent,
  SettlementPlacedEvent,
  TurnEndedEvent,
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
 * TODO(S1.2.2): once `BuildingsState` gains a city marker, a city here
 * should pay 2 instead of 1 — this function only knows "settlement" today
 * (`BuildingsState.settlements`), so every producing vertex pays the
 * settlement amount; the seam is the `amount = 1` line below.
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
        const owner = buildings.settlements[vertexId];
        if (owner === undefined) continue;
        const amount = 1; // TODO(S1.2.2): city -> 2, see docstring above.
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
      // Distance rule: no vertex adjacent to the target may already hold a
      // settlement (setup phase has no road-connection requirement).
      const hasAdjacentSettlement = vertex.adjacentVertexIds.some(
        (adjacentId) => buildings.settlements[adjacentId] !== undefined,
      );
      if (hasAdjacentSettlement) {
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
    default: {
      const exhaustive: never = intent;
      throw new Error(`unhandled intent type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
