// OfferCard — DESIGN.md §7/§11, three states:
//  • incoming: an open offer where I'm a target — a docked card (NEVER a
//    screen-blocking modal, §7.5) with the deal in my-seat perspective and
//    Accept (primary) / Decline (quiet, ≥16px apart) / Counter (bounded).
//  • outgoing: my open proposal — the deal + Withdraw, and the visibly-
//    distinct pending-seal state (§7.6, gentle wax pulse, reduced-motion safe).
//  • history: a compact settled/declined/cancelled past-deal row — the visual
//    grammar the ship's-log will reuse (rendered from the store `tradeLog`).
import './components.css';
import './trade.css';

import { useTranslation } from '../../i18n/index.js';
import type { FlotillaId } from '../../theme/flotillaColors.js';
import { FlotillaEmblem } from '../flotillaEmblems.js';
import type { ClassicResource } from '../resourceGlyphs.js';
import { ResourceGlyph } from '../resourceGlyphs.js';
import { RESOURCE_KEY } from '../resourceLabels.js';
import type { Bundle, TradeLogKind } from '../trade.js';
import { bundleItems } from '../trade.js';

const RESOURCE_COLOR: Readonly<Record<ClassicResource, string>> = {
  timber: 'var(--res-timber)',
  clay: 'var(--res-clay)',
  fleece: 'var(--res-fleece)',
  barley: 'var(--res-barley)',
  iron: 'var(--res-iron)',
};

type IncomingProps = {
  readonly variant: 'incoming';
  readonly proposerFlotillaId: FlotillaId;
  readonly proposerColorCss: string;
  readonly proposerLabel: string;
  /** Proposer-perspective bundles (raw offer): they give / they want. */
  readonly theyGive: Bundle;
  readonly theyGet: Bundle;
  readonly isCounter: boolean;
  readonly canAccept: boolean;
  readonly canCounter: boolean;
  readonly pending: boolean;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onCounter: () => void;
};

type OutgoingProps = {
  readonly variant: 'outgoing';
  /** My (proposer) perspective bundles. */
  readonly give: Bundle;
  readonly get: Bundle;
  readonly pending: boolean;
  readonly onWithdraw: () => void;
};

type HistoryProps = {
  readonly variant: 'history';
  readonly kind: TradeLogKind;
  readonly actorLabel: string;
  readonly statusLabel: string;
  readonly give?: Bundle;
  readonly get?: Bundle;
};

export type OfferCardProps = IncomingProps | OutgoingProps | HistoryProps;

/** Inline glyph+count run for a bundle's positive items (icon-first, §6). */
function DealBundle({ bundle }: { readonly bundle: Bundle }) {
  const { t, formatNumber } = useTranslation();
  const items = bundleItems(bundle);
  return (
    <>
      {items.map(({ resource, count }) => (
        <span
          key={resource}
          className="offer-card__deal-group"
          aria-label={t('a11y.resourceCount', {
            resource: t(RESOURCE_KEY[resource]),
            count,
          })}
        >
          <ResourceGlyph resource={resource} color={RESOURCE_COLOR[resource]} />
          <b className="offer-card__deal-count">{formatNumber(count)}</b>
        </span>
      ))}
    </>
  );
}

/**
 * Localized comma-joined "N resource" list, for the "in words" sentence. The
 * resource noun is lower-cased for the running sentence (DESIGN.md §7.2:
 * "2 руно, 1 железо") — the `resource.*` labels are Title-Case for standalone
 * pills, so this mid-sentence use lower-cases them per the active locale (nit 3
 * from the S1.6.4 review).
 */
function useItemsText() {
  const { t, locale } = useTranslation();
  return (bundle: Bundle): string =>
    bundleItems(bundle)
      .map(({ resource, count }) =>
        t('trade.item', {
          count,
          resource: t(RESOURCE_KEY[resource]).toLocaleLowerCase(locale),
        }),
      )
      .join(', ');
}

export function OfferCard(props: OfferCardProps) {
  if (props.variant === 'incoming') return <IncomingCard {...props} />;
  if (props.variant === 'outgoing') return <OutgoingCard {...props} />;
  return <HistoryRow {...props} />;
}

