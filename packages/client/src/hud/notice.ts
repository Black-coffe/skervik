// Pure mapping from a core {@link RejectReason} to a localized notice key
// (S1.6.5, §7.6). No React, no I/O — unit-tested. Only the trade + turn reasons
// the M1 Trade UI can actually trigger are authored; the long tail (setup /
// robber / dev-card / bank reasons no current UI reaches) falls through to
// `reject.generic`, which surfaces the machine code. Authoring all ~30 reasons
// would be disproportionate now (story scope note); the rest are follow-up as
// their UIs land.
import type { RejectReason } from '@skervik/core';

import type { TranslationKey } from '../i18n/index.js';
import type { UiNotice } from './store.js';

const REJECT_KEY: Partial<Record<RejectReason, TranslationKey>> = {
  NOT_YOUR_TURN: 'reject.notYourTurn',
  CANNOT_AFFORD: 'reject.cannotAfford',
  TRADE_OFFER_ALREADY_OPEN: 'reject.tradeOfferAlreadyOpen',
  NO_OPEN_TRADE_OFFER: 'reject.noOpenTradeOffer',
  NOT_A_TRADE_TARGET: 'reject.notATradeTarget',
  NOT_TRADE_PROPOSER: 'reject.notTradeProposer',
  TRADE_COUNTER_LIMIT_REACHED: 'reject.counterLimitReached',
  GAME_ALREADY_ENDED: 'reject.gameAlreadyEnded',
};

export interface RejectCopy {
  readonly key: TranslationKey;
  /** The machine reason code, present ONLY for the generic fallback. */
  readonly code?: string;
}

/**
 * Resolve a reject reason to its notice copy: a mapped reason gets its specific
 * key; an unmapped one gets `reject.generic` carrying the raw `code` as an
 * interpolation param, so nothing is ever silently swallowed.
 */
export function rejectCopy(reason: RejectReason): RejectCopy {
  const key = REJECT_KEY[reason];
  return key ? { key } : { key: 'reject.generic', code: reason };
}

export interface NoticeCopy {
  readonly key: TranslationKey;
  /** Interpolation params for the key (only the generic reject carries `code`). */
  readonly params?: { readonly code: string };
}

/**
 * Resolve a {@link UiNotice} to the localized copy the {@link NoticeBar} renders
 * (`t(key, params)`). Pure — so the reject↔key mapping + the error fallback are
 * unit-tested without React/i18n.
 */
export function noticeCopy(notice: UiNotice): NoticeCopy {
  if (notice.kind === 'error') return { key: 'notice.tryAgain' };
  const copy = rejectCopy(notice.reason);
  return copy.code ? { key: copy.key, params: { code: copy.code } } : { key: copy.key };
}
