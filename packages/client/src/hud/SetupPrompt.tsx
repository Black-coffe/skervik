// SetupPrompt — S2.8.2: a small, always-live status line telling the local
// human what to do during the setup-phase snake draft ("Place a
// settlement" / "Place a road" / "Opponent's turn"). Unlike `NoticeBar`
// (dismissable, one-off failure), this tracks LIVE state — no dismiss, just
// reflects `useSetupPlacement`'s current prompt. Rendered only while
// `phase==='setup'` (`GameScreen.tsx`); every string is a `t()` key
// (ADR-0008).
import './SetupPrompt.css';

import { useTranslation } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/keys.js';
import type { SetupPrompt as SetupPromptKind } from './useSetupPlacement.js';

const PROMPT_KEY: Readonly<Record<Exclude<SetupPromptKind, null>, TranslationKey>> = {
  placeSettlement: 'setup.placeSettlement',
  placeRoad: 'setup.placeRoad',
  opponentTurn: 'setup.opponentTurn',
};

export interface SetupPromptProps {
  readonly prompt: SetupPromptKind;
}

export function SetupPrompt({ prompt }: SetupPromptProps) {
  const { t } = useTranslation();

  return (
    <div
      className="setup-prompt"
      role="status"
      aria-live="polite"
      aria-label={t('a11y.setupPrompt')}
    >
      {prompt !== null ? (
        <span className="setup-prompt__text">{t(PROMPT_KEY[prompt])}</span>
      ) : null}
    </div>
  );
}
