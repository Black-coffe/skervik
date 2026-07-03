// @skervik/protocol — zod schema contract tests (S1.5.1). Proves: every valid
// intent/event variant round-trips; malformed envelopes/payloads (bad `v`,
// unknown `type`, missing/wrong-typed fields, unknown intent/card kind) are
// rejected; the outbound event/state/reject/error envelopes accept real
// server-shaped payloads; and the compile-time drift pin (from messages.ts) is
// mirrored here as a type-level assertion so a divergence is caught in tests
// too. The variant samples mirror core's `types.test.ts` — if a schema field
// diverges from core's shape, the matching valid sample fails to parse.
import type { GameEvent, GameState, PlayerIntent } from '@skervik/core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  ClientMessageSchema,
  ErrorEnvelopeSchema,
  EventBatchEnvelopeSchema,
  GameEventSchema,
  PlayerIntentSchema,
  RejectEnvelopeSchema,
  ServerMessageSchema,
  StateSnapshotEnvelopeSchema,
} from './messages.js';

/** Every `PlayerIntent` variant (incl. all 4 `playDevCard` card kinds). */
const VALID_INTENTS: PlayerIntent[] = [
  { type: 'intent.rollDice', playerId: 'p1' },
  { type: 'intent.endTurn', playerId: 'p1' },
  { type: 'intent.placeSettlement', playerId: 'p1', vertexId: 'v1' },
  { type: 'intent.placeRoad', playerId: 'p1', edgeId: 'e1' },
  { type: 'intent.buildRoad', playerId: 'p1', edgeId: 'e1' },
  { type: 'intent.buildSettlement', playerId: 'p1', vertexId: 'v1' },
  { type: 'intent.buildCity', playerId: 'p1', vertexId: 'v1' },
  { type: 'intent.buyDevCard', playerId: 'p1' },
  {
    type: 'intent.playDevCard',
    playerId: 'p1',
    card: 'knight',
    tileId: '0,0',
    victimId: 'p2',
  },
  {
    type: 'intent.playDevCard',
    playerId: 'p1',
    card: 'roadBuilding',
    edgeIds: ['e1', 'e2'],
  },
  {
    type: 'intent.playDevCard',
    playerId: 'p1',
    card: 'yearOfPlenty',
    resources: ['timber', 'clay'],
  },
  { type: 'intent.playDevCard', playerId: 'p1', card: 'monopoly', resource: 'timber' },
  { type: 'intent.discard', playerId: 'p1', resources: { timber: 1 } },
  { type: 'intent.moveRobber', playerId: 'p1', tileId: '0,0', victimId: 'p2' },
  { type: 'intent.proposeTrade', playerId: 'p1', give: { timber: 1 }, get: { ore: 1 } },
  { type: 'intent.acceptTrade', playerId: 'p2' },
  { type: 'intent.rejectTrade', playerId: 'p2' },
  { type: 'intent.counterTrade', playerId: 'p2', give: { ore: 1 }, get: { timber: 1 } },
  { type: 'intent.cancelTrade', playerId: 'p1' },
  { type: 'intent.bankTrade', playerId: 'p1', give: 'timber', count: 4, get: 'ore' },
];

