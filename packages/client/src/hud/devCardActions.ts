// Pure gating for Ventures — buy + play (S2.8.5a) — the same discipline as
// `hud/discardActions.ts`: no React, no I/O, so "can I afford/play this" is
// unit-tested without a render. The SERVER (core `validate.ts`) is the sole
// authority; these mirror its dev-card rules ONLY as advisory UI affordances
// (gate button-enable, never block the dispatch pipeline). Core `validate` is
// NEVER called client-side (it needs the server-secret `seed`).
import type {
  DevCardHoldings,
  DevCardKind,
  GameState,
  PlayerId,
  ResourceType,
} from '@skervik/core';
import { CLASSIC_PROFILE } from '@skervik/core';

import { selectIsMyTurn } from './store.js';

/**
 * The Venture buy cost — imported from core rather than re-literalled: every
 * shipping/experimental `RuleProfile` spreads `CLASSIC_PROFILE.devCards`
 * unchanged (`ruleProfile.ts` — no profile overrides `buyCost`), so this
 * stays correct across profiles without a profile-lookup here.
 */
export const DEV_CARD_BUY_COST: Readonly<Record<ResourceType, number>> =
  CLASSIC_PROFILE.devCards.buyCost;

/**
 * The full Classic Venture deck size (25 cards) — the advisory default for
 * "remaining" before any `devCard.bought` event has landed on `GameState`
 * (`state.devDeckRemaining` is absent until the first buy). The server is
 * authoritative on `DECK_EMPTY` regardless of this default.
 */
const FULL_DECK_SIZE = CLASSIC_PROFILE.devCards.deck.length;

const EMPTY_HOLDINGS: DevCardHoldings = { held: {}, boughtThisTurn: {} };

/** `myPlayerId`'s Venture holdings, or the empty shape before any `devCards` entry exists. */
export function myHoldings(state: GameState, myPlayerId: PlayerId): DevCardHoldings {
  return state.devCards?.[myPlayerId] ?? EMPTY_HOLDINGS;
}

/**
 * How many of `kind` `myPlayerId` could legally PLAY this turn —
 * `held[kind] - boughtThisTurn[kind]`, clamped to >= 0 (a card bought this
 * turn is held but not yet playable, `validate.ts:1500-1502`).
 */
export function playableCount(
  state: GameState,
  myPlayerId: PlayerId,
  kind: DevCardKind,
): number {
  const holdings = myHoldings(state, myPlayerId);
  const held = holdings.held[kind] ?? 0;
  const boughtThisTurn = holdings.boughtThisTurn[kind] ?? 0;
  return Math.max(0, held - boughtThisTurn);
}

/**
 * Advisory mirror of `intent.buyDevCard`'s acceptance: main phase, my turn,
 * the given hand affords {@link DEV_CARD_BUY_COST}, and the (advisory) deck
 * isn't empty. Gates the «Купить предприятие» button only — the server
 * re-validates (`CANNOT_AFFORD` / `DECK_EMPTY`, `validate.ts:1455-1466`).
 */
export function canBuyDevCard(
  state: GameState,
  resources: Readonly<Partial<Record<ResourceType, number>>>,
  myPlayerId: PlayerId,
): boolean {
  if (state.phase !== 'main' || !selectIsMyTurn(state, myPlayerId)) return false;
  const affordable = Object.entries(DEV_CARD_BUY_COST).every(
    ([resource, amount]) => (resources[resource as ResourceType] ?? 0) >= amount,
  );
  if (!affordable) return false;
  const remaining = state.devDeckRemaining ?? FULL_DECK_SIZE;
  return remaining > 0;
}

/**
 * Advisory mirror of `intent.playDevCard`'s gating: main phase, my turn, no
 * Venture played yet this turn, and at least one playable copy of `kind`
 * (`validate.ts:1486-1503`). Kept general — correct for any {@link DevCardKind}
 * — even though S2.8.5a only wires a play action for `yearOfPlenty`/`monopoly`
 * in the panel (knight/roadBuilding are board-pick plays, S2.8.5b).
 */
export function canPlayVenture(
  state: GameState,
  myPlayerId: PlayerId,
  kind: DevCardKind,
): boolean {
  if (state.phase !== 'main' || !selectIsMyTurn(state, myPlayerId)) return false;
  if (state.devCardPlayedThisTurn) return false;
  return playableCount(state, myPlayerId, kind) > 0;
}
