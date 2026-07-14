// S2.8.3b — the MAIN-phase build orchestrator: turns board clicks into
// `intent.buildSettlement`/`intent.buildRoad`/`intent.buildCity` dispatches,
// driven by the UI-only `buildMode` submode (`hud/store.ts`) + the live
// `gameState`. Same shape as S2.8.2's `useSetupPlacement`: a pure derivation
// (`deriveBuildPlacement`) + a pure resolver (`resolveBuildPick`), unit-tested
// WITHOUT a React render, with a thin hook wiring them to the live store.

import type { GameState, PlayerId, PlayerIntent } from '@skervik/core';
import { buildTopology } from '@skervik/core';

import type { LegalTargets, Pick, PickMode } from '../board/BoardScene.js';
import type { BuildMode } from '../board/buildLegality.js';
import {
  legalBuildCities,
  legalBuildRoads,
  legalBuildSettlements,
} from '../board/buildLegality.js';
import { useUiStore } from './store.js';

// Board geometry never changes — computed once, cached module-level (same
// convention as `useSetupPlacement.ts`'s `TOPOLOGY`).
const TOPOLOGY = buildTopology();

/** What the build-prompt line should say (mapped to a `t()` key in `GameScreen.tsx`). */
export type BuildPrompt = 'buildSettlement' | 'buildRoad' | 'buildCity' | null;

export interface BuildPlacementView {
  readonly pickMode: PickMode;
  readonly legalTargets: LegalTargets | null;
  readonly prompt: BuildPrompt;
}

const INACTIVE_VIEW: BuildPlacementView = {
  pickMode: 'none',
  legalTargets: null,
  prompt: null,
};

/**
 * Derives the main-phase pick UI from `gameState` + the active `buildMode` —
 * pure, no store/React. Inactive unless `phase==='main'`, it's my turn, AND a
 * build submode is armed (`buildMode !== 'none'`). Settlement and city are both
 * vertex picks; the pick is disambiguated by `buildMode` in `resolveBuildPick`.
 */
export function deriveBuildPlacement(
  gameState: GameState,
  myPlayerId: PlayerId,
  buildMode: BuildMode,
): BuildPlacementView {
  if (gameState.phase !== 'main') return INACTIVE_VIEW;
  if (gameState.currentPlayerId !== myPlayerId) return INACTIVE_VIEW;
  if (buildMode === 'settlement') {
    return {
      pickMode: 'vertex',
      legalTargets: {
        kind: 'vertex',
        ids: legalBuildSettlements(gameState, TOPOLOGY, myPlayerId),
      },
      prompt: 'buildSettlement',
    };
  }
  if (buildMode === 'road') {
    return {
      pickMode: 'edge',
      legalTargets: {
        kind: 'edge',
        ids: legalBuildRoads(gameState, TOPOLOGY, myPlayerId),
      },
      prompt: 'buildRoad',
    };
  }
  if (buildMode === 'city') {
    return {
      pickMode: 'vertex',
      legalTargets: { kind: 'vertex', ids: legalBuildCities(gameState, myPlayerId) },
      prompt: 'buildCity',
    };
  }
  return INACTIVE_VIEW;
}

/**
 * Resolves a board click into the build intent it should dispatch, or `null` if
 * the pick's kind doesn't match the armed `buildMode`. ADVISORY only — like
 * `resolveSetupPick`, deliberately does NOT check `legalTargets`; every resolved
 * pick is dispatched and left to the SERVER's `validate` (existing `NoticeBar`
 * reject UX), so a client/server legality drift can never lock out a legal move.
 */
export function resolveBuildPick(
  buildMode: BuildMode,
  pick: Pick,
  myPlayerId: PlayerId,
): PlayerIntent | null {
  if (buildMode === 'settlement' && pick.kind === 'vertex') {
    return { type: 'intent.buildSettlement', playerId: myPlayerId, vertexId: pick.id };
  }
  if (buildMode === 'city' && pick.kind === 'vertex') {
    return { type: 'intent.buildCity', playerId: myPlayerId, vertexId: pick.id };
  }
  if (buildMode === 'road' && pick.kind === 'edge') {
    return { type: 'intent.buildRoad', playerId: myPlayerId, edgeId: pick.id };
  }
  return null;
}

export interface UseBuildPlacementResult {
  readonly pickMode: PickMode;
  readonly legalTargets: LegalTargets | null;
  readonly prompt: BuildPrompt;
  readonly onPick: (pick: Pick) => void;
}

/**
 * Wires `deriveBuildPlacement`/`resolveBuildPick` to the live store for
 * `GameScreen.tsx`. `onPick` dispatches through the generic `dispatchIntent`
 * seam, then EXITS the submode (`setBuildMode('none')`) so the next build is a
 * deliberate re-entry (avoids accidental double-placement). Note: the board
 * scene currently REMOUNTS on each build (the pre-existing F-remount follow-up,
 * out of scope here) — the camera resets after every placement.
 */
export function useBuildPlacement(): UseBuildPlacementResult {
  const gameState = useUiStore((state) => state.gameState);
  const myPlayerId = useUiStore((state) => state.myPlayerId);
  const buildMode = useUiStore((state) => state.buildMode);
  const dispatchIntent = useUiStore((state) => state.dispatchIntent);
  const setBuildMode = useUiStore((state) => state.setBuildMode);

  const view = deriveBuildPlacement(gameState, myPlayerId, buildMode);

  return {
    pickMode: view.pickMode,
    legalTargets: view.legalTargets,
    prompt: view.prompt,
    onPick: (pick) => {
      const intent = resolveBuildPick(buildMode, pick, myPlayerId);
      if (intent !== null) {
        dispatchIntent(intent);
        setBuildMode('none');
      }
    },
  };
}
