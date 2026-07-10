// Client entry point — mounts `<App>` (S2.5.4: `<LobbyScreen>` until Start is
// pressed, then `<GameScreen>`). The E0.4 perf prototype (`src/proto/`) has
// been deleted; its validated results live in
// `docs/specs/m0-foundation/S0.4.3-perf-results.md` and the
// `feat/e04-pixi-prototype` branch. WS wiring lands here (S1.6.5).
import './theme/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { useUiStore } from './hud/store.js';
import { I18nProvider } from './i18n/index.js';
import { useLobbyStore } from './lobby/lobbyStore.js';
import { fetchGuest } from './net/guestAuth.js';
import { readCurrentRoomId, readReconnectionToken } from './net/reconnectToken.js';
import { connect, type LobbyJoinFields } from './net/wsClient.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found in index.html');

// The WS URL comes from a Vite env var with a localhost dev default; the
// REST/API URL is `VITE_API_URL` or derived from the WS URL (ws→http).
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:2567';
const API_URL = import.meta.env.VITE_API_URL ?? WS_URL.replace(/^ws/, 'http');

/**
 * `true` when a cold load finds a live reconnect pointer (S2.3.2a) — a
 * SYNCHRONOUS, best-effort check used ONLY to decide whether to show the
 * lobby at all; `connect()`'s own resume-first branch (`wsClient.ts`) does the
 * actual token check/attempt and its own fallback. A reload mid-match must
 * resume the existing seat unmodified — never show the lobby, never re-apply
 * a lobby pick to it (S2.5.4 hard constraint).
 */
function hasResumablePointer(): boolean {
  const roomId = readCurrentRoomId();
  return roomId !== null && readReconnectionToken(roomId) !== null;
}

/**
 * Fetches an anonymous guest identity (S1.7.1, display-only) then connects
 * (S1.6.5). `lobbySelection`, when given, is forwarded to `connect()`'s
 * `lobby` argument — which, by construction, only reaches a FRESH
 * `joinOrCreate` (S2.5.4): `connect()`'s resume-first branch never reads it.
 * Every callback routes straight into the store. A failed/absent server
 * (guest fetch OR join) just leaves the dev-fixture view rendered — a live
 * connection is NEVER a hard requirement to render (key decision 4).
 */
async function startConnection(lobbySelection?: LobbyJoinFields): Promise<void> {
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
    lobbySelection,
  );
  useUiStore.getState().setConnection(handle);
}

// Resolved BEFORE the first render (not in an effect) so a resumable cold
// load never flashes the lobby screen before switching to the game screen.
const resuming = hasResumablePointer();
if (resuming) useLobbyStore.getState().start();

createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <App onStart={(selection) => void startConnection(selection)} />
    </I18nProvider>
  </StrictMode>,
);

if (resuming) void startConnection();
