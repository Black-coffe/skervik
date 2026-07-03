// Pixi.js v8 application setup for the S0.4.1 perf prototype: builds the
// board from plain data (hexBoard.ts), wires drag-pan + wheel-zoom on the
// board container, and runs one continuous animation (mist-bank alpha pulse).
// The canvas holds zero authoritative game state (ADR-0002) — it is purely a
// projection of `BASE_BOARD` / `STRESS_BOARD`.

import { Application, Container, Graphics } from 'pixi.js';

import { BASE_BOARD, STRESS_BOARD } from './hexBoard.js';
import { createTileVisual } from './tileRenderer.js';

export type RendererBackend = 'webgpu' | 'webgl' | 'canvas';

export interface SceneHandle {
  readonly app: Application;
  readonly rendererBackend: RendererBackend;
  getTileCount(): number;
  setStress(enabled: boolean): void;
  destroy(): void;
}

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const MIST_PULSE_SPEED = 0.0015; // radians per ms

function detectBackend(app: Application): RendererBackend {
  // RendererType: WEBGL = 1, WEBGPU = 2, CANVAS = 4 (pixi.js rendering/renderers/types).
  switch (app.renderer.type) {
    case 2:
      return 'webgpu';
    case 4:
      return 'canvas';
    default:
      return 'webgl';
  }
}

export async function createHexScene(mountEl: HTMLElement): Promise<SceneHandle> {
  const app = new Application();
  await app.init({
    resizeTo: mountEl,
    backgroundColor: 0x0f1220,
    antialias: true,
    preference: 'webgpu',
  });
  mountEl.appendChild(app.canvas);

  const world = new Container();
  world.position.set(app.screen.width / 2, app.screen.height / 2);
  app.stage.addChild(world);

  const tilesLayer = new Container();
  world.addChild(tilesLayer);

  const fogOverlays: Graphics[] = [];
  let tileCount = 0;

  function renderBoard(stress: boolean): void {
    tilesLayer.removeChildren();
    fogOverlays.length = 0;
    const board = stress ? STRESS_BOARD : BASE_BOARD;
    for (const tile of board) {
      const visual = createTileVisual(tile);
      tilesLayer.addChild(visual.container);
      if (visual.fogOverlay) fogOverlays.push(visual.fogOverlay);
    }
    tileCount = board.length;
  }

  renderBoard(false);

  // Continuous animation: pulse the mist-bank tile's fog overlay alpha.
  let elapsedMs = 0;
  app.ticker.add((ticker) => {
    elapsedMs += ticker.deltaMS;
    const alpha = 0.35 + 0.15 * Math.sin(elapsedMs * MIST_PULSE_SPEED);
    for (const fog of fogOverlays) fog.alpha = alpha;
  });

  // --- Drag-pan + wheel-zoom on the board container (plain pointer events; no Pixi interaction system needed). ---
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    world.x += e.clientX - lastX;
    world.y += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onPointerUp(): void {
    dragging = false;
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, world.scale.x * zoomFactor));

    const worldX = (pointerX - world.x) / world.scale.x;
    const worldY = (pointerY - world.y) / world.scale.y;
    world.scale.set(nextScale);
    world.x = pointerX - worldX * nextScale;
    world.y = pointerY - worldY * nextScale;
  }

  const canvas = app.canvas;
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return {
    app,
    rendererBackend: detectBackend(app),
    getTileCount: () => tileCount,
    setStress: (enabled: boolean) => renderBoard(enabled),
    destroy: () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      app.destroy(true, { children: true, texture: true, textureSource: true });
    },
  };
}
