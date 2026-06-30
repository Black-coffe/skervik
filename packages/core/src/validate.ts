// @skervik/core — `validate`: turns a legal PlayerIntent into GameEvent(s), or
// rejects it. ADR-0003: only events mutate state; intents never do directly.
// Per the deterministic-core invariant, validate never throws for an expected
// rejection — it always returns the discriminated ValidateResult below.

import type {
  DiceRolledEvent,
  GameEvent,
  GameState,
  PlayerId,
  PlayerIntent,
  RejectReason,
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
 * Validates a player's {@link PlayerIntent} against the current
 * {@link GameState} and turns it into the {@link GameEvent}s that should be
 * applied via {@link reduce}, or refuses it with a {@link RejectReason}.
 * `playerId` is the server-authenticated actor for this request — it is
 * checked against `intent.playerId` so a spoofed payload is caught even
 * though the network layer already knows who is asking (ADR-0003 /
 * server-authority).
 *
 * Pure and deterministic: never throws for an expected rejection.
 */
export function validate(
  state: GameState,
  intent: PlayerIntent,
  playerId: PlayerId,
): ValidateResult {
  if (intent.playerId !== playerId) {
    return reject('MALFORMED_INTENT');
  }
  if (!state.players.some((player) => player.id === playerId)) {
    return reject('UNKNOWN_PLAYER');
  }
  if (state.phase !== 'main') {
    return reject('INVALID_PHASE');
  }
  if (state.currentPlayerId !== playerId) {
    return reject('NOT_YOUR_TURN');
  }

  switch (intent.type) {
    case 'intent.rollDice': {
      // M0 skeleton: the real seeded-PRNG draw lands when S0.5.3's
      // `rng.ts` is wired into rule logic (M1). For now the value is a
      // deterministic function of state alone — no Math.random, no
      // ambient randomness (ADR-0003) — and will be replaced, not removed.
      const value = 2 + (state.eventIndex % 11);
      const event: DiceRolledEvent = {
        type: 'dice.rolled',
        index: state.eventIndex,
        playerId,
        value,
      };
      return { ok: true, events: [event] };
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
    default: {
      const exhaustive: never = intent;
      throw new Error(`unhandled intent type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
