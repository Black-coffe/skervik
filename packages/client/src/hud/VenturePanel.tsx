// VenturePanel — S2.8.5a: the «Предприятие» (Venture) hand panel. Rendered by
// `GameScreen` while `ventureOpen` is set AND it's my `main`-phase turn (the
// only window buy/play are legal in). A docked panel over the Chart
// (DESIGN.md §6/§7, like `DiscardPanel` — NOT a hard modal, the board stays
// visible). Docked on the RIGHT of the Chart (mirroring `TradeZone`'s
// left dock) — `TradeZone` is ALSO shown for the whole `main` phase, so a
// shared side would collide; the opposite side keeps both panels + the board
// visible at once (state-your-choice per the story spec).
//
// Three component-local views (transient, self-contained — same rationale as
// `DiscardPanel`'s local selection): the held-Ventures list (default), the
// year-of-plenty resource-stepper picker, and the monopoly single-select
// picker. Reuses the Trade UI's bounded −/+ stepper (`.trade-*` CSS,
// `trade.ts` helpers) and the `justDispatched` double-dispatch guard.
//
// NO board picking here (S2.8.5b's knight/road-building are deferred) — every
// dispatch below is resource-picker-only, exactly the S2.8.5a scope line.
import './VenturePanel.css';
import './components/trade.css';

import type { DevCardKind, ResourceType } from '@skervik/core';
import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/keys.js';
import { Button } from './components/Button.js';
import {
  canBuyDevCard,
  canPlayVenture,
  DEV_CARD_BUY_COST,
  myHoldings,
  playableCount,
} from './devCardActions.js';
import type { ClassicResource } from './resourceGlyphs.js';
import { ResourceGlyph } from './resourceGlyphs.js';
import { RESOURCE_KEY } from './resourceLabels.js';
import { useUiStore } from './store.js';
import { clampStep, emptyBundle, TRADE_RESOURCE_ORDER } from './trade.js';

// Reinforcing color per resource (§2.3) — always paired with the distinct
// `ResourceGlyph` silhouette, never a bare swatch (mirrors DiscardPanel).
const RESOURCE_COLOR: Readonly<Record<ClassicResource, string>> = {
  timber: 'var(--res-timber)',
  clay: 'var(--res-clay)',
  fleece: 'var(--res-fleece)',
  barley: 'var(--res-barley)',
  iron: 'var(--res-iron)',
};

// Fixed row order so held-Venture rows never reflow (DESIGN.md §6/§7.1).
const KIND_ORDER: readonly DevCardKind[] = [
  'knight',
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
  'victoryPoint',
];

const VENTURE_KIND_KEY: Readonly<Record<DevCardKind, TranslationKey>> = {
  knight: 'venture.kind.knight',
  roadBuilding: 'venture.kind.roadBuilding',
  yearOfPlenty: 'venture.kind.yearOfPlenty',
  monopoly: 'venture.kind.monopoly',
  victoryPoint: 'venture.kind.victoryPoint',
};

// The only two kinds S2.8.5a wires a play action for (S2.8.5b: knight/
// roadBuilding are board-pick plays — their rows show a count, no button;
// choosing to OMIT rather than render a disabled dead button, per the story's
// "state your choice").
function isResourcePickerKind(kind: DevCardKind): kind is 'yearOfPlenty' | 'monopoly' {
  return kind === 'yearOfPlenty' || kind === 'monopoly';
}

type VentureView = 'list' | 'yearOfPlenty' | 'monopoly';

