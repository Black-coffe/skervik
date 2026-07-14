// Pure gating for the over-7 discard (S2.8.4b) — the same discipline as
// `turnActions.ts`: no React, no I/O, so the "must I shed cards, how many, and
// is this selection legal" logic is unit-tested without a render. The SERVER
// (core `validate.ts`) is the sole authority; these mirror its discard rules
// ONLY as advisory UI affordances (gate the «Сбросить» button). Core `validate`
// is NEVER called client-side (it needs the server-secret `seed`).
import type { GameState, PlayerId, ResourceType } from '@skervik/core';

import { handSize } from './renown.js';

/** A UI discard selection — how many of each resource the player chose to shed. */
export type DiscardSelection = Readonly<Record<ResourceType, number>>;

/**
 * `true` when `myPlayerId` owes a discard right now — i.e. is listed in
 * `state.playersToDiscard` (set on a 7's `dice.rolled`, shrinks per discard,
 * dropped when empty). NOT turn-gated: a discard is owed regardless of whose
 * turn it is (`validate.ts` carves `intent.discard` out of the current-player
 * guard), so this can be true on an opponent's turn.
 */
export function owesDiscard(state: GameState, myPlayerId: PlayerId): boolean {
  return (state.playersToDiscard ?? []).includes(myPlayerId);
}

/**
 * How many cards `myPlayerId` must shed: `floor(handSize / 2)` (the Classic
 * `robber.halfDivisor` of 2 — the only profile reaching a live 7 today). `0`
 * when not owing or the player isn't found.
 */
export function requiredDiscardCount(state: GameState, myPlayerId: PlayerId): number {
  if (!owesDiscard(state, myPlayerId)) return 0;
  const me = state.players.find((p) => p.id === myPlayerId);
  if (!me) return 0;
  return Math.floor(handSize(me.resources) / 2);
}

/**
 * Advisory mirror of the server's discard acceptance (`WRONG_DISCARD_COUNT` /
 * `CANNOT_AFFORD`): the selection is confirmable ONLY when it sums to EXACTLY
 * `required`, holds no negative entry, and never exceeds what the player has of
 * any resource. Used to enable the «Сбросить» button; the server re-validates.
 */
export function isValidDiscardSelection(
  selection: DiscardSelection,
  required: number,
  myResources: Readonly<Record<ResourceType, number>>,
): boolean {
  let sum = 0;
  for (const [resource, count] of Object.entries(selection)) {
    if (count < 0) return false;
    if (count > (myResources[resource] ?? 0)) return false;
    sum += count;
  }
  return sum === required;
}
