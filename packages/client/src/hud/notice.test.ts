import { describe, expect, it } from 'vitest';

import { noticeCopy, rejectCopy } from './notice.js';

describe('rejectCopy', () => {
  it('maps a known trade/turn reason to its specific key (no code param)', () => {
    expect(rejectCopy('CANNOT_AFFORD')).toEqual({ key: 'reject.cannotAfford' });
    expect(rejectCopy('NOT_YOUR_TURN')).toEqual({ key: 'reject.notYourTurn' });
    expect(rejectCopy('TRADE_COUNTER_LIMIT_REACHED')).toEqual({
      key: 'reject.counterLimitReached',
    });
  });

  it('falls back to the generic key carrying the machine code for an unmapped reason', () => {
    expect(rejectCopy('SUPPLY_EXHAUSTED')).toEqual({
      key: 'reject.generic',
      code: 'SUPPLY_EXHAUSTED',
    });
  });
});

describe('noticeCopy', () => {
  it('renders a mapped reject with just its key', () => {
    expect(noticeCopy({ kind: 'reject', reason: 'NO_OPEN_TRADE_OFFER' })).toEqual({
      key: 'reject.noOpenTradeOffer',
    });
  });

  it('carries the code param for an unmapped reject through the generic key', () => {
    expect(noticeCopy({ kind: 'reject', reason: 'DECK_EMPTY' })).toEqual({
      key: 'reject.generic',
      params: { code: 'DECK_EMPTY' },
    });
  });

  it('maps an infra error to the generic try-again copy', () => {
    expect(noticeCopy({ kind: 'error' })).toEqual({ key: 'notice.tryAgain' });
  });
});