function IncomingCard(props: IncomingProps) {
  const { t } = useTranslation();
  const itemsText = useItemsText();
  // My-seat perspective: I GIVE what they want (`theyGet`), I RECEIVE what
  // they give (`theyGive`) — the tested `flip` from `trade.ts`.
  const myGive = props.theyGet;
  const myGet = props.theyGive;
  const words = t('trade.dealSentence', {
    give: itemsText(myGive),
    get: itemsText(myGet),
  });
  const fromLabel = props.isCounter
    ? t('trade.counters', { flotilla: props.proposerLabel })
    : t('trade.proposes', { flotilla: props.proposerLabel });

  return (
    <section className="offer-card" aria-label={t('trade.incomingTitle')}>
      <div className="offer-card__from">
        <span className="offer-card__emblem">
          <FlotillaEmblem
            flotillaId={props.proposerFlotillaId}
            color={props.proposerColorCss}
          />
        </span>
        <span className="offer-card__from-name">{fromLabel}</span>
      </div>

      <div className="offer-card__deal">
        <DealBundle bundle={myGet} />
        <span className="offer-card__arrow" aria-hidden="true">
          →
        </span>
        <DealBundle bundle={myGive} />
      </div>

      <p className="offer-card__words">{words}</p>

      {/* Server-truth pending state (§7.6): once I respond, the deal is pending
          the server echo — show it AND disable every response so a second click
          can't dispatch a duplicate intent (S1.6.4-review nit 1: the real send
          lands in S1.6.5, so the double-dispatch guard becomes load-bearing). */}
      {props.pending ? (
        <div className="offer-card__pending">
          <span className="offer-card__seal" aria-hidden="true">
            ◈
          </span>
          {t('trade.pendingSeal')}
        </div>
      ) : null}

      <div className="offer-card__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={props.onAccept}
          disabled={!props.canAccept || props.pending}
          aria-label={!props.canAccept ? t('trade.acceptCannotAfford') : undefined}
          title={!props.canAccept ? t('trade.acceptCannotAfford') : undefined}
        >
          {t('trade.accept')}
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={props.onDecline}
          disabled={props.pending}
        >
          {t('trade.decline')}
        </button>
        <button
          type="button"
          className="offer-card__counter"
          onClick={props.onCounter}
          disabled={!props.canCounter || props.pending}
          aria-label={!props.canCounter ? t('trade.counterDisabledDepth') : undefined}
          title={!props.canCounter ? t('trade.counterDisabledDepth') : undefined}
        >
          {t('trade.counter')}
        </button>
      </div>
    </section>
  );
}

function OutgoingCard(props: OutgoingProps) {
  const { t } = useTranslation();
  const itemsText = useItemsText();
  const words = t('trade.dealSentence', {
    give: itemsText(props.give),
    get: itemsText(props.get),
  });

  return (
    <section className="offer-card" aria-label={t('trade.outgoingTitle')}>
      <div className="offer-card__from">
        <span className="offer-card__from-name">{t('trade.outgoingTitle')}</span>
      </div>

      <div className="offer-card__deal">
        <DealBundle bundle={props.give} />
        <span className="offer-card__arrow" aria-hidden="true">
          ⇄
        </span>
        <DealBundle bundle={props.get} />
      </div>

      <p className="offer-card__words">{words}</p>

      {props.pending ? (
        <div className="offer-card__pending">
          <span className="offer-card__seal" aria-hidden="true">
            ◈
          </span>
          {t('trade.pendingSeal')}
        </div>
      ) : (
        <div className="offer-card__pending">{t('trade.awaitingResponse')}</div>
      )}

      <div className="offer-card__actions">
        <button type="button" className="btn btn--danger" onClick={props.onWithdraw}>
          {t('trade.withdraw')}
        </button>
      </div>
    </section>
  );
}

function HistoryRow(props: HistoryProps) {
  const accepted = props.kind === 'accepted';
  return (
    <div className="offer-card offer-card--history">
      <div className="offer-card__from">
        <span className="offer-card__from-name">{props.actorLabel}</span>
        <span
          className={
            accepted
              ? 'offer-card__status offer-card__status--accepted'
              : 'offer-card__status'
          }
          style={{ marginLeft: 'auto' }}
        >
          {props.statusLabel}
        </span>
      </div>
      {props.give || props.get ? (
        <div className="offer-card__deal">
          {props.give ? <DealBundle bundle={props.give} /> : null}
          <span className="offer-card__arrow" aria-hidden="true">
            ⇄
          </span>
          {props.get ? <DealBundle bundle={props.get} /> : null}
        </div>
      ) : null}
    </div>
  );
}
