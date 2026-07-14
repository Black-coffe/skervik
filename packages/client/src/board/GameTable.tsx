// React shell for "The Chart" (DESIGN.md §1) — mounts the Pixi board scene
// for a given `GameState`, owning its lifecycle (create on mount, destroy
// on unmount). Tile field + tokens + robber + sea + pan/zoom + ambient mist
// (S1.6.1) plus settlements/cities/roads/ports (S1.6.2) — all static render,
// no interactivity (that's the play-loop stories).

import type { GameState } from '@skervik/core';
import { buildTopology } from '@skervik/core';
import { useEffect, useRef } from 'react';

import { buildTileDescriptors } from './boardModel.js';
import type { BoardSceneHandle } from './BoardScene.js';
import { createBoardScene } from './BoardScene.js';
import { buildBuildingDescriptors, buildPortDescriptors } from './pieceModel.js';

// Board geometry never changes — computed once, cached module-level
// (per S1.6.1 spec: "call once, cache").
const TOPOLOGY = buildTopology();

export interface GameTableProps {
  readonly state: GameState;
  /** S2.7.1: true while the trade dock is shown (`main` phase only) — the board offsets right so no tile sits under it. */
  readonly dockVisible: boolean;
}

export function GameTable({ state, dockVisible }: GameTableProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BoardSceneHandle | null>(null);
  // S2.7.1: read the LATEST `dockVisible` from inside the scene-creation
  // effect below without adding it to that effect's deps — a ref, not state,
  // so a dock toggle never remounts the Pixi scene (loses pan/zoom, flickers).
  const dockVisibleRef = useRef(dockVisible);
  dockVisibleRef.current = dockVisible;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let destroyScene: (() => void) | undefined;

    const descriptors = buildTileDescriptors(TOPOLOGY, state.board);
    const seatOrder = state.playerOrder ?? state.players.map((p) => p.id);
    const buildings = buildBuildingDescriptors(TOPOLOGY, state.buildings, seatOrder);
    const ports = buildPortDescriptors(TOPOLOGY, state.board);
    void createBoardScene(host, descriptors, buildings, ports).then((scene) => {
      if (cancelled) {
        scene.destroy();
        return;
      }
      // Apply whatever dockVisible is current NOW (may have changed while
      // this scene was still loading) before it's ever painted.
      scene.setDockVisible(dockVisibleRef.current);
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

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: '100%' }} />
  );
}
