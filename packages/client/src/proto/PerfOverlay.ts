// Plain-DOM perf harness overlay for the S0.4.1 prototype — a dev tool, not
// product UI, so it is intentionally minimal/EN-only (ADR-0008 trilingual
// rule applies to product UI, not this benchmarking harness).

import type { Ticker } from 'pixi.js';

import type { SceneHandle } from './scene.js';

const WINDOW_MS = 5000;
const REFRESH_MS = 250;

interface MemoryInfo {
  usedJSHeapSize: number;
}

function readHeapMb(): string {
  const perf = performance as Performance & { memory?: MemoryInfo };
  if (!perf.memory) return 'n/a';
  return (perf.memory.usedJSHeapSize / 1_048_576).toFixed(1);
}

/** Mounts the overlay into `root` and starts sampling. Returns a cleanup function. */
export function mountPerfOverlay(root: HTMLElement, scene: SceneHandle): () => void {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position: absolute',
    'top: 8px',
    'right: 8px',
    'padding: 8px 10px',
    'background: rgba(10, 12, 20, 0.75)',
    'color: #d7e0ff',
    'font: 12px/1.5 monospace',
    'border-radius: 6px',
    'pointer-events: auto',
    'user-select: none',
    'white-space: pre',
    'z-index: 10',
  ].join(';');
  root.appendChild(panel);

  const stats = document.createElement('div');
  panel.appendChild(stats);

  const button = document.createElement('button');
  let stressed = false;
  button.textContent = 'Stress x7: OFF';
  button.style.cssText = 'margin-top: 6px; font: 12px monospace; cursor: pointer;';
  button.addEventListener('click', () => {
    stressed = !stressed;
    scene.setStress(stressed);
    button.textContent = `Stress x7: ${stressed ? 'ON' : 'OFF'}`;
  });
  panel.appendChild(button);

  const samples: { t: number; fps: number }[] = [];

  function onTick(ticker: Ticker): void {
    const now = performance.now();
    const fps = ticker.deltaMS > 0 ? 1000 / ticker.deltaMS : 0;
    samples.push({ t: now, fps });
    while (samples.length > 0 && now - samples[0]!.t > WINDOW_MS) {
      samples.shift();
    }
  }
  scene.app.ticker.add(onTick);

  function render(): void {
    if (samples.length === 0) return;
    const sortedFps = samples.map((s) => s.fps).sort((a, b) => a - b);
    const avgFps = sortedFps.reduce((a, b) => a + b, 0) / sortedFps.length;
    const lowCount = Math.max(1, Math.floor(sortedFps.length * 0.01));
    const onePercentLow =
      sortedFps.slice(0, lowCount).reduce((a, b) => a + b, 0) / lowCount;

    stats.textContent = [
      `FPS avg: ${avgFps.toFixed(0)}  1% low: ${onePercentLow.toFixed(0)}`,
      `Heap: ${readHeapMb()} MB`,
      `Backend: ${scene.rendererBackend}`,
      `Tiles: ${scene.getTileCount()}`,
    ].join('\n');
  }

  const intervalId = window.setInterval(render, REFRESH_MS);

  return () => {
    scene.app.ticker.remove(onTick);
    window.clearInterval(intervalId);
    panel.remove();
  };
}
