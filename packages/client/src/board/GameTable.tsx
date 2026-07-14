// React shell for "The Chart" (DESIGN.md §1) — mounts the Pixi board scene
// for a given `GameState`, owning its lifecycle (create on mount, destroy
// on unmount). Tile field + tokens + robber + sea + pan/zoom + ambient mist
// (S1.6.1) plus settlements/cities/roads/ports (S1.6.2) — all static render,
// no interactivity (that's the play-loop stories).

import type { GameState } from '@skervik/core';
import { buildTopology } from '@skervik/core';
import { useEffect, useRef, useState } from 'react';

import { PickDemoControls } from '../dev/PickDemoControls.js';
import { buildTileDescriptors } from './boardModel.js';
import type { BoardSceneHandle, LegalTargets, Pick, PickMode } from './BoardScene.js';
import { createBoardScene } from './BoardScene.js';
import { buildBuildingDescriptors, buildPortDescriptors } from './pieceModel.js';

// Board geometry never changes — computed once, cached module-level
// (per S1.6.1 spec: "call once, cache").
const TOPOLOGY = buildTopology();

export interface GameTableProps {
  readonly state: GameState;
  /** S2.7.1: true while the trade dock is shown (`main` phase only) — the board offsets right so no tile sits under it. */
  readonly dockVisible: boolean;
  /**
   * S2.8.1: `'none'` (the default, and what happens when this prop is
   * omitted) — zero interaction, board behaves exactly as pre-S2.8.1. Real
   * game-loop wiring (place/build/move-robber) lands in S2.8.2+.
   */
  readonly pickMode?: PickMode;
  /** S2.8.1: fires on a genuine click (not a pan drag) that resolves to a real vertex/edge/tile under the current `pickMode`. */
  readonly onPick?: (pick: Pick) => void;
  /**
   * S2.8.2: a persistent set of vertex/edge ids to highlight as legal
   * targets (e.g. setup-phase placement hints) — `undefined`/`null` (the
   * default) draws nothing. Advisory only; the scene never gates `onPick` on
   * this set (see `board/setupLegality.ts`).
   */
  readonly legalTargets?: LegalTargets | null;
}

export function GameTable({
  state,
  dockVisible,
  pickMode,
  onPick,
  legalTargets,
}: GameTableProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BoardSceneHandle | null>(null);
  // S2.7.1: read the LATEST `dockVisible` from inside the scene-creation
  // effect below without adding it to that effect's deps — a ref, not state,
  // so a dock toggle never remounts the Pixi scene (loses pan/zoom, flickers).
  const dockVisibleRef = useRef(dockVisible);
  dockVisibleRef.current = dockVisible;

  // S2.8.1: dev-only picking harness — active only when NO real pickMode
  // prop is supplied (undefined), so a future story's real wiring always
  // takes precedence and the two never fight over the scene's pick mode.
  const isDevHarnessEligible = import.meta.env.DEV && pickMode === undefined;
  const [devPickMode, setDevPickMode] = useState<PickMode>('none');
  const [devLastPick, setDevLastPick] = useState<Pick | null>(null);
  const effectivePickMode: PickMode =
    pickMode ?? (isDevHarnessEligible ? devPickMode : 'none');
  const effectiveOnPick = onPick ?? (isDevHarnessEligible ? setDevLastPick : undefined);

  // S2.8.1: same ref pattern as `dockVisibleRef` — `pickMode`/`onPick` must
  // be readable from inside the scene-creation effect without joining its
  // deps (a mode/callback change must never remount the scene).
  const pickModeRef = useRef(effectivePickMode);
  pickModeRef.current = effectivePickMode;
  const onPickRef = useRef(effectiveOnPick);
  onPickRef.current = effectiveOnPick;

  // S2.8.2: same ref pattern — a `legalTargets` change must never remount
  // the scene either.
  const legalTargetsRef = useRef(legalTargets ?? null);
  legalTargetsRef.current = legalTargets ?? null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let destroyScene: (() => void) | undefined;

    const descriptors = buildTileDescriptors(TOPOLOGY, state.board);
    const seatOrder = state.playerOrder ?? state.players.map((p) => p.id);
    const buildings = buildBuildingDescriptors(TOPOLOGY, state.buildings, seatOrder);
    const ports = buildPortDescriptors(TOPOLOGY, state.board);
    void createBoardScene(host, TOPOLOGY, descriptors, buildings, ports).then((scene) => {
      if (cancelled) {
        scene.destroy();
        return;
      }
      // Apply whatever dockVisible/pickMode is current NOW (may have changed
      // while this scene was still loading) before it's ever painted.
      scene.setDockVisible(dockVisibleRef.current);
      scene.setPickMode(pickModeRef.current);
      scene.setLegalTargets(legalTargetsRef.current);
      // The wrapper reads the ref on every call, so a changing `onPick`
      // never needs to re-register — this one binding lasts the scene's life.
      scene.onPick((pick) => onPickRef.current?.(pick));
      sceneRef.current = scene;
      destroyScene = scene.destroy;
    });

    return () => {
      cancelled = true;
      sceneRef.current = null;
      destroyScene?.();
    };
  }, [state.board, state.buildings, state.playerOrder, state.players]);

  // S2.7.1: react to the dock showing/hiding by repositioning the EXISTING
  // scene's world container (see BoardScene.setDockVisible) — no remount.
  useEffect(() => {
    sceneRef.current?.setDockVisible(dockVisible);
  }, [dockVisible]);

  // S2.8.1: react to the pick mode changing by re-arming the EXISTING
  // scene — no remount.
  useEffect(() => {
    sceneRef.current?.setPickMode(effectivePickMode);
  }, [effectivePickMode]);

  // S2.8.2: react to the legal-target set changing by redrawing the
  // EXISTING scene's persistent layer — no remount.
  useEffect(() => {
    sceneRef.current?.setLegalTargets(legalTargets ?? null);
  }, [legalTargets]);

  return (
    <>
      <div
        ref={hostRef}
        style={{ position: 'relative', width: '100%', height: '100%' }}
      />
      {isDevHarnessEligible ? (
        <PickDemoControls
          pickMode={devPickMode}
          onPickModeChange={setDevPickMode}
          lastPick={devLastPick}
        />
      ) : null}
    </>
  );
}
