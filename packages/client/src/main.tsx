// Client entry point — mounts the full HUD-framed game screen (S1.6.3):
// `<GameScreen>` places `<GameTable>` ("The Chart", DESIGN.md §1) inside the
// top bar / players rail / log panel / bottom deck "Instruments" chrome
// (the S1.6.6a `LocaleSwitcher` now lives in the top bar, not a dev corner).
// The E0.4 perf prototype (`src/proto/`) has been deleted; its validated
// results live in `docs/specs/m0-foundation/S0.4.3-perf-results.md` and the
// `feat/e04-pixi-prototype` branch. WS wiring lands here (S1.6.5).
import './theme/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { GameScreen } from './hud/GameScreen.js';
import { useUiStore } from './hud/store.js';
import { I18nProvider } from './i18n/index.js';
import { fetchGuest } from './net/guestAuth.js';
import { connect } from './net/wsClient.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <GameScreen />
    </I18nProvider>
  </StrictMode>,
);

// Kick off the live connection (S1.6.5 + S1.7.1). The WS URL comes from a Vite
// env var with a localhost dev default; the REST/API URL is `VITE_API_URL` or
// derived from the WS URL (ws→http). Before connecting we fetch an anonymous
// guest identity (S1.7.1) and forward it as DISPLAY-only join metadata — the
// authoritative seat is still the server's `sessionId`. Every callback routes
// straight into the store. A failed/absent server (guest fetch OR join) just
// leaves the dev-fixture view rendered — a live connection is NEVER a hard
// requirement to render (key decision 4).
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:2567';
const API_URL = import.meta.env.VITE_API_URL ?? WS_URL.replace(/^ws/, 'http');

void (async () => {
  // Anonymous guest identity (display metadata only); `null` on a down/absent
  // server, in which case we still attempt the join (and fall back to fixture).
  const guest = await fetchGuest(API_URL);
  const handle = await connect(
    WS_URL,
    {
      onSnapshot: (state, myPlayerId) =>
        useUiStore.getState().applySnapshot(state, myPlayerId),
      onBatch: (events) => useUiStore.getState().applyEventBatch(events),
      onReject: (reason) => useUiStore.getState().applyReject(reason),
      onError: () => useUiStore.getState().applyIntentError(),
      onConnectionChange: (status, versionMismatch) =>
        useUiStore.getState().setConnectionStatus(status, versionMismatch),
    },
    guest ?? undefined,
  );
  useUiStore.getState().setConnection(handle);
})();
