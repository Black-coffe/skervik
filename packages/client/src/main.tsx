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

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <GameTable state={devFixtureState} />
  </StrictMode>,
);
