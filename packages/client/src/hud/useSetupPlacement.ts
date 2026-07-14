// S2.8.2 — the setup-phase placement orchestrator: turns board clicks into
// `intent.placeSettlement`/`intent.placeRoad` dispatches, driven by
// `state.currentPlayerId`/`state.pendingRoadVertexId` (`packages/core`
// `types.ts:176/233`). Split into a pure derivation (`deriveSetupPlacement`)
// + a pure resolver (`resolveSetupPick`), unit-tested directly WITHOUT a
// React render — the same split as `lobbyStore.ts`'s `deriveLobbyViewState`
// (zustand v5's static-render snapshot can never observe a later
// `setState()`, see that file's doc comment) — with a thin hook on top that
// wires them to the live store.

import type { GameState, PlayerId, PlayerIntent } from '@skervik/core';
import { buildTopology } from '@skervik/core';

import type { LegalTargets, Pick, PickMode } from '../board/BoardScene.js';
import { legalSetupRoads, legalSetupSettlements } from '../board/setupLegality.js';
import { useUiStore } from './store.js';

// Board geometry never changes — computed once, cached module-level (same
// convention as `board/GameTable.tsx`'s `TOPOLOGY`).
const TOPOLOGY = buildTopology();

/** What the turn-prompt status line should say (`hud/SetupPrompt.tsx` maps this to a `t()` key). */
export type SetupPrompt = 'placeSettlement' | 'placeRoad' | 'opponentTurn' | null;

export interface SetupPlacementView {
  readonly pickMode: PickMode;
  readonly legalTargets: LegalTargets | null;
  readonly prompt: SetupPrompt;
}

const INACTIVE_VIEW: SetupPlacementView = {
  pickMode: 'none',
  legalTargets: null,
  prompt: null,
};

/**
 * Derives the setup-phase pick UI from `gameState` — pure, no store/React.
 * `active` ⇔ `phase==='setup' && currentPlayerId===myPlayerId` (the story's
 * exact local-turn test).
 */
export function deriveSetupPlacement(
  gameState: GameState,
  myPlayerId: PlayerId,
): SetupPlacementView {
  if (gameState.phase !== 'setup') return INACTIVE_VIEW;
  if (gameState.currentPlayerId !== myPlayerId) {
    return { pickMode: 'none', legalTargets: null, prompt: 'opponentTurn' };
  }
  if (gameState.pendingRoadVertexId === undefined) {
    return {
      pickMode: 'vertex',
      legalTargets: { kind: 'vertex', ids: legalSetupSettlements(gameState, TOPOLOGY) },
      prompt: 'placeSettlement',
    };
  }
  return {
    pickMode: 'edge',
    legalTargets: {
      kind: 'edge',
      ids: legalSetupRoads(gameState, TOPOLOGY, gameState.pendingRoadVertexId),
    },
    prompt: 'placeRoad',
  };
}

/**
 * Resolves a board click into the intent it should dispatch, or `null` if
 * the pick's kind doesn't match what's currently expected (e.g. a stray edge
 * pick while a settlement is expected). ADVISORY only — deliberately does
 * NOT check `view.legalTargets`; every resolved pick is dispatched as-is and
 * left to the SERVER's `validate` to accept/reject (existing `NoticeBar`
 * reject UX), so a client/server legality drift can never lock out a legal
 * move (the story's Constraints).
 */
export function resolveSetupPick(
  view: SetupPlacementView,
  pick: Pick,
  myPlayerId: PlayerId,
): PlayerIntent | null {
  if (view.pickMode === 'vertex' && pick.kind === 'vertex') {
    return { type: 'intent.placeSettlement', playerId: myPlayerId, vertexId: pick.id };
  }
  if (view.pickMode === 'edge' && pick.kind === 'edge') {
    return { type: 'intent.placeRoad', playerId: myPlayerId, edgeId: pick.id };
  }
  return null;
}

export interface UseSetupPlacementResult {
  readonly pickMode: PickMode;
  readonly legalTargets: LegalTargets | null;
  readonly prompt: SetupPrompt;
  readonly onPick: (pick: Pick) => void;
}

/**
 * Wires `deriveSetupPlacement`/`resolveSetupPick` to the live store
 * (`hud/store.ts`) for `GameScreen.tsx`. `onPick` dispatches through the
 * existing `dispatchIntent` seam — the same generic send path Trade UI uses.
 */
export function useSetupPlacement(): UseSetupPlacementResult {
  const gameState = useUiStore((state) => state.gameState);
  const myPlayerId = useUiStore((state) => state.myPlayerId);
  const dispatchIntent = useUiStore((state) => state.dispatchIntent);

  const view = deriveSetupPlacement(gameState, myPlayerId);

  return {
    pickMode: view.pickMode,
    legalTargets: view.legalTargets,
    prompt: view.prompt,
    onPick: (pick) => {
      const intent = resolveSetupPick(view, pick, myPlayerId);
      if (intent !== null) dispatchIntent(intent);
    },
  };
}
