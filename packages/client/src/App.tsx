// App (S2.5.4) — the top-level screen router: `<LobbyScreen>` (preset + bot
// pick, then Start) until the lobby's job is done, then `<GameScreen>`. The
// lobby's `started` flag lives in `lobby/lobbyStore.ts`, a separate slice from
// `hud/store.ts`'s `UiStore` — a lobby selection is never smuggled into
// `gameState`. `main.tsx` flips `started` immediately (skipping the lobby
// screen entirely) when a cold load finds a resumable match, so a page reload
// mid-match never shows the lobby or re-applies a stale pick.
import { GameScreen } from './hud/GameScreen.js';
import { LobbyScreen } from './lobby/LobbyScreen.js';
import { useLobbyStore } from './lobby/lobbyStore.js';
import type { LobbyJoinFields } from './net/wsClient.js';

export interface AppProps {
  /** Fires once, when the lobby's Start button is pressed (never on a resume). */
  readonly onStart: (selection: LobbyJoinFields) => void;
}

export function App({ onStart }: AppProps) {
  const started = useLobbyStore((state) => state.started);
  return started ? <GameScreen /> : <LobbyScreen onStart={onStart} />;
}
