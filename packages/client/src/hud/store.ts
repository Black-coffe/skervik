// UI-state store (S1.6.3) — zustand, this story's sanctioned new dependency.
// Holds the CURRENT `GameState` (the dev fixture for now — no WS until
// S1.6.5) plus `myPlayerId`, a DEV CONSTANT until S1.6.5 wires real auth/
// join. The store never invents state: `gameState` always comes from
// core/fixture (and later the WS client); this file only holds a reference
// to it plus tiny derived selectors components read.

import type { GameState, PlayerId } from '@skervik/core';
import { create } from 'zustand';

import { devFixtureState } from '../dev/devFixture.js';

export interface UiStore {
  readonly gameState: GameState;
  readonly myPlayerId: PlayerId;
  readonly setGameState: (next: GameState) => void;
}

/**
 * `myPlayerId` is a DEV CONSTANT (key decision 1, S1.6.3 spec): the first
 * seat in the fixed seating order, falling back to the first `players`
 * entry the same way `GameTable`/`flotillaColors.ts` already do. S1.6.5
 * (auth/join) replaces this with the real joined player's id.
 */
const DEV_MY_PLAYER_ID: PlayerId =
  devFixtureState.playerOrder?.[0] ?? devFixtureState.players[0]?.id ?? '';

export const useUiStore = create<UiStore>((set) => ({
  gameState: devFixtureState,
  myPlayerId: DEV_MY_PLAYER_ID,
  setGameState: (next) => set({ gameState: next }),
}));

/** Stable seat order for the current `gameState` — never reorder mid-match (DESIGN.md §6). */
export function selectSeatOrder(state: GameState): readonly PlayerId[] {
  return state.playerOrder ?? state.players.map((p) => p.id);
}

/** `true` when it's `myPlayerId`'s turn to act. */
export function selectIsMyTurn(state: GameState, myPlayerId: PlayerId): boolean {
  return state.currentPlayerId === myPlayerId;
}
