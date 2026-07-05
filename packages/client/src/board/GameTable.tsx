// React shell for "The Chart" (DESIGN.md §1) — mounts the Pixi board scene
// for a given `GameState`, owning its lifecycle (create on mount, destroy
// on unmount). No settlements/roads/ports yet (S1.6.2); tile field + tokens
// + robber + sea + pan/zoom + ambient mist only (S1.6.1 scope).

import type { GameState } from '@skervik/core';
import { buildTopology } from '@skervik/core';
import { useEffect, useRef } from 'react';

import { buildTileDescriptors } from './boardModel.js';
import { createBoardScene } from './BoardScene.js';

// Board geometry never changes — computed once, cached module-level
// (per S1.6.1 spec: "call once, cache").
const TOPOLOGY = buildTopology();

export interface GameTableProps {
  readonly state: GameState;
}

export function GameTable({ state }: GameTableProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let destroyScene: (() => void) | undefined;

    const descriptors = buildTileDescriptors(TOPOLOGY, state.board);
    void createBoardScene(host, descriptors).then((scene) => {
      if (cancelled) {
        scene.destroy();
        return;
      }
      destroyScene = scene.destroy;
    });

    return () => {
      cancelled = true;
      destroyScene?.();
    };
  }, [state.board]);

  return (
    <div
      ref={hostRef}
      style={{ position: 'relative', width: '100vw', height: '100vh' }}
    />
  );
}
