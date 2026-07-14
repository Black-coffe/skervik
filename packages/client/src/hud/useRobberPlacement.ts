// S2.8.4a — the `robber`-phase orchestrator: turns a tile click (after a rolled
// 7 lands the mover in the `robber` phase with no discards outstanding) into an
// `intent.moveRobber`, with a two-step steal — pick a tile, then (if that tile
// has ≥1 eligible victim) pick the victim. Same shape as `useBuildPlacement.ts`:
// a pure derivation (`deriveRobberPlacement`) + pure resolvers
// (`resolveRobberTilePick`/`resolveVictimPick`), unit-tested WITHOUT a React
// render, with a thin hook wiring them to the live store + `dispatchIntent`.
//
// The discard-over-7 picker is S2.8.4b — this UI stays inert while
// `state.playersToDiscard` is non-empty (`intent.moveRobber` would be rejected
// `MUST_DISCARD_FIRST`). Knight-triggered robber moves are S2.8.5.

import type { GameState, MoveRobberIntent, PlayerId, TileId } from '@skervik/core';
import { buildTopology } from '@skervik/core';

import type { LegalTargets, Pick, PickMode } from '../board/BoardScene.js';
import { stealVictims } from '../board/robberLegality.js';
import { useUiStore } from './store.js';

// Board geometry never changes — computed once, cached module-level (same
// convention as `useSetupPlacement.ts`/`useBuildPlacement.ts`).
const TOPOLOGY = buildTopology();

/** What the robber prompt line should say (`hud/RobberPrompt.tsx` maps this to a `t()` key). */
export type RobberPrompt = 'moveRobber' | 'chooseVictim' | null;

export interface RobberPlacementView {
  readonly pickMode: PickMode;
  readonly legalTargets: LegalTargets | null;
  readonly prompt: RobberPrompt;
  /** The eligible steal victims — non-empty only while `prompt==='chooseVictim'`. */
  readonly victims: readonly PlayerId[];
}

const INACTIVE_VIEW: RobberPlacementView = {
  pickMode: 'none',
  legalTargets: null,
  prompt: null,
  victims: [],
};

/**
 * Derives the robber-phase pick UI from `gameState` + the UI-only
 * `pendingTileId` — pure, no store/React. Active ⇔ `phase==='robber'` AND it's
 * my turn AND NO discard is outstanding (`playersToDiscard` undefined/empty —
 * else `intent.moveRobber` would be `MUST_DISCARD_FIRST`, so we stay inert). When
 * active with no pending tile → arm TILE picking (`prompt:'moveRobber'`); with a
 * pending tile → pause board picking and show the victim picker
 * (`prompt:'chooseVictim'`). Tiles aren't a `setLegalTargets` kind, so
 * `legalTargets` is always `null` (highlight is the S2.8.1 hover ring only).
 */
export function deriveRobberPlacement(
  gameState: GameState,
  myPlayerId: PlayerId,
  pendingTileId: TileId | null,
): RobberPlacementView {
  if (gameState.phase !== 'robber') return INACTIVE_VIEW;
  if (gameState.currentPlayerId !== myPlayerId) return INACTIVE_VIEW;
  if (gameState.playersToDiscard && gameState.playersToDiscard.length > 0) {
    return INACTIVE_VIEW;
  }
  if (pendingTileId === null) {
    return { pickMode: 'tile', legalTargets: null, prompt: 'moveRobber', victims: [] };
  }
  return {
    pickMode: 'none',
    legalTargets: null,
    prompt: 'chooseVictim',
    victims: stealVictims(gameState, TOPOLOGY, pendingTileId, myPlayerId),
  };
}

/** The outcome of resolving a robber tile pick: dispatch now, or await a victim choice. */
export type RobberTilePickResult =
  { readonly dispatch: MoveRobberIntent } | { readonly pendingTile: TileId };

/**
 * Resolves a tile click: if the tile has 0 eligible victims, produce the
 * `moveRobber{tileId}` intent to dispatch immediately (a legal no-op steal);
 * otherwise signal to enter victim-choice with that tile pending. ADVISORY —
 * like `resolveBuildPick`, does NOT check `legalRobberTiles`; a same-tile click
 * still dispatches and the SERVER rejects it (`ROBBER_SAME_TILE` → `NoticeBar`).
 */
export function resolveRobberTilePick(
  state: GameState,
  topology: ReturnType<typeof buildTopology>,
  tileId: TileId,
  myPlayerId: PlayerId,
): RobberTilePickResult {
  const victims = stealVictims(state, topology, tileId, myPlayerId);
  if (victims.length === 0) {
    return { dispatch: { type: 'intent.moveRobber', playerId: myPlayerId, tileId } };
  }
  return { pendingTile: tileId };
}

/** Resolves a victim choice into the full `moveRobber{tileId, victimId}` intent. */
export function resolveVictimPick(
  pendingTileId: TileId,
  victimId: PlayerId,
  myPlayerId: PlayerId,
): MoveRobberIntent {
  return {
    type: 'intent.moveRobber',
    playerId: myPlayerId,
    tileId: pendingTileId,
    victimId,
  };
}

export interface UseRobberPlacementResult {
  readonly pickMode: PickMode;
  readonly legalTargets: LegalTargets | null;
  readonly prompt: RobberPrompt;
  readonly victims: readonly PlayerId[];
  readonly onPick: (pick: Pick) => void;
  readonly onChooseVictim: (victimId: PlayerId) => void;
  readonly onCancelVictim: () => void;
}

/**
 * Wires the pure derive/resolvers to the live store for `GameScreen.tsx`. The
 * UI-only `robberPendingTile` lives in the STORE (not component state) so it
 * survives `GameScreen`'s phase re-routing between board picking and the victim
 * picker; it's cleared after any dispatch and on «Отмена». `onPick` ignores a
 * non-tile pick (defensive — board picking is armed to `'tile'` here).
 */
export function useRobberPlacement(): UseRobberPlacementResult {
  const gameState = useUiStore((state) => state.gameState);
  const myPlayerId = useUiStore((state) => state.myPlayerId);
  const dispatchIntent = useUiStore((state) => state.dispatchIntent);
  const robberPendingTile = useUiStore((state) => state.robberPendingTile);
  const setRobberPendingTile = useUiStore((state) => state.setRobberPendingTile);

  const view = deriveRobberPlacement(gameState, myPlayerId, robberPendingTile);

  return {
    pickMode: view.pickMode,
    legalTargets: view.legalTargets,
    prompt: view.prompt,
    victims: view.victims,
    onPick: (pick) => {
      if (pick.kind !== 'tile') return;
      const result = resolveRobberTilePick(gameState, TOPOLOGY, pick.id, myPlayerId);
      if ('dispatch' in result) {
        dispatchIntent(result.dispatch);
        setRobberPendingTile(null);
      } else {
        setRobberPendingTile(result.pendingTile);
      }
    },
    onChooseVictim: (victimId) => {
      if (robberPendingTile === null) return;
      dispatchIntent(resolveVictimPick(robberPendingTile, victimId, myPlayerId));
      setRobberPendingTile(null);
    },
    onCancelVictim: () => setRobberPendingTile(null),
  };
}
