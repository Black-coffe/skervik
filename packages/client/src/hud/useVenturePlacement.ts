// S2.8.5b — the `main`-phase Venture board-pick orchestrator: turns board
// clicks into `intent.playDevCard` dispatches for the two Ventures that
// HIJACK a board pick — Конвой (knight, tile+optional victim, the SAME
// resolution as `useRobberPlacement`'s `moveRobber`) and Попутный ветер
// (road-building, up to 2 free road edges). Armed by `VenturePanel`'s
// «Разыграть» via the UI-only `venturePlayMode` (`hud/store.ts`), and — while
// armed — OVERRIDES the phase-driven build picker (`GameScreen.tsx`). Same
// shape as the sibling hooks: a pure derivation (`deriveVenturePlacement`) +
// pure resolvers, unit-tested WITHOUT a React render, with a thin hook wiring
// them to the live store.
//
// Knight is exposed `main`-phase only this story (Core also allows it in
// `'roll'`, but the Venture panel only opens in `main` — see the story's
// scope note; pre-roll knight is a deferred follow-up).

import type {
  BoardTopology,
  EdgeId,
  GameState,
  PlayerId,
  PlayKnightIntent,
  PlayRoadBuildingIntent,
  TileId,
} from '@skervik/core';

import type { LegalTargets, Pick, PickMode } from '../board/BoardScene.js';
import { legalBuildRoads } from '../board/buildLegality.js';
import { useMatchTopology } from '../board/matchTopology.js';
import { stealVictims } from '../board/robberLegality.js';
import { useUiStore } from './store.js';

/** The UI-only armed-play submode (mirrors `hud/store.ts`'s `venturePlayMode`). */
export type VenturePlayMode = 'none' | 'knight' | 'roadBuilding';

/** What the venture prompt line should say (`GameScreen.tsx` maps this to a `t()` key). */
export type VenturePrompt =
  'knightMove' | 'knightChooseVictim' | 'roadBuildingFirst' | 'roadBuildingSecond' | null;

export interface VenturePlacementView {
  /** `true` while a Venture board-pick play is armed AND legal to continue. */
  readonly active: boolean;
  readonly pickMode: PickMode;
  readonly legalTargets: LegalTargets | null;
  readonly prompt: VenturePrompt;
  /** The eligible knight steal victims — non-empty only while `prompt==='knightChooseVictim'`. */
  readonly victims: readonly PlayerId[];
}

const INACTIVE_VIEW: VenturePlacementView = {
  active: false,
  pickMode: 'none',
  legalTargets: null,
  prompt: null,
  victims: [],
};

/**
 * Derives the Venture board-pick UI from `gameState` + the UI-only armed
 * `venturePlayMode`/`knightPendingTile`/`roadBuildingEdges` — pure, no
 * store/React. Inactive unless a play is armed (`venturePlayMode!=='none'`)
 * AND it's still legal to continue (`phase==='main'`, my turn, no Venture
 * played yet this turn — defensive; the store's fold-clear should already
 * cover a stale arm, see `hud/store.ts`'s `applyEventBatch`).
 *
 * Knight mirrors `deriveRobberPlacement`: no pending tile → arm tile picking
 * (`knightMove`); a pending tile with ≥1 eligible victim → the victim picker
 * (`knightChooseVictim`); a pending tile with 0 victims (a stale leftover or
 * a board change mid-choice) self-heals back to tile-picking rather than
 * rendering an empty picker (DESIGN.md §6).
 *
 * Road-building highlights `legalBuildRoads` for the CURRENT state — it does
 * NOT simulate the first pending edge into the player's network, so an edge
 * reachable ONLY via that pending edge may not highlight; the human can
 * still click it and the server's tolerant `roadBuilding` branch
 * (`validate.ts:1554-1588`) accepts it regardless (advisory highlight only).
 * `pickMode` drops to `'none'` once 2 edges are picked (the cap) — the
 * confirm bar takes over from there.
 */
