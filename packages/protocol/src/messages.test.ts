// @skervik/protocol — zod schema contract tests (S1.5.1). Proves: every valid
// intent/event variant round-trips; malformed envelopes/payloads (bad `v`,
// unknown `type`, missing/wrong-typed fields, unknown intent/card kind) are
// rejected; the outbound event/state/reject/error envelopes accept real
// server-shaped payloads; and the compile-time drift pin (from messages.ts) is
// mirrored here as a type-level assertion so a divergence is caught in tests
// too. The variant samples mirror core's `types.test.ts` — if a schema field
// diverges from core's shape, the matching valid sample fails to parse.
import type { GameEvent, GameState, PlayerIntent } from '@skervik/core';
// m2-gate-03: a TEST-ONLY value import of core's allow-list. `messages.ts` still
// hand-copies it (see the `ShippingProfileIdSchema` docstring) — the production
// wire schema must not import core; this file may, and that asymmetry is exactly
// what makes the parity assertion below meaningful rather than tautological.
import { EXPERIMENTAL_PROFILE_IDS, SHIPPING_PROFILE_IDS } from '@skervik/core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { isCompatibleProtocolVersion, PROTOCOL_VERSION } from './index.js';
import {
  ClientMessageSchema,
  ConnectOptionsSchema,
  ErrorEnvelopeSchema,
  EventBatchEnvelopeSchema,
  GameEventSchema,
  JoinLobbySelectionSchema,
  JoinOptionsSchema,
  PlayerIntentSchema,
  PublicGameStateSchema,
  RejectEnvelopeSchema,
  ServerMessageSchema,
  StateSnapshotEnvelopeSchema,
  VersionErrorEnvelopeSchema,
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
  { type: 'neutral.placed', index: 2, vertexId: 'v0' },
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

  it('covers all 26 event discriminants', () => {
    expect(new Set(VALID_EVENTS.map((e) => e.type)).size).toBe(26);
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
    const msg = {
      v: 1,
      type: 'state.snapshot',
      payload: snapshot,
      isHost: true,
      isPrivate: false,
    };
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

// --- S1.5.2 handshake + protocol version negotiation ------------------------

describe('ConnectOptionsSchema (client join handshake)', () => {
  it('accepts a valid { protocolVersion } string', () => {
    expect(ConnectOptionsSchema.safeParse({ protocolVersion: '0.0.1' }).success).toBe(
      true,
    );
    expect(
      ConnectOptionsSchema.safeParse({ protocolVersion: PROTOCOL_VERSION }).success,
    ).toBe(true);
  });

  it('rejects a missing protocolVersion', () => {
    expect(ConnectOptionsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-string protocolVersion', () => {
    expect(ConnectOptionsSchema.safeParse({ protocolVersion: 1 }).success).toBe(false);
    expect(ConnectOptionsSchema.safeParse({ protocolVersion: null }).success).toBe(false);
  });

  it('accepts OPTIONAL guest fields alongside the required protocolVersion (S1.7.1)', () => {
    const parsed = ConnectOptionsSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      guestId: 'g-123',
      displayName: 'Nemo',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.guestId).toBe('g-123');
      expect(parsed.data.displayName).toBe('Nemo');
    }
  });

  it('guest fields stay OPTIONAL — a bare protocolVersion still parses (drift-pin intact)', () => {
    const parsed = ConnectOptionsSchema.safeParse({ protocolVersion: PROTOCOL_VERSION });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.guestId).toBeUndefined();
      expect(parsed.data.displayName).toBeUndefined();
    }
  });

  it('a non-string guest field is rejected (wire-shape guard)', () => {
    expect(
      ConnectOptionsSchema.safeParse({ protocolVersion: PROTOCOL_VERSION, guestId: 5 })
        .success,
    ).toBe(false);
  });
});

// --- security follow-up to S2.5.4: the FULL wire-permitted join contract ---