/** Every `GameEvent` variant (mirrors core `types.test.ts`). */
const VALID_EVENTS: GameEvent[] = [
  {
    type: 'match.started',
    index: 0,
    matchId: 'm1',
    seedHash: 'deadbeef',
    playerIds: ['p1'],
  },
  {
    type: 'board.generated',
    index: 1,
    tileKinds: { '0,0': 'desert' },
    tileTokens: {},
    portContents: [{ kind: 'generic', rate: 3 }],
    robberTileId: '0,0',
  },
  { type: 'dice.rolled', index: 2, playerId: 'p1', dieA: 5, dieB: 3, total: 8 },
  {
    type: 'resources.produced',
    index: 3,
    grants: { p1: { timber: 1 } },
    bank: { timber: 18 },
  },
  { type: 'turn.ended', index: 4, playerId: 'p1', nextPlayerId: 'p2' },
  {
    type: 'settlement.placed',
    index: 5,
    playerId: 'p1',
    vertexId: 'v1',
    payout: { timber: 1 },
  },
  {
    type: 'road.placed',
    index: 6,
    playerId: 'p1',
    edgeId: 'e1',
    nextPlayerId: 'p2',
    nextPhase: 'setup',
  },
  {
    type: 'road.built',
    index: 7,
    playerId: 'p1',
    edgeId: 'e1',
    cost: { timber: 1, clay: 1 },
  },
  {
    type: 'settlement.built',
    index: 8,
    playerId: 'p1',
    vertexId: 'v1',
    cost: { timber: 1, clay: 1, fleece: 1, barley: 1 },
  },
  {
    type: 'city.built',
    index: 9,
    playerId: 'p1',
    vertexId: 'v1',
    cost: { iron: 3, barley: 2 },
  },
  {
    type: 'devCard.bought',
    index: 10,
    playerId: 'p1',
    card: 'knight',
    cost: { fleece: 1, barley: 1, iron: 1 },
    deckRemaining: 24,
  },
  {
    type: 'devCard.roadBuildingPlayed',
    index: 11,
    playerId: 'p1',
    edgeIds: ['e1', 'e2'],
  },
  {
    type: 'devCard.yearOfPlentyPlayed',
    index: 12,
    playerId: 'p1',
    resources: { timber: 2 },
    bank: { timber: 17 },
  },
  {
    type: 'devCard.monopolyPlayed',
    index: 13,
    playerId: 'p1',
    resource: 'timber',
    transfers: { p2: 3 },
  },
  {
    type: 'resources.discarded',
    index: 14,
    playerId: 'p1',
    resources: { timber: 2 },
    remainingToDiscard: ['p2'],
  },
  {
    type: 'robber.moved',
    index: 15,
    playerId: 'p1',
    tileId: '0,0',
    stolenFrom: 'p2',
    stolenResource: 'timber',
    nextPhase: 'main',
  },
  { type: 'devCard.knightPlayed', index: 16, playerId: 'p1' },
  {
    type: 'trade.offered',
    index: 17,
    proposerId: 'p1',
    give: { timber: 1 },
    get: { ore: 1 },
    targets: ['p2'],
    depth: 0,
  },
  {
    type: 'trade.executed',
    index: 18,
    proposerId: 'p1',
    accepterId: 'p2',
    give: { timber: 1 },
    get: { ore: 1 },
  },
  { type: 'trade.rejected', index: 19, playerId: 'p2', remainingTargets: [] },
  { type: 'trade.cancelled', index: 20, playerId: 'p1' },
  {
    type: 'bank.trade',
    index: 21,
    playerId: 'p1',
    give: 'timber',
    count: 4,
    get: 'ore',
    bank: { timber: 23, ore: 18 },
  },
  { type: 'award.longestRoad', index: 22, playerId: 'p1', length: 5 },
  { type: 'award.largestArmy', index: 23, playerId: 'p1', knights: 3 },
  { type: 'game.ended', index: 24, winnerId: 'p1', finalStandings: { p1: 10, p2: 4 } },
];

describe('PlayerIntentSchema (inbound payload)', () => {
  it('round-trips every valid intent variant unchanged', () => {
    for (const intent of VALID_INTENTS) {
      const parsed = PlayerIntentSchema.safeParse(intent);
      expect(parsed.success, `variant ${intent.type} should parse`).toBe(true);
      if (parsed.success) expect(parsed.data).toEqual(intent);
    }
  });

  it('covers all 17 top-level intent discriminants + 4 playDevCard card kinds', () => {
    const topLevel = new Set(VALID_INTENTS.map((i) => i.type));
    expect(topLevel.size).toBe(17);
    const cards = new Set(
      VALID_INTENTS.filter((i) => i.type === 'intent.playDevCard').map(
        (i) => (i as { card: string }).card,
      ),
    );
    expect(cards).toEqual(
      new Set(['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly']),
    );
  });

  it('rejects an unknown intent type', () => {
    expect(
      PlayerIntentSchema.safeParse({ type: 'intent.teleport', playerId: 'p1' }).success,
    ).toBe(false);
  });

  it('rejects an unknown playDevCard card kind', () => {
    expect(
      PlayerIntentSchema.safeParse({
        type: 'intent.playDevCard',
        playerId: 'p1',
        card: 'wizard',
      }).success,
    ).toBe(false);
  });

  it('rejects a missing required payload field (placeSettlement w/o vertexId)', () => {
    expect(
      PlayerIntentSchema.safeParse({ type: 'intent.placeSettlement', playerId: 'p1' })
        .success,
    ).toBe(false);
  });

  it('rejects a wrong-typed payload field (bankTrade count as string)', () => {
    expect(
      PlayerIntentSchema.safeParse({
        type: 'intent.bankTrade',
        playerId: 'p1',
        give: 'timber',
        count: 'four',
        get: 'ore',
      }).success,
    ).toBe(false);
  });
});

