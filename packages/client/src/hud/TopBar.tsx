// TopBar — DESIGN.md §6: match id · SeedChip (fairness) · PhaseIndicator ·
// TimerDisplay (idle) · LocaleSwitcher. Reads `gameState` from the store;
// every string is a `t()` key (ADR-0008).
import './TopBar.css';

import { LocaleSwitcher, useTranslation } from '../i18n/index.js';
import { PhaseIndicator } from './components/PhaseIndicator.js';
import { SeedChip } from './components/SeedChip.js';
import { TimerDisplay } from './components/TimerDisplay.js';
import { PHASE_KEY } from './phase.js';
import { useUiStore } from './store.js';

export function TopBar() {
  const { t } = useTranslation();
  const gameState = useUiStore((state) => state.gameState);

  return (
    <div className="top-bar">
      <span className="top-bar__match-id">
        {t('hud.matchId', { id: gameState.matchId })}
      </span>
      <SeedChip label={t('hud.seedChip')} seedHash={gameState.seedHash} />
      <PhaseIndicator label={t(PHASE_KEY[gameState.phase])} />
      <TimerDisplay label={t('hud.timer')} value="--:--" state="idle" />
      <div className="top-bar__spacer" />
      <LocaleSwitcher />
    </div>
  );
}