describe('JoinOptionsSchema (the FULL strict wire allow-list, security follow-up)', () => {
  it('accepts the bare handshake alone', () => {
    expect(
      JoinOptionsSchema.safeParse({ protocolVersion: PROTOCOL_VERSION }).success,
    ).toBe(true);
  });

  it('accepts a handshake + every legitimate lobby field together', () => {
    const parsed = JoinOptionsSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      guestId: 'g-1',
      displayName: 'Nemo',
      profileId: 'blitz',
      bots: [{ difficulty: 'medium' }],
      reconnectGraceSeconds: 300,
      isPrivate: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('[forcing] a wire join carrying a sessionToken is permitted by the .strict() allow-list (S2.6.2a — fails if sessionToken is not added to ConnectOptionsSchema)', () => {
    const parsed = JoinOptionsSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      sessionToken: 'header.payload.signature',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sessionToken).toBe('header.payload.signature');
  });

  it('[forcing] a wire create carrying isPrivate:true is accepted, not rejected by the .strict() allow-list (S2.5.3 — this test fails if isPrivate is not added to JoinLobbySelectionSchema)', () => {
    const parsed = JoinOptionsSchema.safeParse({
      protocolVersion: PROTOCOL_VERSION,
      isPrivate: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.isPrivate).toBe(true);
  });

  it('[forcing] rejects a `seed` key — the exact field GameRoom.onCreate would otherwise trust straight off the wire (commit-reveal break)', () => {
    expect(
      JoinOptionsSchema.safeParse({
        protocolVersion: PROTOCOL_VERSION,
        seed: 'attacker-chosen-seed',
      }).success,
    ).toBe(false);
  });

  it('[forcing] rejects a `maxSeats` key', () => {
    expect(
      JoinOptionsSchema.safeParse({
        protocolVersion: PROTOCOL_VERSION,
        maxSeats: 1,
      }).success,
    ).toBe(false);
  });

  it('[forcing] rejects botActionCap / botFillDifficulty / matchesDir / sink / metadataStore / turnTimerScheduler — every other internal-only GameRoomOptions field', () => {
    const forbiddenKeys = [
      'botActionCap',
      'botFillDifficulty',
      'matchesDir',
      'sink',
      'metadataStore',
      'turnTimerScheduler',
    ];
    for (const key of forbiddenKeys) {
      const options = { protocolVersion: PROTOCOL_VERSION, [key]: 'anything' };
      expect(JoinOptionsSchema.safeParse(options).success, `key "${key}"`).toBe(false);
    }
  });

  it('rejects an unrecognized key even alongside an otherwise-valid payload (fail closed, not just fail on the bad field alone)', () => {
    expect(
      JoinOptionsSchema.safeParse({
        protocolVersion: PROTOCOL_VERSION,
        profileId: 'classic',
        somethingNew: true,
      }).success,
    ).toBe(false);
  });
});

// --- S2.1.7b: `expanded` joins the SHIPPING allow-list, bots cap widens -----

describe('JoinLobbySelectionSchema (S2.1.7b: expanded profile + widened bots cap)', () => {
  it("accepts profileId:'expanded'", () => {
    const parsed = JoinLobbySelectionSchema.safeParse({ profileId: 'expanded' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.profileId).toBe('expanded');
  });

  it('accepts a 5-bot roster (widened .max(3) -> .max(5), a superset — every previously-valid 3-bot payload still parses)', () => {
    const fiveBots = Array.from({ length: 5 }, () => ({ difficulty: 'medium' as const }));
    expect(JoinLobbySelectionSchema.safeParse({ bots: fiveBots }).success).toBe(true);
    const threeBots = fiveBots.slice(0, 3);
    expect(JoinLobbySelectionSchema.safeParse({ bots: threeBots }).success).toBe(true);
  });

  it('still rejects a 6-bot roster (schema-level cap stays at 5, not unbounded)', () => {
    const sixBots = Array.from({ length: 6 }, () => ({ difficulty: 'medium' as const }));
    expect(JoinLobbySelectionSchema.safeParse({ bots: sixBots }).success).toBe(false);
  });

  it("still rejects an unknown/experimental profileId (the allow-list gained a member, it wasn't opened up)", () => {
    expect(JoinLobbySelectionSchema.safeParse({ profileId: 'nonsense' }).success).toBe(
      false,
    );
  });
});

describe('GameEventSchema — match.started carries the expanded profileId (S2.1.7b)', () => {
  it("round-trips profileId:'expanded'", () => {
    const parsed = GameEventSchema.safeParse({
      type: 'match.started',
      index: 0,
      matchId: 'm1',
      seedHash: 'deadbeef',
      playerIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
      profileId: 'expanded',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'match.started') {
      expect(parsed.data.profileId).toBe('expanded');
    }
  });
});

// --- m2-gate-05: the per-match victory override seam (S2.1.3) ---------------
//
// `vpToWinOverride` mirrors core's optional field on the wire. Nothing emits it
// yet, so the load-bearing case is the ABSENT one: a `match.started` without it
// must parse exactly as before and must not gain a defaulted key.
describe('GameEventSchema — match.started carries an optional vpToWinOverride (S2.1.3)', () => {
  const base = {
    type: 'match.started' as const,
    index: 0,
    matchId: 'm1',
    seedHash: 'deadbeef',
    playerIds: ['p1', 'p2'],
    profileId: 'classic' as const,
  };

  it('round-trips the override when present', () => {
    const parsed = GameEventSchema.safeParse({ ...base, vpToWinOverride: 8 });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'match.started') {
      expect(parsed.data.vpToWinOverride).toBe(8);
    }
  });

  it('parses WITHOUT the override and does not invent the key (frozen bytes)', () => {
    const parsed = GameEventSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'match.started') {
      expect('vpToWinOverride' in parsed.data).toBe(false);
      expect(JSON.stringify(parsed.data)).not.toContain('vpToWinOverride');
    }
  });

  it('rejects a non-integer / non-positive override at the trust boundary', () => {
    for (const bad of [0, -1, 7.5, '8', null]) {
      expect(
        GameEventSchema.safeParse({ ...base, vpToWinOverride: bad }).success,
        `vpToWinOverride must reject ${JSON.stringify(bad)}`,
      ).toBe(false);
    }
  });
});

// --- m2-gate-03: protocol enum <-> core SHIPPING_PROFILE_IDS parity ---------
//
// `ShippingProfileIdSchema` is PRIVATE to messages.ts, so the parity check
// reaches its `.options` through the exported schema that consumes it —
// `JoinLobbySelectionSchema.shape.profileId` is that very enum wrapped in
// `.optional()`, so `.unwrap().options` IS `ShippingProfileIdSchema.options`,
// not a copy of it. (Reading it this way keeps the story test-only: exporting
// the const would be a change to the schema module, which m2-gate-03 forbids.)
const WIRE_SHIPPING_PROFILE_IDS =
  JoinLobbySelectionSchema.shape.profileId.unwrap().options;

describe('ShippingProfileIdSchema <-> core SHIPPING_PROFILE_IDS parity (m2-gate-03)', () => {
  // ORDER-PINNED, deliberately: core documents SHIPPING_PROFILE_IDS as the
  // lobby list "in display order" and the wire enum mirrors it 1:1, so a
  // reorder on one side alone is itself drift a reviewer should see. Note what
  // is NOT asserted: the list's LENGTH against a hardcoded number — a genuine
  // sixth shipping profile added to BOTH sides must stay green; only divergence
  // must go red.
  //
  // Why this fails on every divergence, without committing a broken state:
  //   - an id ADDED to core only  -> right array is longer  -> toEqual fails
  //   - an id ADDED to the enum only -> left array is longer -> toEqual fails
  //   - an id REMOVED from either  -> the same length mismatch, mirrored
  //   - an id RENAMED on either side -> same length, differing element -> fails
  it("the wire enum equals core's shipping allow-list exactly, element for element", () => {
    // Spread: SHIPPING_PROFILE_IDS is `readonly`, and toEqual compares values.
    expect([...WIRE_SHIPPING_PROFILE_IDS]).toEqual([...SHIPPING_PROFILE_IDS]);
    // Non-vacuity: an empty list on BOTH sides would satisfy the line above.
    expect(WIRE_SHIPPING_PROFILE_IDS.length).toBeGreaterThan(0);
  });

  it('membership matches as a set too — names which id drifted when the order-pinned check fails', () => {
    expect(new Set(WIRE_SHIPPING_PROFILE_IDS)).toEqual(new Set(SHIPPING_PROFILE_IDS));
  });

  it('every core shipping id is actually accepted by the join allow-list', () => {
    for (const profileId of SHIPPING_PROFILE_IDS) {
      const parsed = JoinLobbySelectionSchema.safeParse({ profileId });
      expect(
        parsed.success,
        `core shipping id "${profileId}" must parse at the wire`,
      ).toBe(true);
    }
  });

  it("every core shipping id is accepted by the match.started payload too (the enum's two consumers cannot drift apart)", () => {
    for (const profileId of SHIPPING_PROFILE_IDS) {
      const parsed = GameEventSchema.safeParse({
        type: 'match.started',
        index: 0,
        matchId: 'm1',
        seedHash: 'deadbeef',
        playerIds: ['p1', 'p2'],
        profileId,
      });
      expect(parsed.success, `match.started must carry "${profileId}"`).toBe(true);
    }
  });

  it('🔴 no measurement-only EXPERIMENTAL_PROFILE_IDS id leaks into the wire enum (loadRuleProfile resolves them; a client must never reach them)', () => {
    for (const profileId of Object.values(EXPERIMENTAL_PROFILE_IDS)) {
      expect(WIRE_SHIPPING_PROFILE_IDS as readonly string[]).not.toContain(profileId);
      expect(
        JoinLobbySelectionSchema.safeParse({ profileId }).success,
        `experimental id "${profileId}" must be rejected at the wire`,
      ).toBe(false);
    }
  });
});

// --- m2-gate-07: the snapshot CARRIES profileId + vpToWinOverride ----------
//
// Review C3/M2. zod strips unknown keys, so while these two were missing from
// `PublicGameStateSchema` every snapshot silently lost them in transit — a
// mid-match reconnect on an `expanded` room re-rendered the Classic board.
// What these tests assert is PRESERVATION, not acceptance: `safeParse`
// returned `success: true` the whole time the fields were being dropped,
// which is exactly why the regression was invisible to the existing
// "accepts a full state.snapshot" test above.
const EXPANDED_SNAPSHOT: GameState = {
  matchId: 'm-expanded',
  phase: 'main',
  turn: 4,
  currentPlayerId: 'p1',
  players: [
    { id: 'p1', name: 'Wayfarer', victoryPoints: 3, resources: { ore: 1 } },
    { id: 'p2', name: 'Drifter', victoryPoints: 2, resources: { timber: 2 } },
  ],
  eventIndex: 20,
  seedHash: 'deadbeef',
  profileId: 'expanded',
  vpToWinOverride: 8,
};

describe('PublicGameStateSchema carries profileId + vpToWinOverride (m2-gate-07)', () => {
  it('round-trips BOTH optional fields rather than stripping them', () => {
    const parsed = PublicGameStateSchema.safeParse(EXPANDED_SNAPSHOT);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.profileId).toBe('expanded');
    expect(parsed.data?.vpToWinOverride).toBe(8);
  });

  it('both survive the full state.snapshot envelope — the exact frame wsClient parses', () => {
    const msg = {
      v: 1,
      type: 'state.snapshot',
      payload: EXPANDED_SNAPSHOT,
      isHost: false,
      isPrivate: false,
    };
    const parsed = StateSnapshotEnvelopeSchema.safeParse(msg);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.payload.profileId).toBe('expanded');
    expect(parsed.data?.payload.vpToWinOverride).toBe(8);
    expect(ServerMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('keeps both keys ABSENT when the payload omits them (optional, not defaulted)', () => {
    const withoutBoth: Record<string, unknown> = { ...EXPANDED_SNAPSHOT };
    delete withoutBoth.profileId;
    delete withoutBoth.vpToWinOverride;

    const parsed = PublicGameStateSchema.safeParse(withoutBoth);
    expect(parsed.success).toBe(true);
    // `in`, not `=== undefined`: a snapshot for a Classic match must stay the
    // same object it was before this story — an injected `profileId: undefined`
    // key would be a wire change, and the absent-key contract forbids it.
    expect(parsed.data && 'profileId' in parsed.data).toBe(false);
    expect(parsed.data && 'vpToWinOverride' in parsed.data).toBe(false);
  });

  it('accepts every core shipping profile id on a snapshot, so it cannot drift from match.started', () => {
    for (const profileId of SHIPPING_PROFILE_IDS) {
      const parsed = PublicGameStateSchema.safeParse({
        ...EXPANDED_SNAPSHOT,
        profileId,
      });
      expect(parsed.success, `snapshot must carry "${profileId}"`).toBe(true);
      expect(parsed.data?.profileId).toBe(profileId);
    }
  });

  it('rejects a non-positive / non-integer vpToWinOverride', () => {
    for (const bad of [0, -8, 8.5]) {
      expect(
        PublicGameStateSchema.safeParse({ ...EXPANDED_SNAPSHOT, vpToWinOverride: bad })
          .success,
        `vpToWinOverride ${bad} must be refused`,
      ).toBe(false);
    }
  });
});

describe('VersionErrorEnvelopeSchema (error.version, E1.6 client contract)', () => {
  it('round-trips a mismatch message and parses under ServerMessageSchema', () => {
    const msg = {
      v: 1,
      type: 'error.version',
      payload: {
        code: 'PROTOCOL_VERSION_MISMATCH',
        serverVersion: PROTOCOL_VERSION,
        clientVersion: '0.0.0-old',
      },
    };
    const parsed = VersionErrorEnvelopeSchema.safeParse(msg);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(msg);
    // error.version is a recognized inbound server message for the client.
    expect(ServerMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('accepts a null clientVersion (missing/malformed version reported as null)', () => {
    const msg = {
      v: 1,
      type: 'error.version',
      payload: {
        code: 'PROTOCOL_VERSION_MISMATCH',
        serverVersion: PROTOCOL_VERSION,
        clientVersion: null,
      },
    };
    expect(VersionErrorEnvelopeSchema.safeParse(msg).success).toBe(true);
    expect(ServerMessageSchema.safeParse(msg).success).toBe(true);
  });

  it('rejects a wrong machine code', () => {
    expect(
      VersionErrorEnvelopeSchema.safeParse({
        v: 1,
        type: 'error.version',
        payload: {
          code: 'SOMETHING_ELSE',
          serverVersion: PROTOCOL_VERSION,
          clientVersion: null,
        },
      }).success,
    ).toBe(false);
  });
});

describe('isCompatibleProtocolVersion (the ONE compatibility gate)', () => {
  it('is true only for exactly PROTOCOL_VERSION', () => {
    expect(isCompatibleProtocolVersion(PROTOCOL_VERSION)).toBe(true);
  });

  it('is false for a bumped / garbage / empty version', () => {
    expect(isCompatibleProtocolVersion('9.9.9')).toBe(false);
    expect(isCompatibleProtocolVersion('not-a-version')).toBe(false);
    expect(isCompatibleProtocolVersion('')).toBe(false);
  });

  it('is false for a missing / non-string version', () => {
    expect(isCompatibleProtocolVersion(undefined)).toBe(false);
    expect(isCompatibleProtocolVersion(null)).toBe(false);
    expect(isCompatibleProtocolVersion(1)).toBe(false);
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
