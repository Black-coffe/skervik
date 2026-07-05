// OfferBuilder — DESIGN.md §7 the heart. A fixed-geometry docked panel (NOT a
// modal, §7.1): a give-column | ⇄ | receive-column of per-resource steppers,
// a live "in words" deal summary, and a two-step seal (§7.2: compose → arm →
// confirm, 150ms disabled-then-armed guard). Impossible offers are unsendable
// (§7 anti-misclick): steppers clamp to my hand, an empty/unaffordable bundle
// disables the seal with a localized reason (pure `canComposeOffer`; core
// `validate` is NEVER called client-side). Used for BOTH proposing (mode
// 'propose') and countering in-place (mode 'counter', pre-filled via a fresh
// mount).
import './components.css';
import './trade.css';

import { useEffect, useRef, useState } from 'react';

import { useTranslation } from '../../i18n/index.js';
import type { ClassicResource } from '../resourceGlyphs.js';
import { ResourceGlyph } from '../resourceGlyphs.js';
import { RESOURCE_KEY } from '../resourceLabels.js';
import type { Bundle } from '../trade.js';
import {
  bundleItems,
  canComposeOffer,
  clampStep,
  emptyBundle,
  TRADE_RESOURCE_ORDER,
} from '../trade.js';
import { Button } from './Button.js';

// Reinforcing color per resource (§2.3) — always paired with the distinct
// `ResourceGlyph` silhouette, never a bare swatch. Mirrors `tokens.css`.
const RESOURCE_COLOR: Readonly<Record<ClassicResource, string>> = {
  timber: 'var(--res-timber)',
  clay: 'var(--res-clay)',
  fleece: 'var(--res-fleece)',
  barley: 'var(--res-barley)',
  iron: 'var(--res-iron)',
};

// The requested (`get`) column has no core cap — clamp to a single digit so
// the stepper width (and the panel geometry) never grows (§7.1).
const GET_MAX = 9;

type SealPhase = 'compose' | 'arming' | 'armed';

export interface OfferBuilderProps {
  /** My current hand — give steppers clamp to it. */
  readonly hand: Bundle;
  readonly mode: 'propose' | 'counter';
  /** Pre-fill for counter mode (roles already flipped to my seat by the caller). */
  readonly initialGive?: Bundle;
  readonly initialGet?: Bundle;
  readonly onSeal: (give: Bundle, get: Bundle) => void;
  /** Counter mode only — abandon the counter and return to the incoming card. */
  readonly onCancel?: () => void;
}

function toEditable(source?: Bundle): Record<ClassicResource, number> {
  const bundle = emptyBundle();
  if (source) {
    for (const resource of TRADE_RESOURCE_ORDER) {
      bundle[resource] = source[resource] ?? 0;
    }
  }
  return bundle;
}

