// TradeZone — DESIGN.md §6/§7: the docked trade surface, overlaid top-left of
// the Chart (fixed panels, NOT modals). It wires the zustand store to the
// presentational trade components and owns the small amount of local
// interaction state (counter mode). Every dispatched action goes through the
// store's `dispatchIntent` seam (a stub until S1.6.5 wires WS) — this
// component composes typed `PlayerIntent`s and never touches the network.
import './TradeZone.css';

import type { PlayerId, PlayerIntent } from '@skervik/core';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { useTranslation } from '../i18n/index.js';
import { flotillaForPlayer } from '../theme/flotillaColors.js';
import { OfferBuilder } from './components/OfferBuilder.js';
import { OfferCard } from './components/OfferCard.js';
import { FLOTILLA_KEY } from './flotillaLabels.js';
import {
  selectIsIncomingToMe,
  selectIsMyOutgoing,
  selectIsMyTurn,
  selectSeatOrder,
  useUiStore,
} from './store.js';
import type { Bundle, QuickReaction, TradeLogEntry } from './trade.js';
import { canAffordBundle, clampStep, TRADE_RESOURCE_ORDER } from './trade.js';

const RECENT_DEALS_SHOWN = 3;

const REACTIONS: readonly QuickReaction[] = ['agree', 'tooExpensive', 'thinking'];

const REACTION_KEY = {
  agree: 'trade.reactionAgree',
  tooExpensive: 'trade.reactionTooExpensive',
  thinking: 'trade.reactionThinking',
} as const;

const STATUS_KEY = {
  proposed: 'trade.statusProposed',
  countered: 'trade.statusCountered',
  accepted: 'trade.statusAccepted',
  declined: 'trade.statusDeclined',
  cancelled: 'trade.statusCancelled',
  reaction: 'trade.statusReaction',
} as const;

/** Frozen sRGB hex number → CSS `#rrggbb` (flotilla colors are numeric for Pixi). */
function toCssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function emptyHand(): Bundle {
  return { timber: 0, clay: 0, fleece: 0, barley: 0, iron: 0 };
}

/** Clamp each give entry to what I actually hold — a pre-fill can never be unaffordable. */
function clampGiveToHand(give: Bundle, hand: Bundle): Bundle {
  const out: Record<string, number> = {};
  for (const resource of TRADE_RESOURCE_ORDER) {
    out[resource] = clampStep(0, give[resource] ?? 0, hand[resource] ?? 0);
  }
  return out;
}

