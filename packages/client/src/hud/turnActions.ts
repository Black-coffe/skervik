// Pure gating for the two resource-free turn actions (S2.8.3a): rolling the
// dice (phase `roll`) and ending the turn (phase `main`), both further gated
// to the current player only. Kept out of `BottomDeck.tsx` so the gating
// logic is unit-tested without a React render, same split as `phase.ts`.
import type { GameState, PlayerId } from '@skervik/core';

import { selectIsMyTurn } from './store.js';

/** `true` when `myPlayerId` may dispatch `intent.rollDice` right now. */
export function canRoll(state: GameState, myPlayerId: PlayerId): boolean {
  return state.phase === 'roll' && selectIsMyTurn(state, myPlayerId);
}

/** `true` when `myPlayerId` may dispatch `intent.endTurn` right now. */
export function canEndTurn(state: GameState, myPlayerId: PlayerId): boolean {
  return state.phase === 'main' && selectIsMyTurn(state, myPlayerId);
}
