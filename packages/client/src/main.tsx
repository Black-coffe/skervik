// Client entry point — mounts the real product client shell (S1.6.1):
// `<GameTable>` renders "The Chart" (DESIGN.md §1) from a `GameState`. The
// E0.4 perf prototype (`src/proto/`) has been deleted; its validated
// results live in `docs/specs/m0-foundation/S0.4.3-perf-results.md` and the
// `feat/e04-pixi-prototype` branch. Full client shell (menus/HUD/routing,
// WS wiring) lands across the rest of E1.6.
import './theme/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { GameTable } from './board/GameTable.js';
import { devFixtureState } from './dev/devFixture.js';
import { I18nProvider, LocaleSwitcher, useTranslation } from './i18n/index.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found in index.html');

// Dev-corner demo proving live t()/plural switching (S1.6.3 places the
// LocaleSwitcher + phase display in real HUD chrome — this is scaffolding
// only, not the HUD).
function I18nDevCorner() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        right: 8,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 6,
      }}
    >
      <LocaleSwitcher />
      <span style={{ color: 'var(--ink)', font: 'inherit' }}>
        {t('phase.main')} — {t('hud.resourceCards', { count: 3 })}
      </span>
    </div>
  );
}

createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <I18nDevCorner />
      <GameTable state={devFixtureState} />
    </I18nProvider>
  </StrictMode>,
);
