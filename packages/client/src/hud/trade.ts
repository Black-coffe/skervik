// Pure client-side trade helpers (S1.6.4) — the same discipline as
// `renown.ts`: the SERVER (core `validate`, S1.3.2) is the sole authority for
// what a trade *does*; these functions mirror its trade rules ONLY as UI
// affordances (disable an illegal control, flip a perspective, describe a
// deal). Core `validate` is NEVER called client-side — it needs the
// server-secret `seed` as its 4th param, which the client must not hold
// (DESIGN.md §7.6, commit-reveal fairness). No React, no I/O here: everything
// is a pure function so it is unit-testable without a DOM.

import type { PlayerId, PlayerIntent, ResourceType, TradeOffer } from '@skervik/core';

import type { ClassicResource } from './resourceGlyphs.js';

export type Bundle = Readonly<Record<ResourceType, number>>;

/**
 * The 5 Classic resources in one fixed order — mirrors `BottomDeck`'s stable
 * ordering so the give/receive columns never reflow as counts change
 * (DESIGN.md §7.1 stable geometry).
 */
export const TRADE_RESOURCE_ORDER: readonly ClassicResource[] = [
  'timber',
  'clay',
  'fleece',
  'barley',
  'iron',
];

/** A fresh all-zero mutable bundle over the 5 Classic resources. */
export function emptyBundle(): Record<ClassicResource, number> {
  return { timber: 0, clay: 0, fleece: 0, barley: 0, iron: 0 };
}

/** Sum of a bundle's positive entries — a bundle is "empty" when this is 0. */
export function bundleTotal(bundle: Bundle): number {
  return Object.values(bundle).reduce((sum, amount) => sum + Math.max(0, amount), 0);
}

/** `true` when a bundle asks for at least one unit of something. */
export function isNonEmptyBundle(bundle: Bundle): boolean {
  return bundleTotal(bundle) > 0;
}

/**
 * `true` when `hand` holds at least every unit `bundle` asks for — the client
 * mirror of core's internal `canAfford` (validate.ts). Non-positive bundle
 * entries are trivially affordable (steppers never produce them, but stay
 * defensive).
 */
export function canAffordBundle(hand: Bundle, bundle: Bundle): boolean {
  return Object.entries(bundle).every(
    ([resource, amount]) => amount <= 0 || (hand[resource] ?? 0) >= amount,
  );
}

/** Why an offer cannot be composed yet — maps 1:1 to a localized reason key. */
export type ComposeRejection = 'emptyGive' | 'emptyGet' | 'cannotAfford';

export type ComposeResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: ComposeRejection };

/**
 * Whether `give`/`get` form a *sendable* offer from a hand — the UI affordance
 * that makes an illegal offer unsendable (DESIGN.md §7 anti-misclick): a
 * non-empty give AND get of positive amounts the hand can actually cover.
 * Mirrors core's `proposeTrade` guards (`isValidTradeBundle` + `canAfford`)
 * without ever invoking `validate`.
 */
export function canComposeOffer(hand: Bundle, give: Bundle, get: Bundle): ComposeResult {
  if (!isNonEmptyBundle(give)) return { ok: false, reason: 'emptyGive' };
  if (!isNonEmptyBundle(get)) return { ok: false, reason: 'emptyGet' };
  if (!canAffordBundle(hand, give)) return { ok: false, reason: 'cannotAfford' };
  return { ok: true };
}

export interface DealSides {
  readonly give: Bundle;
  readonly get: Bundle;
}

/**
 * The classic trade-UI perspective flip. A {@link TradeOffer}'s `give`/`get`
 * are ALWAYS from the proposer's seat (`give` leaves the proposer, `get`
 * arrives at the proposer — core `types.ts`). When *I* am a target reading an
 * incoming offer, from MY seat I would GIVE the proposer's `get` and RECEIVE
 * the proposer's `give`. Getting this backwards is the classic trade-UI bug,
 * so it lives in one tested function.
 */
