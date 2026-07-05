// Dev-only trade demo states (S1.6.4) — real `GameState`s whose
// `openTradeOffer` is produced by the REAL core `reduce`, never hand-mutated
// (same "fixtures are real, not invented" discipline as `devFixture.ts`).
// With no server yet (S1.6.5 wires WS), these let a developer exercise the
// incoming / outgoing / counter-bound card states against the dev fixture.
// A `trade.offered` event only LEGALLY exists in the 'main' phase; the fixture
// rests in 'roll', so — exactly like the fixture's own direct `city.built`
// fallback — the offers here are constructed as real `TradeOfferedEvent`s and
// applied through `reduce` (which produces the `openTradeOffer` slot), with the
// proposer first granted their `give` via a real `resources.produced` event so
// each offer is affordable. Superseded by S1.6.5; do not build on this file.

import type {
  GameState,
  PlayerId,
  ResourcesProducedEvent,
  ResourceType,
  TradeOfferedEvent,
} from '@skervik/core';
import { reduce } from '@skervik/core';

import { devFixtureState } from './devFixture.js';

type Bundle = Record<ResourceType, number>;

const P1: PlayerId = 'player-1'; // the dev `myPlayerId`
const P2: PlayerId = 'player-2';
const P3: PlayerId = 'player-3';
const P4: PlayerId = 'player-4';

function grant(state: GameState, playerId: PlayerId, bundle: Bundle): GameState {
  const event: ResourcesProducedEvent = {
    type: 'resources.produced',
    index: state.eventIndex,
    grants: { [playerId]: bundle },
    bank: {},
  };
  return reduce(state, event);
}

function openOffer(
  state: GameState,
  proposerId: PlayerId,
  give: Bundle,
  get: Bundle,
  targets: readonly PlayerId[],
  depth = 0,
): GameState {
  const event: TradeOfferedEvent = {
    type: 'trade.offered',
    index: state.eventIndex,
    proposerId,
    give,
    get,
    targets,
    depth,
  };
  return reduce(state, event);
}

const give3Fleece: Bundle = { timber: 0, clay: 0, fleece: 3, barley: 0, iron: 0 };
const get1Iron: Bundle = { timber: 0, clay: 0, fleece: 0, barley: 0, iron: 1 };
const give2Fleece: Bundle = { timber: 0, clay: 0, fleece: 2, barley: 0, iron: 0 };

/** No open offer, P1's turn — the OfferBuilder (propose) is active. */
export const demoBuilder: GameState = devFixtureState;

/** P2 proposes to everyone (incoming to P1); P1 granted iron so Accept is live. */
export const demoIncoming: GameState = openOffer(
  grant(grant(devFixtureState, P2, give3Fleece), P1, get1Iron),
  P2,
  give3Fleece,
  get1Iron,
  [P1, P3, P4],
);

/** A depth-1 counter aimed at P1 — the "Counter" action must be disabled. */
export const demoIncomingCounter: GameState = openOffer(
  grant(devFixtureState, P2, give3Fleece),
  P2,
  give3Fleece,
  get1Iron,
  [P1],
  1,
);

/** P1's own open proposal — the outgoing card (awaiting response / pending seal). */
export const demoOutgoing: GameState = openOffer(
  grant(devFixtureState, P1, give2Fleece),
  P1,
  give2Fleece,
  get1Iron,
  [P2, P3, P4],
);

export interface TradeDemo {
  readonly id: string;
  readonly labelKey:
    'trade.title' | 'trade.incomingTitle' | 'trade.counterTitle' | 'trade.outgoingTitle';
  readonly state: GameState;
}

export const TRADE_DEMOS: readonly TradeDemo[] = [
  { id: 'builder', labelKey: 'trade.title', state: demoBuilder },
  { id: 'incoming', labelKey: 'trade.incomingTitle', state: demoIncoming },
  { id: 'counter', labelKey: 'trade.counterTitle', state: demoIncomingCounter },
  { id: 'outgoing', labelKey: 'trade.outgoingTitle', state: demoOutgoing },
];
