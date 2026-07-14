// BottomDeck — DESIGN.md §6/§7: MY hand as icon+count Pills (full
// breakdown, icon-first for colorblind read), action buttons in FIXED
// positions (build/trade/venture/end turn), and a tide-lot/die placeholder.
// S2.8.3a wires the two resource-free turn actions (roll + end turn);
// S2.8.3b wires Build; S2.8.5a wires the Venture toggle (opens
// `<VenturePanel/>`, rendered by `GameScreen`). Trade stays disabled (S2.7.1
// dock focus). Buttons disable, they never disappear or shift (§6).
import './BottomDeck.css';

import { useState } from 'react';

import type { BuildType } from '../board/buildLegality.js';
import { buildCost, canBuildType } from '../board/buildLegality.js';
import { useTranslation } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/keys.js';
import { Button } from './components/Button.js';
import { Pill } from './components/Pill.js';
import { ResourceGlyph } from './resourceGlyphs.js';
import { RESOURCE_KEY } from './resourceLabels.js';
import { selectIsMyTurn, useUiStore } from './store.js';
import { canEndTurn, canRoll } from './turnActions.js';

// Resource colors mirror `theme/tokens.css` §2.3 — used ONLY to tint each
// resource's distinct `ResourceGlyph` SILHOUETTE (never a bare color swatch
// on its own): DESIGN.md §2.3 "resources are NEVER hue-only" requires a
// unique icon shape per resource, which `ResourceGlyph` supplies; color here
// is the reinforcing second cue, not the sole one.
const RESOURCE_COLOR: Readonly<Record<string, string>> = {
  timber: 'var(--res-timber)',
  clay: 'var(--res-clay)',
  fleece: 'var(--res-fleece)',
  barley: 'var(--res-barley)',
  iron: 'var(--res-iron)',
};

// Fixed Classic resource order (`docs/wiki/lore-primer.md` §"Экономика: пять
// товаров") — the FULL breakdown always shows all 5 in this stable order,
// even at 0, so the pill row never reflows as a player's hand changes
// (mirrors the action buttons' "fixed positions" discipline, §6).
const RESOURCE_ORDER = ['timber', 'clay', 'fleece', 'barley', 'iron'] as const;

// The build-type selector's fixed order + labels (S2.8.3b). Fixed so the
// selector never reflows as affordability toggles buttons enabled/disabled (§6).
const BUILD_TYPES = [
  'settlement',
  'road',
  'city',
] as const satisfies readonly BuildType[];
const BUILD_TYPE_KEY: Readonly<Record<BuildType, TranslationKey>> = {
  settlement: 'build.typeSettlement',
  road: 'build.typeRoad',
  city: 'build.typeCity',
};

export function BottomDeck() {
  const { t, formatNumber } = useTranslation();
  const gameState = useUiStore((state) => state.gameState);
  const myPlayerId = useUiStore((state) => state.myPlayerId);
  const dispatchIntent = useUiStore((state) => state.dispatchIntent);
  const buildMode = useUiStore((state) => state.buildMode);
  const setBuildMode = useUiStore((state) => state.setBuildMode);
  const ventureOpen = useUiStore((state) => state.ventureOpen);
  const setVentureOpen = useUiStore((state) => state.setVentureOpen);
  // Selector visibility is local UI (which piece is ARMED lives in the store as
  // `buildMode`; whether the chooser is open is this component's own concern).
  const [selectorOpen, setSelectorOpen] = useState(false);

  const me = gameState.players.find((p) => p.id === myPlayerId);
  const resources = me?.resources ?? {};
  const canBuild = gameState.phase === 'main' && selectIsMyTurn(gameState, myPlayerId);

  const closeBuild = () => {
    setSelectorOpen(false);
    setBuildMode('none');
    setVentureOpen(false);
  };

  return (
    <div className="bottom-deck">
      <div className="bottom-deck__resources">
        <span className="bottom-deck__section-label">{t('hud.resources')}</span>
        <div className="bottom-deck__pills">
          {RESOURCE_ORDER.map((resource) => (
            <Pill
              key={resource}
              variant="resource"
              icon={
                <ResourceGlyph
                  resource={resource}
                  color={RESOURCE_COLOR[resource] ?? 'var(--muted)'}
                />
              }
              aria-label={t('a11y.resourceCount', {
                resource: t(RESOURCE_KEY[resource]),
                count: resources[resource] ?? 0,
              })}
            >
              {formatNumber(resources[resource] ?? 0)}
            </Pill>
          ))}
        </div>
      </div>

      <div className="bottom-deck__tide-lot">
        <span>{t('hud.tideLotPlaceholder')}</span>
        <Button
          variant="primary"
          disabled={!canRoll(gameState, myPlayerId)}
          onClick={() =>
            dispatchIntent({ type: 'intent.rollDice', playerId: myPlayerId })
          }
        >
          {t('hud.actionRoll')}
        </Button>
      </div>

      <div className="bottom-deck__actions">
        {selectorOpen && canBuild ? (
          <div
            className="bottom-deck__build-selector"
            role="group"
            aria-label={t('a11y.buildSelector')}
          >
            {BUILD_TYPES.map((type) => (
              <Button
                key={type}
                variant={buildMode === type ? 'primary' : 'quiet'}
                disabled={!canBuildType(gameState, resources, myPlayerId, type)}
                aria-pressed={buildMode === type}
                onClick={() => setBuildMode(buildMode === type ? 'none' : type)}
              >
                <span className="bottom-deck__build-type-name">
                  {t(BUILD_TYPE_KEY[type])}
                </span>
                <span className="bottom-deck__build-type-cost">
                  {Object.entries(buildCost(type)).map(([resource, amount]) => (
                    <span key={resource} className="bottom-deck__build-type-cost-item">
                      <ResourceGlyph
                        resource={resource}
                        color={RESOURCE_COLOR[resource] ?? 'var(--muted)'}
                      />
                      {formatNumber(amount)}
                    </span>
                  ))}
                </span>
              </Button>
            ))}
            <Button variant="quiet" onClick={closeBuild}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : null}
        <Button
          variant="quiet"
          disabled={!canBuild}
          aria-expanded={selectorOpen && canBuild}
          onClick={() => (selectorOpen ? closeBuild() : setSelectorOpen(true))}
        >
          {t('hud.actionBuild')}
        </Button>
        <Button variant="quiet" disabled>
          {t('hud.actionTrade')}
        </Button>
        <Button
          variant="quiet"
          disabled={!canBuild}
          aria-expanded={ventureOpen}
          onClick={() => setVentureOpen(!ventureOpen)}
        >
          {t('hud.actionVenture')}
        </Button>
        <Button
          variant="primary"
          disabled={!canEndTurn(gameState, myPlayerId)}
          onClick={() => {
            closeBuild();
            dispatchIntent({ type: 'intent.endTurn', playerId: myPlayerId });
          }}
        >
          {t('hud.actionEndTurn')}
        </Button>
      </div>
    </div>
  );
}