export function flipToTargetPerspective(offer: DealSides): DealSides {
  return { give: offer.get, get: offer.give };
}

/** Clamp a stepper change into `[0, max]` — steppers can never emit a negative or over-hand amount. */
export function clampStep(current: number, delta: number, max: number): number {
  const next = current + delta;
  if (next < 0) return 0;
  if (next > max) return max;
  return next;
}

/** One positive line of a deal: `{ resource, count }`, for the "in words" sentence. */
export interface DealItem {
  readonly resource: ClassicResource;
  readonly count: number;
}

/** A bundle's positive entries as ordered {@link DealItem}s (stable resource order). */
export function bundleItems(bundle: Bundle): DealItem[] {
  return TRADE_RESOURCE_ORDER.filter((resource) => (bundle[resource] ?? 0) > 0).map(
    (resource) => ({ resource, count: bundle[resource] as number }),
  );
}

// --- Trade trace (§7.4) -----------------------------------------------------
// Every dispatched trade action lands as a structured, ordered entry so no
// state is verbal-only. Rendering the FULL feed in the ship's log is a later
// story (log content was deferred in S1.6.3); S1.6.4 only accumulates entries
// and shows a compact in-zone "recent deals" strip.

export type TradeLogKind =
  'proposed' | 'countered' | 'accepted' | 'declined' | 'cancelled' | 'reaction';

/** A bounded, predefined quick-reaction (§7.3) — no free-text by design. */
export type QuickReaction = 'agree' | 'tooExpensive' | 'thinking';

export interface TradeLogEntry {
  readonly id: number;
  readonly kind: TradeLogKind;
  /** Who acted (the local player when composed by this UI). */
  readonly actorId: PlayerId;
  /** The counterpart, where the action names one (counter/accept/decline). */
  readonly counterpartId?: PlayerId;
  /** Deal bundles from the ACTOR's perspective (proposed/countered/accepted). */
  readonly give?: Bundle;
  readonly get?: Bundle;
  readonly reaction?: QuickReaction;
  readonly turn: number;
}

/**
 * Maps a dispatched trade {@link PlayerIntent} to its trace entry (§7.4).
 * Reads the currently-open offer (for counterpart identity + the accept
 * perspective flip) but never mutates it. Non-trade intents return `null`
 * (they don't belong in the trade log). Pure — unit-tested.
 */
export function tradeLogEntryFromIntent(
  intent: PlayerIntent,
  openOffer: TradeOffer | undefined,
  turn: number,
  id: number,
): TradeLogEntry | null {
  switch (intent.type) {
    case 'intent.proposeTrade':
      return {
        id,
        kind: 'proposed',
        actorId: intent.playerId,
        give: intent.give,
        get: intent.get,
        turn,
      };
    case 'intent.counterTrade':
      return {
        id,
        kind: 'countered',
        actorId: intent.playerId,
        ...(openOffer ? { counterpartId: openOffer.proposerId } : {}),
        give: intent.give,
        get: intent.get,
        turn,
      };
    case 'intent.acceptTrade': {
      // From my (accepter's) seat the deal is the offer flipped: I give the
      // proposer's `get`, I receive the proposer's `give`.
      const flipped = openOffer ? flipToTargetPerspective(openOffer) : undefined;
      return {
        id,
        kind: 'accepted',
        actorId: intent.playerId,
        ...(openOffer ? { counterpartId: openOffer.proposerId } : {}),
        ...(flipped ? { give: flipped.give, get: flipped.get } : {}),
        turn,
      };
    }
    case 'intent.rejectTrade':
      return {
        id,
        kind: 'declined',
        actorId: intent.playerId,
        ...(openOffer ? { counterpartId: openOffer.proposerId } : {}),
        turn,
      };
    case 'intent.cancelTrade':
      return { id, kind: 'cancelled', actorId: intent.playerId, turn };
    default:
      return null;
  }
}
