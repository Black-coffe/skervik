// @skervik/core — `reduce`: the single pure state transition (tech spec
// §4.1). ADR-0003: deterministic, side-effect free, never mutates its input
// — always returns a new GameState built from `event` data.

import type { GameEvent, GameState, PlayerState, ResourceType } from './types.js';

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
      return {
        ...state,
        currentPlayerId: event.nextPlayerId,
        turn: state.turn + 1,
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