export function OfferBuilder({
  hand,
  mode,
  initialGive,
  initialGet,
  onSeal,
  onCancel,
}: OfferBuilderProps) {
  const { t } = useTranslation();
  const [give, setGive] = useState(() => toEditable(initialGive));
  const [get, setGet] = useState(() => toEditable(initialGet));
  const [phase, setPhase] = useState<SealPhase>('compose');
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    };
  }, []);

  // Any edit to the deal invalidates a pending confirm — re-arm from scratch
  // so a player can never seal a deal they didn't just confirm (§7.2).
  function editGive(resource: ClassicResource, delta: number) {
    setPhase('compose');
    setGive((prev) => ({
      ...prev,
      [resource]: clampStep(prev[resource], delta, hand[resource] ?? 0),
    }));
  }

  function editGet(resource: ClassicResource, delta: number) {
    setPhase('compose');
    setGet((prev) => ({
      ...prev,
      [resource]: clampStep(prev[resource], delta, GET_MAX),
    }));
  }

  const compose = canComposeOffer(hand, give, get);

  const itemsText = (bundle: Bundle): string =>
    bundleItems(bundle)
      .map(({ resource, count }) =>
        t('trade.item', { count, resource: t(RESOURCE_KEY[resource]) }),
      )
      .join(', ');

  const dealSentence = t('trade.dealSentence', {
    give: itemsText(give),
    get: itemsText(get),
  });

  const reasonText = !compose.ok
    ? compose.reason === 'emptyGive'
      ? t('trade.reasonEmptyGive')
      : compose.reason === 'emptyGet'
        ? t('trade.reasonEmptyGet')
        : t('trade.reasonCannotAfford')
    : '';

  function handlePrimary() {
    if (phase === 'armed') {
      onSeal(give, get);
      if (mode === 'propose') {
        setGive(emptyBundle());
        setGet(emptyBundle());
      }
      setPhase('compose');
      return;
    }
    if (phase === 'compose' && compose.ok) {
      // Two-step seal: arm, then a 150ms disabled window before confirm is
      // clickable — the anti-double-click guard (§7.2).
      setPhase('arming');
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setPhase('armed'), 150);
    }
  }

  function handleSecondary() {
    if (phase !== 'compose') {
      setPhase('compose');
      return;
    }
    if (mode === 'counter') {
      onCancel?.();
      return;
    }
    setGive(emptyBundle());
    setGet(emptyBundle());
  }

  const arming = phase !== 'compose';
  const primaryLabel = arming
    ? mode === 'counter'
      ? t('trade.confirmCounter')
      : t('trade.confirmSeal')
    : mode === 'counter'
      ? t('trade.sendCounter')
      : t('trade.seal');
  const primaryDisabled = arming ? phase === 'arming' : !compose.ok;
  const secondaryLabel = arming
    ? t('trade.back')
    : mode === 'counter'
      ? t('common.cancel')
      : t('trade.clear');

  const title = mode === 'counter' ? t('trade.counterTitle') : t('trade.title');
  const showReason = !arming && !compose.ok;

  return (
    <section className="offer-builder" aria-label={title}>
      <div className="offer-builder__header">{title}</div>

      <div className="offer-builder__cols">
        <div className="offer-builder__col">
          <h4 className="offer-builder__col-title">{t('trade.giveColumn')}</h4>
          {TRADE_RESOURCE_ORDER.map((resource) => (
            <Stepper
              key={resource}
              resource={resource}
              value={give[resource]}
              max={hand[resource] ?? 0}
              onDelta={(delta) => editGive(resource, delta)}
              addLabel={t('trade.addResource', { resource: t(RESOURCE_KEY[resource]) })}
              removeLabel={t('trade.removeResource', {
                resource: t(RESOURCE_KEY[resource]),
              })}
            />
          ))}
        </div>

        <div className="offer-builder__swap" aria-hidden="true">
          ⇄
        </div>

        <div className="offer-builder__col">
          <h4 className="offer-builder__col-title">{t('trade.receiveColumn')}</h4>
          {TRADE_RESOURCE_ORDER.map((resource) => (
            <Stepper
              key={resource}
              resource={resource}
              value={get[resource]}
              max={GET_MAX}
              onDelta={(delta) => editGet(resource, delta)}
              addLabel={t('trade.addResource', { resource: t(RESOURCE_KEY[resource]) })}
              removeLabel={t('trade.removeResource', {
                resource: t(RESOURCE_KEY[resource]),
              })}
            />
          ))}
        </div>
      </div>

      <p
        className={
          showReason
            ? 'offer-builder__summary offer-builder__summary--reason'
            : 'offer-builder__summary'
        }
      >
        {showReason ? reasonText : dealSentence}
      </p>
      {!arming && compose.ok ? (
        <p className="offer-builder__summary">{t('trade.offerToAll')}</p>
      ) : null}

      <div className="offer-builder__foot">
        <Button variant="quiet" onClick={handleSecondary}>
          {secondaryLabel}
        </Button>
        <Button
          variant="primary"
          onClick={handlePrimary}
          disabled={primaryDisabled}
          aria-label={showReason ? reasonText : undefined}
          title={showReason ? reasonText : undefined}
        >
          {primaryLabel}
        </Button>
      </div>
    </section>
  );
}

interface StepperProps {
  readonly resource: ClassicResource;
  readonly value: number;
  readonly max: number;
  readonly onDelta: (delta: number) => void;
  readonly addLabel: string;
  readonly removeLabel: string;
}

function Stepper({ resource, value, max, onDelta, addLabel, removeLabel }: StepperProps) {
  const { t, formatNumber } = useTranslation();
  return (
    <div className="trade-row">
      <span className="trade-row__label">
        <ResourceGlyph resource={resource} color={RESOURCE_COLOR[resource]} />
        {t(RESOURCE_KEY[resource])}
      </span>
      <span className="trade-stepper">
        <button
          type="button"
          className="trade-stepper__btn"
          onClick={() => onDelta(-1)}
          disabled={value <= 0}
          aria-label={removeLabel}
        >
          −
        </button>
        <b className="trade-stepper__count">{formatNumber(value)}</b>
        <button
          type="button"
          className="trade-stepper__btn"
          onClick={() => onDelta(1)}
          disabled={value >= max}
          aria-label={addLabel}
        >
          +
        </button>
      </span>
    </div>
  );
}