export function VenturePanel() {
  const { t, formatNumber } = useTranslation();
  const gameState = useUiStore((s) => s.gameState);
  const myPlayerId = useUiStore((s) => s.myPlayerId);
  const dispatchIntent = useUiStore((s) => s.dispatchIntent);
  const setVentureOpen = useUiStore((s) => s.setVentureOpen);

  const [view, setView] = useState<VentureView>('list');
  const [yopSelection, setYopSelection] = useState<Record<ClassicResource, number>>(() =>
    emptyBundle(),
  );
  const [monopolyResource, setMonopolyResource] = useState<ClassicResource | null>(null);

  // Brief guard against a double-dispatch (§7.2 discipline, mirrors
  // `DiscardPanel`) — self-healing so a rejected buy/play re-enables its
  // confirm button (the panel stays open/usable regardless of the outcome).
  const [justDispatched, setJustDispatched] = useState(false);
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (guardTimer.current) clearTimeout(guardTimer.current);
    };
  }, []);

  function guardDispatch() {
    setJustDispatched(true);
    if (guardTimer.current) clearTimeout(guardTimer.current);
    guardTimer.current = setTimeout(() => setJustDispatched(false), 400);
  }

  const me = gameState.players.find((p) => p.id === myPlayerId);
  const myResources = me?.resources ?? {};
  const holdings = myHoldings(gameState, myPlayerId);
  const heldKinds = KIND_ORDER.filter((kind) => (holdings.held[kind] ?? 0) > 0);

  const canBuy = !justDispatched && canBuyDevCard(gameState, myResources, myPlayerId);

  function buy() {
    if (!canBuy) return;
    dispatchIntent({ type: 'intent.buyDevCard', playerId: myPlayerId });
    guardDispatch();
  }

  function openPicker(kind: 'yearOfPlenty' | 'monopoly') {
    setView(kind);
  }

  function backToList() {
    setYopSelection(emptyBundle());
    setMonopolyResource(null);
    setView('list');
  }

  // --- year-of-plenty picker ------------------------------------------------
  const yopTotal = TRADE_RESOURCE_ORDER.reduce(
    (sum, resource) => sum + yopSelection[resource],
    0,
  );
  const canConfirmYop = !justDispatched && yopTotal === 2;

  // The most this resource's count could become without pushing the total
  // over 2 — bounds BOTH the stepper's clamp and its `+` button's disabled
  // state (the total is a bank-sourced budget, not a per-resource hand cap).
  function yopMaxFor(resource: ClassicResource): number {
    const others = yopTotal - yopSelection[resource];
    return Math.min(2, Math.max(0, 2 - others));
  }

  function editYop(resource: ClassicResource, delta: number) {
    setYopSelection((prev) => ({
      ...prev,
      [resource]: clampStep(prev[resource], delta, yopMaxFor(resource)),
    }));
  }

  function confirmYearOfPlenty() {
    if (!canConfirmYop) return;
    const tuple: ResourceType[] = [];
    for (const resource of TRADE_RESOURCE_ORDER) {
      for (let i = 0; i < yopSelection[resource]; i += 1) tuple.push(resource);
    }
    dispatchIntent({
      type: 'intent.playDevCard',
      playerId: myPlayerId,
      card: 'yearOfPlenty',
      resources: tuple as [ResourceType, ResourceType],
    });
    guardDispatch();
    backToList();
  }

  // --- monopoly picker -------------------------------------------------------
  const canConfirmMonopoly = !justDispatched && monopolyResource !== null;

  function confirmMonopoly() {
    if (!canConfirmMonopoly || monopolyResource === null) return;
    dispatchIntent({
      type: 'intent.playDevCard',
      playerId: myPlayerId,
      card: 'monopoly',
      resource: monopolyResource,
    });
    guardDispatch();
    backToList();
  }

  if (view === 'yearOfPlenty') {
    return (
      <section className="venture-panel" aria-label={t('venture.title')}>
        <div
          className="venture-panel__picker"
          role="group"
          aria-label={t('a11y.ventureYearOfPlenty')}
        >
          <p className="venture-panel__prompt">{t('venture.yopPrompt')}</p>
          <div className="venture-panel__rows">
            {TRADE_RESOURCE_ORDER.map((resource) => (
              <div className="trade-row" key={resource}>
                <span className="trade-row__label">
                  <ResourceGlyph resource={resource} color={RESOURCE_COLOR[resource]} />
                  {t(RESOURCE_KEY[resource])}
                </span>
                <span className="trade-stepper">
                  <button
                    type="button"
                    className="trade-stepper__btn"
                    onClick={() => editYop(resource, -1)}
                    disabled={yopSelection[resource] <= 0}
                    aria-label={t('venture.yopRemoveResource', {
                      resource: t(RESOURCE_KEY[resource]),
                    })}
                  >
                    −
                  </button>
                  <b className="trade-stepper__count">
                    {formatNumber(yopSelection[resource])}
                  </b>
                  <button
                    type="button"
                    className="trade-stepper__btn"
                    onClick={() => editYop(resource, 1)}
                    disabled={yopSelection[resource] >= yopMaxFor(resource)}
                    aria-label={t('venture.yopAddResource', {
                      resource: t(RESOURCE_KEY[resource]),
                    })}
                  >
                    +
                  </button>
                </span>
              </div>
            ))}
          </div>
          <div className="venture-panel__foot">
            <p className="venture-panel__counter" aria-live="polite">
              {t('venture.yopCounter', { count: yopTotal })}
            </p>
            <Button variant="quiet" onClick={backToList}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={confirmYearOfPlenty}
              disabled={!canConfirmYop}
            >
              {t('venture.play')}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (view === 'monopoly') {
    return (
      <section className="venture-panel" aria-label={t('venture.title')}>
        <div
          className="venture-panel__picker"
          role="group"
          aria-label={t('a11y.ventureMonopoly')}
        >
          <p className="venture-panel__prompt">{t('venture.monopolyPrompt')}</p>
          <div className="venture-panel__monopoly-options">
            {TRADE_RESOURCE_ORDER.map((resource) => (
              <button
                key={resource}
                type="button"
                className="venture-panel__monopoly-option"
                aria-pressed={monopolyResource === resource}
                onClick={() => setMonopolyResource(resource)}
              >
                <ResourceGlyph resource={resource} color={RESOURCE_COLOR[resource]} />
                {t(RESOURCE_KEY[resource])}
              </button>
            ))}
          </div>
          <div className="venture-panel__foot">
            <Button variant="quiet" onClick={backToList}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={confirmMonopoly}
              disabled={!canConfirmMonopoly}
            >
              {t('venture.play')}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="venture-panel" aria-label={t('venture.title')}>
      <div className="venture-panel__header">
        <span className="venture-panel__header-title">{t('venture.title')}</span>
        <Button variant="quiet" onClick={buy} disabled={!canBuy}>
          {t('venture.buyButton')}
        </Button>
      </div>
      <div className="venture-panel__buy-row">
        <span className="venture-panel__buy-cost">
          {Object.entries(DEV_CARD_BUY_COST).map(([resource, amount]) => (
            <span key={resource} className="venture-panel__buy-cost-item">
              <ResourceGlyph
                resource={resource as ResourceType}
                color={RESOURCE_COLOR[resource as ClassicResource] ?? 'var(--muted)'}
              />
              {formatNumber(amount)}
            </span>
          ))}
        </span>
        {gameState.devDeckRemaining !== undefined ? (
          <span className="venture-panel__deck-remaining">
            {t('venture.deckRemaining', { count: gameState.devDeckRemaining })}
          </span>
        ) : null}
      </div>

      {heldKinds.length === 0 ? (
        <p className="venture-panel__empty">{t('venture.empty')}</p>
      ) : (
        <div className="venture-panel__rows">
          {heldKinds.map((kind) => {
            const held = holdings.held[kind] ?? 0;
            const playable = playableCount(gameState, myPlayerId, kind);
            const showBoughtHint =
              isResourcePickerKind(kind) &&
              playable === 0 &&
              !gameState.devCardPlayedThisTurn;
            return (
              <div className="venture-panel__row" key={kind}>
                <span className="venture-panel__row-name">
                  {t(VENTURE_KIND_KEY[kind])}
                </span>
                <span className="venture-panel__row-count">{formatNumber(held)}</span>
                {isResourcePickerKind(kind) ? (
                  <Button
                    variant="quiet"
                    disabled={!canPlayVenture(gameState, myPlayerId, kind)}
                    onClick={() => openPicker(kind)}
                  >
                    {t('venture.play')}
                  </Button>
                ) : null}
                {showBoughtHint ? (
                  <span className="venture-panel__hint">
                    {t('venture.boughtThisTurnHint')}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="venture-panel__foot">
        <Button variant="quiet" onClick={() => setVentureOpen(false)}>
          {t('venture.close')}
        </Button>
      </div>
    </section>
  );
}
