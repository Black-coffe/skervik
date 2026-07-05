// Client entry point — mounts the full HUD-framed game screen (S1.6.3):
// `<GameScreen>` places `<GameTable>` ("The Chart", DESIGN.md §1) inside the
// top bar / players rail / log panel / bottom deck "Instruments" chrome
// (the S1.6.6a `LocaleSwitcher` now lives in the top bar, not a dev corner).
// The E0.4 perf prototype (`src/proto/`) has been deleted; its validated
// results live in `docs/specs/m0-foundation/S0.4.3-perf-results.md` and the
// `feat/e04-pixi-prototype` branch. WS wiring lands in S1.6.5.
import './theme/tokens.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { GameScreen } from './hud/GameScreen.js';
import { I18nProvider } from './i18n/index.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <GameScreen />
    </I18nProvider>
  </StrictMode>,
);
