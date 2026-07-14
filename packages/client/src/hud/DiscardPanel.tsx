// DiscardPanel — S2.8.4b: the over-7 discard picker. When a 7 (a «Шторм») is
// rolled and the local player holds >7 cards, they must shed `floor(handSize/2)`
// cards of their choosing before the robber can move. Rendered by `GameScreen`
// whenever `owesDiscard(state, myPlayerId)` — INCLUDING on an opponent's turn
// (this is the one off-turn-active HUD surface; the discard is owed by
// `playersToDiscard` membership, not by whose turn it is).
//
// A docked panel over the Chart (DESIGN.md §6/§7, NOT a hard modal — the board
// stays visible while shedding). Reuses the Trade UI's bounded −/+ stepper
// pattern + `.trade-*` CSS (the heart's misclick-resistant widget) with the §2.3
// resource glyph + accessible name (never hue-only, §10). The «Сбросить» confirm
// is enabled ONLY when the selection is valid (exact count, within holdings) —
// an advisory mirror of the server's `WRONG_DISCARD_COUNT`/`CANNOT_AFFORD`; the
// server re-validates. Selection state is component-local (transient, self-
// contained — it never crosses a hook-routing switch); the panel unmounts on its
// own once the server-authoritative fold removes me from `playersToDiscard`, so
// we never optimistically hide it (a rejected discard must leave the picker up).
import './DiscardPanel.css';
import './components/trade.css';

import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '../i18n/index.js';
import { Button } from './components/Button.js';
import { isValidDiscardSelection, requiredDiscardCount } from './discardActions.js';
import type { ClassicResource } from './resourceGlyphs.js';
import { ResourceGlyph } from './resourceGlyphs.js';
import { RESOURCE_KEY } from './resourceLabels.js';
import { useUiStore } from './store.js';
import { clampStep, emptyBundle, TRADE_RESOURCE_ORDER } from './trade.js';

// Reinforcing color per resource (§2.3) — always paired with the distinct
// `ResourceGlyph` silhouette, never a bare swatch (mirrors OfferBuilder/tokens).
const RESOURCE_COLOR: Readonly<Record<ClassicResource, string>> = {
  timber: 'var(--res-timber)',
  clay: 'var(--res-clay)',
  fleece: 'var(--res-fleece)',
  barley: 'var(--res-barley)',
  iron: 'var(--res-iron)',
};

export function DiscardPanel() {
  const { t, formatNumber } = useTranslation();
  const gameState = useUiStore((s) => s.gameState);
  const myPlayerId = useUiStore((s) => s.myPlayerId);
  const dispatchIntent = useUiStore((s) => s.dispatchIntent);

  const myResources = gameState.players.find((p) => p.id === myPlayerId)?.resources ?? {};
  const required = requiredDiscardCount(gameState, myPlayerId);

  const [selection, setSelection] = useState<Record<ClassicResource, number>>(() =>
    emptyBundle(),
  );
  // Brief guard against a double-dispatch (§7.2 discipline) — self-healing so a
  // rejected discard re-enables «Сбросить» (the panel stays up until the server
  // fold removes me from `playersToDiscard`).
  const [justDispatched, setJustDispatched] = useState(false);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (guardTimer.current) clearTimeout(guardTimer.current);
    };
  }, []);

  const selectedTotal = TRADE_RESOURCE_ORDER.reduce(
    (sum, resource) => sum + selection[resource],
    0,
  );
  const canConfirm =
    !justDispatched && isValidDiscardSelection(selection, required, myResources);

  function edit(resource: ClassicResource, delta: number) {
    setSelection((prev) => ({
      ...prev,
      [resource]: clampStep(prev[resource], delta, myResources[resource] ?? 0),
    }));
  }

  function confirm() {
    if (!canConfirm) return;
    dispatchIntent({
      type: 'intent.discard',
      playerId: myPlayerId,
      resources: selection,
    });
    setJustDispatched(true);
    if (guardTimer.current) clearTimeout(guardTimer.current);
    guardTimer.current = setTimeout(() => setJustDispatched(false), 400);
  }

  // Rows only for resources the player actually holds (≥1).
  const heldResources = TRADE_RESOURCE_ORDER.filter(
    (resource) => (myResources[resource] ?? 0) > 0,
  );

  return (
    <section className="discard-panel" aria-label={t('discard.title')}>
      <p className="discard-panel__prompt" role="status" aria-live="polite">
        {t('discard.prompt', { count: required })}
      </p>

      <div className="discard-panel__rows">
        {heldResources.map((resource) => (
          <div className="trade-row" key={resource}>
            <span className="trade-row__label">
              <ResourceGlyph resource={resource} color={RESOURCE_COLOR[resource]} />
              {t(RESOURCE_KEY[resource])}
            </span>
            <span className="trade-stepper">
              <button
                type="button"
                className="trade-stepper__btn"
                onClick={() => edit(resource, -1)}
                disabled={selection[resource] <= 0}
                aria-label={t('discard.removeResource', {
                  resource: t(RESOURCE_KEY[resource]),
                })}
              >
                −
              </button>
              <b className="trade-stepper__count">{formatNumber(selection[resource])}</b>
              <button
                type="button"
                className="trade-stepper__btn"
                onClick={() => edit(resource, 1)}
                disabled={selection[resource] >= (myResources[resource] ?? 0)}
                aria-label={t('discard.addResource', {
                  resource: t(RESOURCE_KEY[resource]),
                })}
              >
                +
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="discard-panel__foot">
        <p className="discard-panel__counter" aria-live="polite">
          {t('discard.selectedCounter', {
            selected: selectedTotal,
            required,
          })}
        </p>
        <Button variant="primary" onClick={confirm} disabled={!canConfirm}>
          {t('discard.confirm')}
        </Button>
      </div>
    </section>
  );
}
