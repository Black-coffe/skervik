// @skervik/core — `reduce`: the single pure state transition (tech spec
// §4.1). ADR-0003: deterministic, side-effect free, never mutates its input
// — always returns a new GameState built from `event` data.

import type { GameEvent, GameState, PlayerState } from './types.js';

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
    case 'dice.rolled': {
      // M0 skeleton: GameState carries no per-roll field yet (M1 Classic
      // rules add resource production from the roll). Applying the event
      // still advances the deterministic event-stream index.
      return { ...state, eventIndex: event.index + 1 };
    }
    case 'turn.ended': {
      return {
        ...state,
        currentPlayerId: event.nextPlayerId,
        turn: state.turn + 1,
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