describe('ClientMessageSchema (inbound envelope)', () => {
  it('accepts a well-formed intent envelope for every intent variant', () => {
    for (const intent of VALID_INTENTS) {
      const parsed = ClientMessageSchema.safeParse({
        v: 1,
        type: 'intent',
        payload: intent,
      });
      expect(parsed.success, `envelope for ${intent.type}`).toBe(true);
    }
  });

  it('rejects a wrong protocol version (v: 2)', () => {
    expect(
      ClientMessageSchema.safeParse({
        v: 2,
        type: 'intent',
        payload: { type: 'intent.endTurn', playerId: 'p1' },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown envelope type', () => {
    expect(
      ClientMessageSchema.safeParse({
        v: 1,
        type: 'not-an-intent',
        payload: { type: 'intent.endTurn', playerId: 'p1' },
      }).success,
    ).toBe(false);
  });

  it('rejects a missing payload', () => {
    expect(ClientMessageSchema.safeParse({ v: 1, type: 'intent' }).success).toBe(false);
  });

  it('rejects a malformed payload inside a well-formed envelope', () => {
    expect(
      ClientMessageSchema.safeParse({
        v: 1,
        type: 'intent',
        payload: { type: 'intent.buildCity', playerId: 'p1' }, // no vertexId
      }).success,
    ).toBe(false);
  });

  it('does not accept a server-only (outbound) type as inbound', () => {
    expect(
      ClientMessageSchema.safeParse({ v: 1, type: 'event.batch', payload: [] }).success,
    ).toBe(false);
  });
});

describe('GameEventSchema (outbound payload)', () => {
  it('round-trips every valid event variant unchanged', () => {
    for (const event of VALID_EVENTS) {
      const parsed = GameEventSchema.safeParse(event);
      expect(parsed.success, `event ${event.type} should parse`).toBe(true);
      if (parsed.success) expect(parsed.data).toEqual(event);
    }
  });

  it('covers all 25 event discriminants', () => {
    expect(new Set(VALID_EVENTS.map((e) => e.type)).size).toBe(25);
  });

  it('rejects an unknown event type', () => {
    expect(GameEventSchema.safeParse({ type: 'meteor.struck', index: 0 }).success).toBe(
      false,
    );
  });
});

describe('outbound envelopes (ServerMessageSchema, E1.6 client contract)', () => {
  it('accepts an event.batch of real events', () => {
    const msg = { v: 1, type: 'event.batch', payload: VALID_EVENTS };
    expect(EventBatchEnvelopeSchema.safeParse(msg).success).toBe(true);
    expect(ServerMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('accepts a full state.snapshot', () => {
    const snapshot: GameState = {
      matchId: 'm1',
      phase: 'main',
      turn: 3,
      currentPlayerId: 'p1',
      players: [
        {
          id: 'p1',
          name: 'Wayfarer',
          victoryPoints: 2,
          resources: { timber: 3, ore: 1 },
        },
      ],
      playerOrder: ['p1', 'p2'],
      eventIndex: 12,
      seedHash: 'deadbeef',
      board: {
        tileKinds: { '0,0': 'desert', '1,0': 'timber' },
        tileTokens: { '1,0': 8 },
        portContents: [{ kind: 'resource', rate: 2, resource: 'ore' }],
        robberTileId: '0,0',
      },
      buildings: { settlements: { v1: 'p1' }, roads: { e1: 'p1' }, cities: {} },
      bank: { timber: 15 },
      openTradeOffer: {
        proposerId: 'p1',
        give: { timber: 1 },
        get: { ore: 1 },
        targets: ['p2'],
        depth: 0,
      },
    };
    const msg = { v: 1, type: 'state.snapshot', payload: snapshot };
    expect(StateSnapshotEnvelopeSchema.safeParse(msg).success).toBe(true);
    expect(ServerMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('accepts intent.rejected and intent.error envelopes', () => {
    const reject = {
      v: 1,
      type: 'intent.rejected',
      payload: { reason: 'NOT_YOUR_TURN' },
    };
    const error = { v: 1, type: 'intent.error', payload: { code: 'INTERNAL_ERROR' } };
    expect(RejectEnvelopeSchema.safeParse(reject).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse(error).success).toBe(true);
    expect(ServerMessageSchema.safeParse(reject).success).toBe(true);
    expect(ServerMessageSchema.safeParse(error).success).toBe(true);
  });

  it('rejects a bad envelope version on an outbound message', () => {
    expect(
      EventBatchEnvelopeSchema.safeParse({ v: 9, type: 'event.batch', payload: [] })
        .success,
    ).toBe(false);
  });
});

// --- drift guard: SCHEMA discriminants === CORE discriminants (compile-time) ---
// Mirrors the pins in messages.ts. The left side is inferred from the zod
// SCHEMA, the right from core's canonical union — so if core adds/removes an
// intent or event variant without a matching schema change, `Equals<…>` becomes
// `false` and `assertEquals<false>()` fails the `extends true` constraint,
// stopping this file (and the protocol typecheck/build) from compiling.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function assertEquals<_T extends true>(): void {
  /* type-level only */
}

describe('drift guard (compile-time pin)', () => {
  it('schema discriminants match core PlayerIntent/GameEvent unions', () => {
    assertEquals<
      Equals<z.infer<typeof PlayerIntentSchema>['type'], PlayerIntent['type']>
    >();
    assertEquals<
      Equals<
        Extract<
          z.infer<typeof PlayerIntentSchema>,
          { type: 'intent.playDevCard' }
        >['card'],
        Extract<PlayerIntent, { type: 'intent.playDevCard' }>['card']
      >
    >();
    assertEquals<Equals<z.infer<typeof GameEventSchema>['type'], GameEvent['type']>>();
    expect(true).toBe(true);
  });
});
