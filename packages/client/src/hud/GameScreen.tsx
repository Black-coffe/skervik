// The "Instruments" app shell (DESIGN.md §1/§6) — frames the "Chart" canvas
// (`<GameTable>`) with the top bar, left players rail, right log panel, and
// bottom deck. This component owns ONLY the layout grid; each region's
// content is a separate HUD piece (`TopBar`/`PlayersRail`/`BottomDeck`/
// `LogPanel`) populated from the zustand store (`hud/store.ts`).

import './GameScreen.css';

import { GameTable } from '../board/GameTable.js';
import { TradeDemoControls } from '../dev/TradeDemoControls.js';
import { useTranslation } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/keys.js';
import { BottomDeck } from './BottomDeck.js';
import { Button } from './components/Button.js';
import { owesDiscard } from './discardActions.js';
import { DiscardPanel } from './DiscardPanel.js';
import { LogPanel } from './LogPanel.js';
import { NoticeBar } from './NoticeBar.js';
import { PlayersRail } from './PlayersRail.js';
import { RobberPrompt } from './RobberPrompt.js';
import { SetupPrompt } from './SetupPrompt.js';
import { canShowTradeDock, selectIsMyTurn, useUiStore } from './store.js';
import { TopBar } from './TopBar.js';
import { TradeZone } from './TradeZone.js';
import type { BuildPrompt } from './useBuildPlacement.js';
import { useBuildPlacement } from './useBuildPlacement.js';
import { useRobberPlacement } from './useRobberPlacement.js';
import { useSetupPlacement } from './useSetupPlacement.js';
import { useVenturePlacement } from './useVenturePlacement.js';
import { VenturePanel } from './VenturePanel.js';

// S2.8.3b: the build prompt reuses the setup-prompt status-line visuals (over
// the Chart) — same "tell the human what to click" role, one phase later.
const BUILD_PROMPT_KEY: Readonly<Record<Exclude<BuildPrompt, null>, TranslationKey>> = {
  buildSettlement: 'build.promptSettlement',
  buildRoad: 'build.promptRoad',
  buildCity: 'build.promptCity',
};

export function GameScreen() {
  const { t } = useTranslation();
  const gameState = useUiStore((state) => state.gameState);
  const myPlayerId = useUiStore((state) => state.myPlayerId);
  // S2.7.1: the trade dock is legal only in phase 'main' — gate it out of the
  // DOM entirely elsewhere (not just visually) and offset the board so it
  // never renders under the dock's footprint while the dock IS shown.
  const dockVisible = canShowTradeDock(gameState.phase);
  // S2.8.2/S2.8.3b: a SINGLE active pick source at a time, selected by phase —
  // setup → setup placement, main → build placement (inert until a build
  // submode is armed). Every other phase feeds NO pick props, keeping the
  // S2.8.1 dev harness available there (`GameTable`'s `isDevHarnessEligible`).
  const isSetupPhase = gameState.phase === 'setup';
  const isMainPhase = gameState.phase === 'main';
  const isRobberPhase = gameState.phase === 'robber';
  // S2.8.4b: the over-7 discard picker is owed by `playersToDiscard` membership,
  // NOT by turn/phase — it must show even on an opponent's turn (the one
  // off-turn-active HUD surface). While owed, the S2.8.4a robber-move UI is
  // already inert (it gates on a non-empty `playersToDiscard`), so no conflict.
  const owesCardDiscard = owesDiscard(gameState, myPlayerId);
  // S2.8.5a: the Venture hand panel — a UI-only toggle (`ventureOpen`) gated
  // to the same window buy/play are legal in, so it auto-hides if the turn
  // or phase moves on while open.
  const ventureOpen = useUiStore((state) => state.ventureOpen);
  const showVenturePanel =
    ventureOpen && isMainPhase && selectIsMyTurn(gameState, myPlayerId);
  // S2.8.5b: which board-pick Venture play is armed — read directly from the
  // store (rather than inferred from `venturePlay.prompt`, which goes `null`
  // once the road-building 2-edge cap is reached) so the confirm bar keeps
  // showing at that point.
  const venturePlayMode = useUiStore((state) => state.venturePlayMode);
  const setup = useSetupPlacement();
  const build = useBuildPlacement();
  const robber = useRobberPlacement();
  const venturePlay = useVenturePlacement();
  // S2.8.5b: a venture play, once armed, takes the board over the
  // phase-driven build picker (both are `main`-phase) — checked BEFORE
  // `isMainPhase` in the precedence below.
  const placement = isSetupPhase
    ? setup
    : venturePlay.active
      ? venturePlay
      : isMainPhase
        ? build
        : isRobberPhase
          ? robber
          : null;

  return (
    <div className="game-screen">
      <div className="game-screen__topbar">
        <TopBar />
      </div>
      <div className="game-screen__rail">
        <PlayersRail />
      </div>
      <div className="game-screen__chart">
        <GameTable
          state={gameState}
          dockVisible={dockVisible}
          {...(placement
            ? {
                pickMode: placement.pickMode,
                onPick: placement.onPick,
                legalTargets: placement.legalTargets,
              }
            : {})}
        />
        {dockVisible ? <TradeZone /> : null}
        {isSetupPhase ? <SetupPrompt prompt={setup.prompt} /> : null}
        {isMainPhase && build.prompt ? (
          <div className="setup-prompt" role="status" aria-live="polite">
            <span className="setup-prompt__text">
              {t(BUILD_PROMPT_KEY[build.prompt])}
            </span>
          </div>
        ) : null}
        {isRobberPhase && robber.prompt ? (
          <RobberPrompt
            prompt={robber.prompt}
            victims={robber.victims}
            onChooseVictim={robber.onChooseVictim}
            onCancelVictim={robber.onCancelVictim}
          />
        ) : null}
        {venturePlay.active && venturePlay.prompt === 'knightMove' ? (
          <div className="setup-prompt" role="status" aria-live="polite">
            <span className="setup-prompt__text">{t('venture.knightMove')}</span>
          </div>
        ) : null}
        {venturePlay.active && venturePlay.prompt === 'knightChooseVictim' ? (
          <RobberPrompt
            prompt="chooseVictim"
            victims={venturePlay.victims}
            onChooseVictim={venturePlay.onChooseVictim}
            onCancelVictim={venturePlay.onCancelVictim}
            chooseKey="venture.knightChooseVictim"
          />
        ) : null}
        {venturePlay.active && venturePlayMode === 'roadBuilding' ? (
          <div className="robber-prompt" role="group" aria-label={t('venture.title')}>
            <span className="setup-prompt__text">
              {t(
                venturePlay.roadBuildingCount === 0
                  ? 'venture.roadBuildingFirst'
                  : 'venture.roadBuildingSecond',
              )}
            </span>
            <div className="robber-prompt__victims">
              <Button
                variant="primary"
                onClick={venturePlay.onConfirmRoadBuilding}
                disabled={venturePlay.roadBuildingCount < 1}
              >
                {t('venture.play')}
              </Button>
              <Button variant="quiet" onClick={venturePlay.onCancelRoadBuilding}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
        {owesCardDiscard ? <DiscardPanel /> : null}
        {showVenturePanel ? <VenturePanel /> : null}
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
