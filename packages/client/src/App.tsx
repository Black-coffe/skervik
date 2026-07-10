// App (S2.5.4, transition unified S2.5.2) — the top-level screen router:
// `<LobbyScreen>` (preset + bot pick, then Start; also the connected-but-
// waiting view once joined) until the room's `phase` actually leaves
// `'lobby'`, then `<GameScreen>`. Two signals combine: `lobby/lobbyStore.ts`'s
// `started` flag (a separate slice from `hud/store.ts`'s `UiStore` — a lobby
// selection is never smuggled into `gameState`) gates "has a connection
// attempt succeeded at all" (so the pre-connect dev-fixture `gameState` never
// leaks through), and `shouldShowGame(phase)` (S2.5.2) gates "has the match
// actually started" — the SAME uniform signal for every join mode (quick
// match / create private / join by code): a private room's host/joiner stays
// on `<LobbyScreen>`'s waiting view (invite link / "Start match" / "waiting
// for host") for as long as `phase === 'lobby'`, and NO join mode ever shows
// a blank `<GameScreen>` before `gameState` reflects a started match (closes
// the S2.5.4a seam — the old quickMatch-only connect-time flip could show
// exactly that empty window). `main.tsx` flips `started` immediately (skipping
// the lobby screen entirely) when a cold load finds a resumable match, so a
// page reload mid-match never shows the lobby or re-applies a stale pick.
import { GameScreen } from './hud/GameScreen.js';
import { shouldShowGame, useUiStore } from './hud/store.js';
import { LobbyScreen } from './lobby/LobbyScreen.js';
import { useLobbyStore } from './lobby/lobbyStore.js';
import type { JoinMode, LobbyJoinFields } from './net/wsClient.js';

export interface AppProps {
  /**
   * Fires once, when the lobby's Start button is pressed (never on a resume
   * or an invite-link cold load, S2.3.2a/S2.5.3). `joinMode` (S2.5.3) selects
   * quick match / create private / join by code.
   */
  readonly onStart: (selection: LobbyJoinFields, joinMode: JoinMode) => void;
}

export function App({ onStart }: AppProps) {
  const started = useLobbyStore((state) => state.started);
  const phase = useUiStore((state) => state.gameState.phase);
  return started && shouldShowGame(phase) ? (
    <GameScreen />
  ) : (
    <LobbyScreen onStart={onStart} />
  );
}
