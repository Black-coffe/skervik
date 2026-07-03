// @skervik/core — `reduce`: the single pure state transition (tech spec
// §4.1). ADR-0003: deterministic, side-effect free, never mutates its input
// — always returns a new GameState built from `event` data.

import type {
  DevCardHoldings,
  DevCardKind,
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  ResourceType,
} from './types.js';

/**
 * Merges a resource grant into a player's holdings. Pure — returns a new
 * `resources` object, never mutates `base` (ADR-0003).
 */
function addResources(
  base: Readonly<Record<ResourceType, number>>,
  grant: Readonly<Record<ResourceType, number>>,
): Record<ResourceType, number> {
  const result: Record<ResourceType, number> = { ...base };
  for (const [resource, amount] of Object.entries(grant)) {
    result[resource] = (result[resource] ?? 0) + amount;
  }
  return result;
}

/**
 * Debits a resource cost from a player's holdings. Pure — returns a new
 * `resources` object, never mutates `base` (ADR-0003); the inverse of
 * {@link addResources}.
 */
function subtractResources(
  base: Readonly<Record<ResourceType, number>>,
  cost: Readonly<Record<ResourceType, number>>,
): Record<ResourceType, number> {
  const result: Record<ResourceType, number> = { ...base };
  for (const [resource, amount] of Object.entries(cost)) {
    result[resource] = (result[resource] ?? 0) - amount;
  }
  return result;
}

/**
 * Consumes one held dev card of `kind` from `playerId`'s holdings (S1.2.3
 * play branches) — decrements `held` only, never `boughtThisTurn`: `validate`
 * already guaranteed `held - boughtThisTurn >= 1` before allowing the play,
 * so the invariant `boughtThisTurn <= held` still holds after this
 * decrement without touching `boughtThisTurn` itself (individual card
 * instances of the same kind are fungible — which physical copy gets
 * "used" doesn't matter). Pure — returns a new `devCards` map, never
 * mutates `devCards`.
 */
function decrementHeld(
  devCards: Readonly<Record<PlayerId, DevCardHoldings>> | undefined,
  playerId: PlayerId,
  kind: DevCardKind,
): Readonly<Record<PlayerId, DevCardHoldings>> {
  const existing = devCards?.[playerId] ?? { held: {}, boughtThisTurn: {} };
  const nextCount = (existing.held[kind] ?? 0) - 1;
  return {
    ...devCards,
    [playerId]: {
      held: { ...existing.held, [kind]: nextCount },
      boughtThisTurn: existing.boughtThisTurn,
    },
  };
}

