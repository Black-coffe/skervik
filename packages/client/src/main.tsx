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
import { shouldMarkConnected, useLobbyStore } from './lobby/lobbyStore.js';
import { resolveColdLoadAction } from './net/coldLoadAction.js';
import { fetchGuest } from './net/guestAuth.js';
import { clearGuestToken, persistGuestToken, readGuestToken } from './net/guestToken.js';
import { readCurrentRoomId, readReconnectionToken } from './net/reconnectToken.js';
import {
  connect,
  type GuestJoinFields,
  type JoinMode,
  type LobbyJoinFields,
  type WsClientCallbacks,
} from './net/wsClient.js';

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
 * `lobby` argument — which, by construction, only reaches a FRESH join
 * (S2.5.4): `connect()`'s resume-first branch never reads it. `joinMode`
 * (S2.5.3) selects which fresh-join SDK call `connect()` makes; omitted, it
 * defaults to `quickMatch` (unchanged M1/M2 behavior). Every callback routes
 * straight into the store. A failed/absent server (guest fetch OR join) just
 * leaves the dev-fixture view rendered — a live connection is NEVER a hard
 * requirement to render (key decision 4).
 *
 * S2.5.4a: `lobbySelection` is only ever defined when this call originates
 * from the lobby's Start button (`selectLobbySelection` never returns
 * `undefined`) — the two cold-load callers below always omit it. On that
 * Start-initiated path, `started` flips ONLY once `connect()` resolves a live
 * handle ({@link shouldMarkConnected}) — never synchronously on click, never
 * before the promise settles, so a failed connect leaves the user on
 * `<LobbyScreen>` instead of a live-but-broken view. S2.5.2 unifies this
 * across every join mode (S2.5.4a used to narrow it to `quickMatch` only):
 * `started` now means "connected," full stop, and `App.tsx` combines it with
 * `hud/store.ts`'s `shouldShowGame(gameState.phase)` to decide GameScreen vs.
 * the waiting view — so `createPrivate`/`joinByCode` correctly stay on
 * `<LobbyScreen>`'s connected-but-waiting section (never a blank
 * `<GameScreen>`) for as long as `phase === 'lobby'`, without needing this
 * function to know the join mode at all.
 */
export async function startConnection(
  lobbySelection?: LobbyJoinFields,
  joinMode?: JoinMode,
): Promise<void> {
  const callbacks: WsClientCallbacks = {
    onSnapshot: (state, myPlayerId, isHost, isPrivate) =>
      useUiStore.getState().applySnapshot(state, myPlayerId, isHost, isPrivate),
    onBatch: (events) => useUiStore.getState().applyEventBatch(events),
    onReject: (reason) => useUiStore.getState().applyReject(reason),
    onError: () => useUiStore.getState().applyIntentError(),
    onConnectionChange: (status, versionMismatch) =>
      useUiStore.getState().setConnectionStatus(status, versionMismatch),
  };

  // S2.6.2a: a persisted guest session token (durable, survives reload/session)
  // is re-presented so the server re-resolves the SAME `userId` — `fetchGuest`
  // is called ONLY when there is no stored token. A freshly issued token is
  // persisted for next time.
  const storedToken = readGuestToken();
  let guest: GuestJoinFields | undefined;
  if (storedToken !== null) {
    guest = { sessionToken: storedToken };
  } else {
    const fetched = await fetchGuest(API_URL);
    if (fetched !== null) {
      if (fetched.sessionToken !== undefined) persistGuestToken(fetched.sessionToken);
      guest = fetched;
    }
  }

  let handle = await connect(WS_URL, callbacks, guest, lobbySelection, joinMode);

  // A stored token the server REJECTED (expired / bad signature → 4004, so
  // `connect` returned null) must not permanently wedge the client: forget it
  // and retry ONCE with a freshly issued guest. (A merely-down server also
  // yields null here; the retry then also fails and leaves the fallback view —
  // harmless.)
  if (handle === null && storedToken !== null) {
    clearGuestToken();
    const fetched = await fetchGuest(API_URL);
    if (fetched !== null) {
      if (fetched.sessionToken !== undefined) persistGuestToken(fetched.sessionToken);
      guest = fetched;
    } else {
      guest = undefined;
    }
    handle = await connect(WS_URL, callbacks, guest, lobbySelection, joinMode);
  }

  useUiStore.getState().setConnection(handle);
  if (lobbySelection !== undefined && shouldMarkConnected(handle)) {
    useLobbyStore.getState().start();
  }
}

// The DOM-mounting bootstrap below has no meaning without a `document` (this
// module is also imported by `main.test.ts`, which drives `startConnection`
// directly in Node's no-DOM test environment — same guard convention as
// `i18n/I18nProvider.tsx`).
if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('No #root element found in index.html');

  // Resolved BEFORE the first render (not in an effect) so a resumable cold
  // load, or a cold load carrying an invite-link `?room=` code (S2.5.3), never
  // flashes the lobby screen before switching away from it. Resume ALWAYS wins
  // over an invite-link code (`resolveColdLoadAction`'s precedence, criterion 5).
  const coldLoadAction = resolveColdLoadAction({
    resumable: hasResumablePointer(),
    search: window.location.search,
  });
  if (coldLoadAction.kind !== 'lobby') useLobbyStore.getState().start();

  createRoot(rootEl).render(
    <StrictMode>
      <I18nProvider>
        <App
          onStart={(selection, joinMode) => void startConnection(selection, joinMode)}
        />
      </I18nProvider>
    </StrictMode>,
  );

  if (coldLoadAction.kind === 'resume') {
    void startConnection();
  } else if (coldLoadAction.kind === 'joinByCode') {
    void startConnection(undefined, {
      kind: 'joinByCode',
      roomId: coldLoadAction.roomId,
    });
  }
}
