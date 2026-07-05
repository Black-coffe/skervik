// Pure PUBLIC Renown derivation (S1.6.3 CRUX) — MUST NOT leak hidden VP.
//
// `@skervik/core` exports NO victory-point helper: its internal
// `computeVictoryPoints` (validate.ts) is not exported and INCLUDES hidden
// dev-card VP, and `PlayerState.victoryPoints` is the SAME hidden-inclusive
// total. Showing either in the players rail would leak an opponent's hidden
// VP dev cards to every other player. This module computes the PUBLIC
// projection instead: settlements + cities + awards only, reading award
// values from the exported `CLASSIC_VICTORY_PROFILE` (never hardcoded).
//
// Follow-up (recorded, not done here, per the S1.6.3 spec's "key decisions"):
// consider exporting a pure `publicVictoryPoints(state, playerId)` from
// `@skervik/core` so this display derivation is sourced from the rules core
// itself instead of mirrored client-side.

import type { GameState, PlayerId, ResourceType } from '@skervik/core';
import { CLASSIC_VICTORY_PROFILE } from '@skervik/core';

/**
 * Settlement/city point values — Classic constants that mirror
 * `@skervik/core`'s (unexported) `computeVictoryPoints`. Kept as a single
 * named object rather than inline magic numbers (rule-profile discipline,
 * `docs/specs/m1-vertical-slice/plan.md` §1).
 */
export const PUBLIC_RENOWN = {
  settlementVP: 1,
  cityVP: 2,
} as const;

/** Count of settlements owned by `playerId`. */
export function settlementCount(state: GameState, playerId: PlayerId): number {
  return Object.values(state.buildings?.settlements ?? {}).filter(
    (owner) => owner === playerId,
  ).length;
}

/** Count of cities owned by `playerId`. */
export function cityCount(state: GameState, playerId: PlayerId): number {
  return Object.values(state.buildings?.cities ?? {}).filter(
    (owner) => owner === playerId,
  ).length;
}

/**
 * `playerId`'s PUBLIC Renown: settlements + cities*2 + longest-road award (if
 * held) + largest-army award (if held). Safe to display for ANY player,
 * including opponents — never includes hidden dev-card VP.
 */
export function publicRenown(state: GameState, playerId: PlayerId): number {
  let renown = 0;
  renown += settlementCount(state, playerId) * PUBLIC_RENOWN.settlementVP;
  renown += cityCount(state, playerId) * PUBLIC_RENOWN.cityVP;
  if (state.longestRoadHolder === playerId) {
    renown += CLASSIC_VICTORY_PROFILE.longestRoadVP;
  }
  if (state.largestArmyHolder === playerId) {
    renown += CLASSIC_VICTORY_PROFILE.largestArmyVP;
  }
  return renown;
}

/**
 * The LOCAL player's own hidden victory-point dev-card count — safe ONLY for
 * `myPlayerId`'s own card (a player sees their own hand); NEVER call this
 * for another player's id, or it leaks exactly the information
 * {@link publicRenown} is designed to withhold.
 */
export function myHiddenVictoryPointCards(
  state: GameState,
  myPlayerId: PlayerId,
): number {
  return state.devCards?.[myPlayerId]?.held.victoryPoint ?? 0;
}

/** Total resource cards held — no core helper exists for this sum. */
export function handSize(resources: Readonly<Record<ResourceType, number>>): number {
  return Object.values(resources).reduce((sum, count) => sum + count, 0);
}
