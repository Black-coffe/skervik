// Dev-only toggle to switch the Trade UI between the demo states in
// `tradeDemo.ts` (S1.6.4 manual smoke). Rendered ONLY under
// `import.meta.env.DEV`; it swaps the store's authoritative `gameState` for a
// pre-built (real, `reduce`-produced) demo state. Superseded by S1.6.5's real
// WS join — never shipped to players.
import './TradeDemoControls.css';

import { useUiStore } from '../hud/store.js';
import { useTranslation } from '../i18n/index.js';
import { TRADE_DEMOS } from './tradeDemo.js';

export function TradeDemoControls() {
  const { t } = useTranslation();
  const setGameState = useUiStore((s) => s.setGameState);

  return (
    <div className="trade-demo-controls" aria-label="Trade demo states (dev)">
      <span className="trade-demo-controls__label">dev · trade</span>
      {TRADE_DEMOS.map((demo) => (
        <button
          key={demo.id}
          type="button"
          className="btn btn--quiet trade-demo-controls__btn"
          onClick={() => setGameState(demo.state)}
        >
          {t(demo.labelKey)}
        </button>
      ))}
    </div>
  );
}