export function deriveVenturePlacement(
  gameState: GameState,
  topology: BoardTopology,
  myPlayerId: PlayerId,
  venturePlayMode: VenturePlayMode,
  knightPendingTile: TileId | null,
  roadBuildingEdges: readonly EdgeId[],
): VenturePlacementView {
  if (venturePlayMode === 'none') return INACTIVE_VIEW;
  if (gameState.phase !== 'main') return INACTIVE_VIEW;
  if (gameState.currentPlayerId !== myPlayerId) return INACTIVE_VIEW;
  if (gameState.devCardPlayedThisTurn) return INACTIVE_VIEW;

  if (venturePlayMode === 'knight') {
    if (knightPendingTile !== null) {
      const victims = stealVictims(gameState, topology, knightPendingTile, myPlayerId);
      if (victims.length > 0) {
        return {
          active: true,
          pickMode: 'none',
          legalTargets: null,
          prompt: 'knightChooseVictim',
          victims,
        };
      }
      // Self-heal (S2.8.4a review nit, mirrored here): fall through to tile-picking.
    }
    return {
      active: true,
      pickMode: 'tile',
      legalTargets: null,
      prompt: 'knightMove',
      victims: [],
    };
  }

  // roadBuilding
  if (roadBuildingEdges.length >= 2) {
    return {
      active: true,
      pickMode: 'none',
      legalTargets: null,
      prompt: null,
      victims: [],
    };
  }
  const legalTargets: LegalTargets = {
    kind: 'edge',
    ids: legalBuildRoads(gameState, topology, myPlayerId),
  };
  const prompt: VenturePrompt =
    roadBuildingEdges.length === 0 ? 'roadBuildingFirst' : 'roadBuildingSecond';
  return { active: true, pickMode: 'edge', legalTargets, prompt, victims: [] };
}

/** The outcome of resolving a knight tile pick: dispatch now, or await a victim choice. */
export type KnightTilePickResult =
  { readonly dispatch: PlayKnightIntent } | { readonly pendingTile: TileId };

/**
 * Resolves a knight tile click: if the tile has 0 eligible victims, produce
 * the `playDevCard{card:'knight',tileId}` intent to dispatch immediately (a
 * legal no-op steal); otherwise signal to enter victim-choice with that tile
 * pending. ADVISORY — like `resolveRobberTilePick`, does NOT check
 * `legalRobberTiles`; a same-tile click still dispatches and the SERVER
 * rejects it (`ROBBER_SAME_TILE` → `NoticeBar`).
 */
export function resolveKnightTilePick(
  state: GameState,
  topology: BoardTopology,
  tileId: TileId,
  myPlayerId: PlayerId,
): KnightTilePickResult {
  const victims = stealVictims(state, topology, tileId, myPlayerId);
  if (victims.length === 0) {
    return {
      dispatch: {
        type: 'intent.playDevCard',
        playerId: myPlayerId,
        card: 'knight',
        tileId,
      },
    };
  }
  return { pendingTile: tileId };
}

/** Resolves a knight victim choice into the full `playDevCard{card:'knight',tileId,victimId}` intent. */
export function resolveKnightVictimPick(
  pendingTileId: TileId,
  victimId: PlayerId,
  myPlayerId: PlayerId,
): PlayKnightIntent {
  return {
    type: 'intent.playDevCard',
    playerId: myPlayerId,
    card: 'knight',
    tileId: pendingTileId,
    victimId,
  };
}

/**
 * Appends an edge pick to the road-building selection: deduped (re-clicking
 * an already-picked edge is a no-op) and capped at 2 (a 3rd click is
 * ignored) — pure, so it's directly unit-testable.
 */
export function appendRoadBuildingEdge(
  edges: readonly EdgeId[],
  edgeId: EdgeId,
): readonly EdgeId[] {
  if (edges.includes(edgeId)) return edges;
  if (edges.length >= 2) return edges;
  return [...edges, edgeId];
}

/**
 * Builds the `playDevCard{card:'roadBuilding',edgeIds}` intent from the
 * picked edges (1 or 2 — the core is tolerant and sometimes only 1 edge is
 * legal, `validate.ts:1554-1588`).
 */
