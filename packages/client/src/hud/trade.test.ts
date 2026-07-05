import type { PlayerIntent, TradeOffer } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import {
  bundleItems,
  bundleTotal,
  canAffordBundle,
  canComposeOffer,
  clampStep,
  emptyBundle,
  flipToTargetPerspective,
  isNonEmptyBundle,
  tradeLogEntryFromIntent,
} from './trade.js';

const HAND = { timber: 3, clay: 0, fleece: 2, barley: 1, iron: 0 };

describe('bundleTotal / isNonEmptyBundle', () => {
  it('sums positive entries and treats a zero bundle as empty', () => {
    expect(bundleTotal(emptyBundle())).toBe(0);
    expect(isNonEmptyBundle(emptyBundle())).toBe(false);
    expect(bundleTotal({ ...emptyBundle(), fleece: 2 })).toBe(2);
    expect(isNonEmptyBundle({ ...emptyBundle(), fleece: 2 })).toBe(true);
  });

  it('ignores negative entries in the total (steppers never emit them)', () => {
    expect(bundleTotal({ ...emptyBundle(), timber: -5 })).toBe(0);
  });
});

describe('canAffordBundle', () => {
  it('is true only when the hand covers every requested unit', () => {
    expect(canAffordBundle(HAND, { ...emptyBundle(), fleece: 2 })).toBe(true);
    expect(canAffordBundle(HAND, { ...emptyBundle(), fleece: 3 })).toBe(false);
    expect(canAffordBundle(HAND, { ...emptyBundle(), iron: 1 })).toBe(false);
  });
});

describe('canComposeOffer — impossible offers are unsendable', () => {
  it('rejects an empty give', () => {
    const result = canComposeOffer(HAND, emptyBundle(), { ...emptyBundle(), iron: 1 });
    expect(result).toEqual({ ok: false, reason: 'emptyGive' });
  });

  it('rejects an empty get', () => {
    const result = canComposeOffer(HAND, { ...emptyBundle(), fleece: 1 }, emptyBundle());
    expect(result).toEqual({ ok: false, reason: 'emptyGet' });
  });

  it('rejects a give the hand cannot afford', () => {
    const result = canComposeOffer(
      HAND,
      { ...emptyBundle(), iron: 1 },
      { ...emptyBundle(), timber: 1 },
    );
    expect(result).toEqual({ ok: false, reason: 'cannotAfford' });
  });

  it('accepts a non-empty, affordable give against a non-empty get', () => {
    const result = canComposeOffer(
      HAND,
      { ...emptyBundle(), fleece: 2 },
      { ...emptyBundle(), iron: 1 },
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('flipToTargetPerspective — the classic trade-UI bug', () => {
  it('swaps give/get so a target sees the deal from their own seat', () => {
    const proposerGive = { ...emptyBundle(), fleece: 3 };
    const proposerGet = { ...emptyBundle(), iron: 1 };
    const flipped = flipToTargetPerspective({ give: proposerGive, get: proposerGet });
    // As a target: I GIVE the proposer's `get` (iron), I RECEIVE their `give` (fleece).
    expect(flipped.give).toBe(proposerGet);
    expect(flipped.get).toBe(proposerGive);
  });
});

describe('clampStep', () => {
  it('clamps into [0, max]', () => {
    expect(clampStep(0, -1, 5)).toBe(0);
    expect(clampStep(5, 1, 5)).toBe(5);
    expect(clampStep(2, 1, 5)).toBe(3);
    expect(clampStep(2, -1, 5)).toBe(1);
  });
});

describe('bundleItems', () => {
  it('lists positive entries in the fixed resource order', () => {
    const items = bundleItems({ timber: 0, clay: 1, fleece: 2, barley: 0, iron: 1 });
    expect(items).toEqual([
      { resource: 'clay', count: 1 },
      { resource: 'fleece', count: 2 },
      { resource: 'iron', count: 1 },
    ]);
  });
});

const OFFER: TradeOffer = {
  proposerId: 'player-2',
  give: { ...emptyBundle(), fleece: 3 },
  get: { ...emptyBundle(), iron: 1 },
  targets: ['player-1'],
  depth: 0,
};

describe('tradeLogEntryFromIntent', () => {
  it('maps a proposeTrade to a proposed entry from the actor perspective', () => {
    const intent: PlayerIntent = {
      type: 'intent.proposeTrade',
      playerId: 'player-1',
      give: { ...emptyBundle(), timber: 1 },
      get: { ...emptyBundle(), clay: 1 },
    };
    expect(tradeLogEntryFromIntent(intent, undefined, 4, 0)).toEqual({
      id: 0,
      kind: 'proposed',
      actorId: 'player-1',
      give: intent.give,
      get: intent.get,
      turn: 4,
    });
  });

  it('maps an acceptTrade to an accepted entry with the offer flipped to my seat', () => {
    const intent: PlayerIntent = { type: 'intent.acceptTrade', playerId: 'player-1' };
    const entry = tradeLogEntryFromIntent(intent, OFFER, 4, 7);
    expect(entry).toMatchObject({
      id: 7,
      kind: 'accepted',
      actorId: 'player-1',
      counterpartId: 'player-2',
      // I give the proposer's `get` (iron), I receive their `give` (fleece).
      give: OFFER.get,
      get: OFFER.give,
    });
  });

  it('maps a counterTrade to a countered entry aimed at the original proposer', () => {
    const intent: PlayerIntent = {
      type: 'intent.counterTrade',
      playerId: 'player-1',
      give: { ...emptyBundle(), iron: 1 },
      get: { ...emptyBundle(), fleece: 2 },
    };
    const entry = tradeLogEntryFromIntent(intent, OFFER, 4, 1);
    expect(entry).toMatchObject({
      kind: 'countered',
      counterpartId: 'player-2',
    });
  });

  it('returns null for a non-trade intent', () => {
    const intent: PlayerIntent = { type: 'intent.endTurn', playerId: 'player-1' };
    expect(tradeLogEntryFromIntent(intent, undefined, 4, 0)).toBeNull();
  });
});
