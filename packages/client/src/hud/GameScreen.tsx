// The "Instruments" app shell (DESIGN.md §1/§6) — frames the "Chart" canvas
// (`<GameTable>`) with the top bar, left players rail, right log panel, and
// bottom deck. This component owns ONLY the layout grid; each region's
// content is a separate HUD piece (`TopBar`/`PlayersRail`/`BottomDeck`/
// `LogPanel`) populated from the zustand store (`hud/store.ts`).

import './GameScreen.css';

import { GameTable } from '../board/GameTable.js';
import { TradeDemoControls } from '../dev/TradeDemoControls.js';
import { BottomDeck } from './BottomDeck.js';
import { LogPanel } from './LogPanel.js';
import { NoticeBar } from './NoticeBar.js';
import { PlayersRail } from './PlayersRail.js';
import { useUiStore } from './store.js';
import { TopBar } from './TopBar.js';
import { TradeZone } from './TradeZone.js';

export function GameScreen() {
  const gameState = useUiStore((state) => state.gameState);

  return (
    <div className="game-screen">
      <div className="game-screen__topbar">
        <TopBar />
      </div>
      <div className="game-screen__rail">
        <PlayersRail />
      </div>
      <div className="game-screen__chart">
        <GameTable state={gameState} />
        <TradeZone />
        <NoticeBar />
      </div>
      <div className="game-screen__log">
        <LogPanel />
      </div>
      <div className="game-screen__deck">
        <BottomDeck />
      </div>
      {import.meta.env.DEV ? <TradeDemoControls /> : null}
    </div>
  );
}