export function buildRoadBuildingIntent(
  edges: readonly EdgeId[],
  myPlayerId: PlayerId,
): PlayRoadBuildingIntent {
  return {
    type: 'intent.playDevCard',
    playerId: myPlayerId,
    card: 'roadBuilding',
    edgeIds: edges,
  };
}

export interface UseVenturePlacementResult {
  readonly active: boolean;
  readonly pickMode: PickMode;
  readonly legalTargets: LegalTargets | null;
  readonly prompt: VenturePrompt;
  readonly victims: readonly PlayerId[];
  /** The number of edges picked so far for an armed road-building play (drives the confirm bar). */
  readonly roadBuildingCount: number;
  readonly onPick: (pick: Pick) => void;
  readonly onChooseVictim: (victimId: PlayerId) => void;
  readonly onCancelVictim: () => void;
  readonly onConfirmRoadBuilding: () => void;
  readonly onCancelRoadBuilding: () => void;
}

/**
 * Wires the pure derive/resolvers to the live store for `GameScreen.tsx`.
 * The UI-only `knightPendingTile`/`roadBuildingEdges` live in the STORE (not
 * component state) — same reasoning as `robberPendingTile`. `onPick` ignores
 * a pick kind that doesn't match the active submode (defensive — board
 * picking is armed to the matching `pickMode` here). After ANY dispatch, the
 * whole armed play is cleared IMMEDIATELY (like `useBuildPlacement`'s
 * `setBuildMode('none')`) — the store's fold-based clear (`hud/store.ts`) is
 * the safety net, not the primary path.
 */
export function useVenturePlacement(): UseVenturePlacementResult {
  const gameState = useUiStore((state) => state.gameState);
  const myPlayerId = useUiStore((state) => state.myPlayerId);
  const dispatchIntent = useUiStore((state) => state.dispatchIntent);
  const venturePlayMode = useUiStore((state) => state.venturePlayMode);
  const setVenturePlayMode = useUiStore((state) => state.setVenturePlayMode);
  const knightPendingTile = useUiStore((state) => state.knightPendingTile);
  const setKnightPendingTile = useUiStore((state) => state.setKnightPendingTile);
  const roadBuildingEdges = useUiStore((state) => state.roadBuildingEdges);
  const setRoadBuildingEdges = useUiStore((state) => state.setRoadBuildingEdges);
  const topology = useMatchTopology();

  const view = deriveVenturePlacement(
    gameState,
    topology,
    myPlayerId,
    venturePlayMode,
    knightPendingTile,
    roadBuildingEdges,
  );

  function clearVenturePlay(): void {
    setVenturePlayMode('none');
    setKnightPendingTile(null);
    setRoadBuildingEdges([]);
  }

  return {
    active: view.active,
    pickMode: view.pickMode,
    legalTargets: view.legalTargets,
    prompt: view.prompt,
    victims: view.victims,
    roadBuildingCount: roadBuildingEdges.length,
    onPick: (pick) => {
      if (venturePlayMode === 'knight') {
        if (pick.kind !== 'tile') return;
        const result = resolveKnightTilePick(gameState, topology, pick.id, myPlayerId);
        if ('dispatch' in result) {
          dispatchIntent(result.dispatch);
          clearVenturePlay();
        } else {
          setKnightPendingTile(result.pendingTile);
        }
        return;
      }
      if (venturePlayMode === 'roadBuilding') {
        if (pick.kind !== 'edge') return;
        setRoadBuildingEdges(appendRoadBuildingEdge(roadBuildingEdges, pick.id));
      }
    },
    onChooseVictim: (victimId) => {
      if (knightPendingTile === null) return;
      dispatchIntent(resolveKnightVictimPick(knightPendingTile, victimId, myPlayerId));
      clearVenturePlay();
    },
    onCancelVictim: () => setKnightPendingTile(null),
    onConfirmRoadBuilding: () => {
      if (roadBuildingEdges.length === 0) return;
      dispatchIntent(buildRoadBuildingIntent(roadBuildingEdges, myPlayerId));
      clearVenturePlay();
    },
    onCancelRoadBuilding: () => clearVenturePlay(),
  };
}
