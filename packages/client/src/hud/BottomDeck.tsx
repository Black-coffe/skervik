// BottomDeck — DESIGN.md §6/§7: MY hand as icon+count Pills (full
// breakdown, icon-first for colorblind read), action buttons in FIXED
// positions (build/trade/venture/end turn), and a tide-lot/die placeholder.
// S2.8.3a wires the two resource-free turn actions (roll + end turn); Build/
// Trade/Venture stay disabled (later stories: S2.8.3b, S2.7.1 dock focus,
// S2.8.5). Buttons disable, they never disappear or shift (§6).
import './BottomDeck.css';

import { useTranslation } from '../i18n/index.js';
import { Button } from './components/Button.js';
import { Pill } from './components/Pill.js';
import { ResourceGlyph } from './resourceGlyphs.js';
import { RESOURCE_KEY } from './resourceLabels.js';
import { useUiStore } from './store.js';
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

export function BottomDeck() {
  const { t, formatNumber } = useTranslation();
  const gameState = useUiStore((state) => state.gameState);
  const myPlayerId = useUiStore((state) => state.myPlayerId);
  const dispatchIntent = useUiStore((state) => state.dispatchIntent);

  const me = gameState.players.find((p) => p.id === myPlayerId);
  const resources = me?.resources ?? {};

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
        <Button variant="quiet" disabled>
          {t('hud.actionBuild')}
        </Button>
        <Button variant="quiet" disabled>
          {t('hud.actionTrade')}
        </Button>
        <Button variant="quiet" disabled>
          {t('hud.actionVenture')}
        </Button>
        <Button
          variant="primary"
          disabled={!canEndTurn(gameState, myPlayerId)}
          onClick={() => dispatchIntent({ type: 'intent.endTurn', playerId: myPlayerId })}
        >
          {t('hud.actionEndTurn')}
        </Button>
      </div>
    </div>
  );
}