/**
 * Applies one {@link GameEvent} to {@link GameState}, returning a *new*
 * state. Pure and deterministic (ADR-0003): no `Date.now`/`Math.random`/I/O,
 * and `state` is never mutated — every branch returns a fresh object built
 * by spreading `state`, not assigning into it.
 */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'match.started': {
      const players: PlayerState[] = event.playerIds.map((id) => ({
        id,
        name: id,
        victoryPoints: 0,
        resources: {},
      }));
      const firstPlayer = players[0];
      return {
        ...state,
        matchId: event.matchId,
        seedHash: event.seedHash,
        phase: 'setup',
        turn: 1,
        players,
        currentPlayerId: firstPlayer ? firstPlayer.id : state.currentPlayerId,
        eventIndex: event.index + 1,
      };
    }
    case 'board.generated': {
      return {
        ...state,
        board: {
          tileKinds: event.tileKinds,
          tileTokens: event.tileTokens,
          portContents: event.portContents,
          robberTileId: event.robberTileId,
        },
        eventIndex: event.index + 1,
      };
    }
    case 'dice.rolled': {
      // The roll itself only advances the event-stream index — production
      // (if any) is a separate `resources.produced` event (S1.2.1), applied
      // below, so a 7 (no production, robber deferred to S1.3.1) still
      // advances state correctly from `dice.rolled` alone.
      return { ...state, eventIndex: event.index + 1 };
    }
    case 'resources.produced': {
      const players = state.players.map((player) => {
        const grant = event.grants[player.id];
        return grant
          ? { ...player, resources: addResources(player.resources, grant) }
          : player;
      });
      return { ...state, players, bank: event.bank, eventIndex: event.index + 1 };
    }
    case 'turn.ended': {
      // Drop `devCardPlayedThisTurn` entirely (not set to `undefined`) —
      // `exactOptionalPropertyTypes` treats those differently, and an
      // absent key is the correct "no dev card played yet" representation
      // (same convention as `road.placed`'s `pendingRoadVertexId` drop
      // below). S1.2.3's minimal per-turn-marker reset; S1.2.4 formalizes
      // the full architecture.
      const { devCardPlayedThisTurn: _played, ...rest } = state;
      const devCards = state.devCards
        ? (Object.fromEntries(
            Object.entries(state.devCards).map(([id, holdings]) => [
              id,
              { held: holdings.held, boughtThisTurn: {} },
            ]),
          ) as GameState['devCards'])
        : state.devCards;
      return {
        ...rest,
        currentPlayerId: event.nextPlayerId,
        turn: state.turn + 1,
        ...(devCards ? { devCards } : {}),
        eventIndex: event.index + 1,
      };
    }
    case 'settlement.placed': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? { ...player, resources: addResources(player.resources, event.payout) }
          : player,
      );
      return {
        ...state,
        players,
        buildings: {
          settlements: { ...buildings.settlements, [event.vertexId]: event.playerId },
          roads: buildings.roads,
        },
        pendingRoadVertexId: event.vertexId,
        eventIndex: event.index + 1,
      };
    }
    case 'road.placed': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      // Drop `pendingRoadVertexId` entirely (not set to `undefined`) —
      // `exactOptionalPropertyTypes` treats those differently, and an absent
      // key is the correct "no settlement pending" representation.
      const { pendingRoadVertexId: _pending, ...rest } = state;
      return {
        ...rest,
        buildings: {
          settlements: buildings.settlements,
          roads: { ...buildings.roads, [event.edgeId]: event.playerId },
        },
        currentPlayerId: event.nextPlayerId,
        phase: event.nextPhase,
        eventIndex: event.index + 1,
      };
    }
    case 'road.built': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? { ...player, resources: subtractResources(player.resources, event.cost) }
          : player,
      );
      return {
        ...state,
        players,
        buildings: {
          settlements: buildings.settlements,
          roads: { ...buildings.roads, [event.edgeId]: event.playerId },
          ...(buildings.cities ? { cities: buildings.cities } : {}),
        },
        eventIndex: event.index + 1,
      };
    }
    case 'settlement.built': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? {
              ...player,
              resources: subtractResources(player.resources, event.cost),
              victoryPoints: player.victoryPoints + 1,
            }
          : player,
      );
      return {
        ...state,
        players,
        buildings: {
          settlements: { ...buildings.settlements, [event.vertexId]: event.playerId },
          roads: buildings.roads,
          ...(buildings.cities ? { cities: buildings.cities } : {}),
        },
        eventIndex: event.index + 1,
      };
    }
    case 'city.built': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      // The city replaces its settlement — drop the vertex from
      // `settlements` entirely rather than leaving it in both records
      // (BuildingsState.cities docstring: a city never coexists with a
      // settlement at the same vertex).
      const { [event.vertexId]: _upgraded, ...remainingSettlements } =
        buildings.settlements;
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? {
              ...player,
              resources: subtractResources(player.resources, event.cost),
              victoryPoints: player.victoryPoints + 1,
            }
          : player,
      );
      return {
        ...state,
        players,
        buildings: {
          settlements: remainingSettlements,
          roads: buildings.roads,
          cities: { ...buildings.cities, [event.vertexId]: event.playerId },
        },
        eventIndex: event.index + 1,
      };
    }
    case 'devCard.bought': {
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? { ...player, resources: subtractResources(player.resources, event.cost) }
          : player,
      );
      const existing = state.devCards?.[event.playerId] ?? {
        held: {},
        boughtThisTurn: {},
      };
      const devCards = {
        ...state.devCards,
        [event.playerId]: {
          held: {
            ...existing.held,
            [event.card]: (existing.held[event.card] ?? 0) + 1,
          },
          boughtThisTurn: {
            ...existing.boughtThisTurn,
            [event.card]: (existing.boughtThisTurn[event.card] ?? 0) + 1,
          },
        },
      };
      return {
        ...state,
        players,
        devCards,
        devDeckRemaining: event.deckRemaining,
        eventIndex: event.index + 1,
      };
    }
    case 'devCard.roadBuildingPlayed': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      const roads = { ...buildings.roads };
      for (const edgeId of event.edgeIds) roads[edgeId] = event.playerId;
      return {
        ...state,
        buildings: {
          settlements: buildings.settlements,
          roads,
          ...(buildings.cities ? { cities: buildings.cities } : {}),
        },
        devCards: decrementHeld(state.devCards, event.playerId, 'roadBuilding'),
        devCardPlayedThisTurn: true,
        eventIndex: event.index + 1,
      };
    }
    case 'devCard.yearOfPlentyPlayed': {
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? { ...player, resources: addResources(player.resources, event.resources) }
          : player,
      );
      return {
        ...state,
        players,
        bank: event.bank,
        devCards: decrementHeld(state.devCards, event.playerId, 'yearOfPlenty'),
        devCardPlayedThisTurn: true,
        eventIndex: event.index + 1,
      };
    }
    case 'devCard.monopolyPlayed': {
      const totalCollected = Object.values(event.transfers).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      const players = state.players.map((player) => {
        const taken = event.transfers[player.id];
        if (taken) {
          return {
            ...player,
            resources: subtractResources(player.resources, { [event.resource]: taken }),
          };
        }
        if (player.id === event.playerId && totalCollected > 0) {
          return {
            ...player,
            resources: addResources(player.resources, {
              [event.resource]: totalCollected,
            }),
          };
        }
        return player;
      });
      return {
        ...state,
        players,
        devCards: decrementHeld(state.devCards, event.playerId, 'monopoly'),
        devCardPlayedThisTurn: true,
        eventIndex: event.index + 1,
      };
    }
    default: {
      const exhaustive: never = event;
      throw new Error(`unhandled event type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Folds {@link reduce} over an event log, from `initialState` to the final
 * state. "Replay = truth" (`docs/wiki/deterministic-core.md`): replaying the
 * same log from the same initial state always reproduces the same state.
 * The golden-fixture determinism test lands in S0.5.4; this is the helper it
 * builds on.
 */
export function replay(initialState: GameState, events: readonly GameEvent[]): GameState {
  return events.reduce(reduce, initialState);
}
