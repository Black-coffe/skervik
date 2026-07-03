// Client entry point — mounts the E0.4 Pixi.js perf prototype (S0.4.1).
// Full client shell (menus/HUD/routing) lands in E1.6.
import { useEffect, useRef } from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { mountPerfOverlay } from './proto/PerfOverlay.js';
import { createHexScene } from './proto/scene.js';

function HexPrototype() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let cleanupOverlay: (() => void) | undefined;
    let destroyScene: (() => void) | undefined;

    void createHexScene(host).then((scene) => {
      if (cancelled) {
        scene.destroy();
        return;
      }
      destroyScene = scene.destroy;
      cleanupOverlay = mountPerfOverlay(host, scene);
    });

    return () => {
      cancelled = true;
      cleanupOverlay?.();
      destroyScene?.();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      style={{ position: 'relative', width: '100vw', height: '100vh' }}
    />
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <HexPrototype />
  </StrictMode>,
);