export function TradeZone() {
  const { t } = useTranslation();
  const gameState = useUiStore((s) => s.gameState);
  const myPlayerId = useUiStore((s) => s.myPlayerId);
  const tradeLog = useUiStore((s) => s.tradeLog);
  const pendingSeal = useUiStore((s) => s.pendingSeal);
  const dispatchIntent = useUiStore((s) => s.dispatchIntent);
  const sendReaction = useUiStore((s) => s.sendReaction);

  const [countering, setCountering] = useState(false);

  const seatOrder = selectSeatOrder(gameState);
  const offer = gameState.openTradeOffer;
  const isMyTurn = selectIsMyTurn(gameState, myPlayerId);
  const isIncoming = selectIsIncomingToMe(gameState, myPlayerId);
  const isOutgoing = selectIsMyOutgoing(gameState, myPlayerId);
  const myHand =
    gameState.players.find((p) => p.id === myPlayerId)?.resources ?? emptyHand();

  const flotillaLabel = (playerId: PlayerId): string => {
    const flotilla = flotillaForPlayer(playerId, seatOrder);
    return flotilla ? t(FLOTILLA_KEY[flotilla.id]) : playerId;
  };

  function dispatch(intent: PlayerIntent) {
    dispatchIntent(intent);
  }

  // --- The one active primary surface (builder | incoming | outgoing | hint) ---
  let primary: ReactElement;
  if (countering && offer) {
    const prefill = clampGiveToHand(offer.get, myHand);
    primary = (
      <OfferBuilder
        key="counter"
        mode="counter"
        hand={myHand}
        initialGive={prefill}
        initialGet={offer.give}
        onSeal={(give, get) => {
          dispatch({ type: 'intent.counterTrade', playerId: myPlayerId, give, get });
          setCountering(false);
        }}
        onCancel={() => setCountering(false)}
      />
    );
  } else if (isIncoming && offer) {
    const proposerFlotilla = flotillaForPlayer(offer.proposerId, seatOrder);
    primary = (
      <OfferCard
        variant="incoming"
        proposerFlotillaId={proposerFlotilla?.id ?? 'petrel'}
        proposerColorCss={toCssHex(proposerFlotilla?.color ?? 0x4682cc)}
        proposerLabel={flotillaLabel(offer.proposerId)}
        theyGive={offer.give}
        theyGet={offer.get}
        isCounter={offer.depth >= 1}
        canAccept={canAffordBundle(myHand, offer.get)}
        canCounter={offer.depth < 1}
        pending={pendingSeal !== null}
        onAccept={() => dispatch({ type: 'intent.acceptTrade', playerId: myPlayerId })}
        onDecline={() => dispatch({ type: 'intent.rejectTrade', playerId: myPlayerId })}
        onCounter={() => setCountering(true)}
      />
    );
  } else if (isOutgoing && offer) {
    primary = (
      <OfferCard
        variant="outgoing"
        give={offer.give}
        get={offer.get}
        pending={pendingSeal !== null}
        onWithdraw={() => dispatch({ type: 'intent.cancelTrade', playerId: myPlayerId })}
      />
    );
  } else if (isMyTurn && !offer) {
    primary = (
      <OfferBuilder
        key="propose"
        mode="propose"
        hand={myHand}
        onSeal={(give, get) =>
          dispatch({ type: 'intent.proposeTrade', playerId: myPlayerId, give, get })
        }
      />
    );
  } else {
    primary = (
      <p className="trade-zone__hint">
        {offer
          ? t('trade.builderDisabledOfferOpen')
          : t('trade.builderDisabledNotYourTurn')}
      </p>
    );
  }

  const recent = tradeLog.slice(-RECENT_DEALS_SHOWN).reverse();

  return (
    <div className="trade-zone" aria-label={t('a11y.tradePanel')}>
      <span className="trade-zone__sr-live" aria-live="polite">
        {isIncoming && offer
          ? t('trade.incomingAnnounce', { flotilla: flotillaLabel(offer.proposerId) })
          : ''}
      </span>

      {primary}

      {isIncoming && offer ? (
        <div className="trade-zone__reactions" aria-label={t('trade.reactionsLabel')}>
          {REACTIONS.map((reaction) => (
            <button
              key={reaction}
              type="button"
              className="btn btn--quiet trade-zone__reaction"
              onClick={() => sendReaction(reaction)}
            >
              {t(REACTION_KEY[reaction])}
            </button>
          ))}
        </div>
      ) : null}

      <div className="trade-zone__recent">
        <div className="trade-zone__recent-head">
          {tradeLog.length > 0
            ? t('trade.recentDeals', { count: tradeLog.length })
            : t('trade.recentEmpty')}
        </div>
        {recent.map((entry) => (
          <OfferCard
            key={entry.id}
            variant="history"
            kind={entry.kind}
            actorLabel={
              entry.actorId === myPlayerId
                ? t('trade.youLabel')
                : flotillaLabel(entry.actorId)
            }
            statusLabel={historyStatus(entry, t)}
            {...(entry.give ? { give: entry.give } : {})}
            {...(entry.get ? { get: entry.get } : {})}
          />
        ))}
      </div>
    </div>
  );
}

/** A history row's status text — the reaction's own label for a reaction, else the kind. */
function historyStatus(
  entry: TradeLogEntry,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (entry.kind === 'reaction' && entry.reaction) {
    return t(REACTION_KEY[entry.reaction]);
  }
  return t(STATUS_KEY[entry.kind]);
}
