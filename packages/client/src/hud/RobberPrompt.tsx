// RobberPrompt — S2.8.4a: the `robber`-phase status line + victim picker,
// rendered over the Chart while `phase==='robber'` (`GameScreen.tsx`). Two
// states, driven by `useRobberPlacement`'s `prompt`: `moveRobber` shows a
// "click a tile" line (reusing the `SetupPrompt` status-line visuals); the
// `chooseVictim` step shows one button per eligible victim (flotilla display
// name + hand size — the same naming the players-rail uses) plus «Отмена».
// Buttons disable, never disappear/shift (DESIGN.md §6); every string is a
// typed `t()` key (ADR-0008).
import './RobberPrompt.css';

import { useTranslation } from '../i18n/index.js';
import { flotillaForPlayer } from '../theme/flotillaColors.js';
import { Button } from './components/Button.js';
import { FLOTILLA_KEY } from './flotillaLabels.js';
import { handSize } from './renown.js';
import { selectSeatOrder, useUiStore } from './store.js';
import type {
  RobberPrompt as RobberPromptKind,
  UseRobberPlacementResult,
} from './useRobberPlacement.js';

export interface RobberPromptProps {
  readonly prompt: RobberPromptKind;
  readonly victims: UseRobberPlacementResult['victims'];
  readonly onChooseVictim: UseRobberPlacementResult['onChooseVictim'];
  readonly onCancelVictim: UseRobberPlacementResult['onCancelVictim'];
}

export function RobberPrompt({
  prompt,
  victims,
  onChooseVictim,
  onCancelVictim,
}: RobberPromptProps) {
  const { t } = useTranslation();
  const gameState = useUiStore((state) => state.gameState);
  const seatOrder = selectSeatOrder(gameState);

  if (prompt === 'moveRobber') {
    return (
      <div className="setup-prompt" role="status" aria-live="polite">
        <span className="setup-prompt__text">{t('robber.promptMove')}</span>
      </div>
    );
  }

  if (prompt === 'chooseVictim') {
    return (
      <div className="robber-prompt" role="group" aria-label={t('a11y.robberVictims')}>
        <span className="setup-prompt__text">{t('robber.promptChooseVictim')}</span>
        <div className="robber-prompt__victims">
          {victims.map((victimId) => {
            const flotilla = flotillaForPlayer(victimId, seatOrder);
            const player = gameState.players.find((p) => p.id === victimId);
            const cards = handSize(player?.resources ?? {});
            return (
              <Button
                key={victimId}
                variant="primary"
                onClick={() => onChooseVictim(victimId)}
              >
                <span className="robber-prompt__victim-name">
                  {flotilla ? t(FLOTILLA_KEY[flotilla.id]) : victimId}
                </span>
                <span className="robber-prompt__victim-cards">
                  {t('hud.resourceCards', { count: cards })}
                </span>
              </Button>
            );
          })}
          <Button variant="quiet" onClick={onCancelVictim}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
