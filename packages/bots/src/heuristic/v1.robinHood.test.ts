// S2.4.4 — the v1 bot proposes a discounted `robinHood` bank trade when, and
// only when, `validate.ts` would accept one. `povertyDiscountRate`
// (`eval/features.ts`) mirrors `validate.ts`'s discount legality EXACTLY;
// `bankTradeToward` (`heuristic/v1.ts`) is exported for direct unit-testing,
// independent of whichever candidate `mainCandidates` happens to score
// highest. The integration forcing test (the one that would have caught the
// original defect) lives separately in `v1.robinHoodIntegration.test.ts`.
import {
  type BoardState,
  type BuildingsState,
  buildTopology,
  EXPERIMENTAL_PROFILE_IDS,
  findEdge,
  type GameState,
  type PlayerState,
  type PortContent,
  type PortSlot,
  type RuleProfileId,
  type VertexId,
} from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { povertyDiscountRate } from '../eval/features.js';
import { bankTradeToward } from './v1.js';

const ROBIN_HOOD = EXPERIMENTAL_PROFILE_IDS.robinHood as RuleProfileId;
const BANK_DEFAULT = 10;
/** `robinHood` is a Classic-derived (radius-2) experimental profile — this file's
 *  fixtures are deliberately Classic-only (S2.1.7b Non-goals), independent of the
 *  per-match `topologyOf` seam the production code now resolves from `state.profileId`. */
const TOPO = buildTopology();

function makePlayer(id: string, resources: Record<string, number> = {}): PlayerState {
  return { id, name: id, victoryPoints: 0, resources };
}

/** Every vertex id touched by a port slot's edge — excluded when a fixture wants NO port influence. */
function portVertexIds(): ReadonlySet<VertexId> {
  const ids = new Set<VertexId>();
  for (const slot of TOPO.portSlots) {
    const edge = findEdge(TOPO, slot.edgeId);
    edge?.vertexIds.forEach((v) => ids.add(v));
  }
  return ids;
}

/** `count` distinct vertex ids that touch NO port slot (pure VP bookkeeping, no port side effects). */
function nonPortVertices(count: number): VertexId[] {
  const excluded = portVertexIds();
  const picked: VertexId[] = [];
  for (const vertex of TOPO.vertices) {
    if (excluded.has(vertex.id)) continue;
    picked.push(vertex.id);
    if (picked.length === count) return picked;
  }
  throw new Error(`fixture bug: could not find ${count} non-port vertices`);
}

function vertexForPortSlot(index: number): VertexId {
  const slot = TOPO.portSlots[index] as PortSlot;
  const edge = findEdge(TOPO, slot.edgeId);
  if (!edge) throw new Error(`fixture bug: no edge for port slot ${index}`);
  return edge.vertexIds[0];
}

function emptyBoard(portContents: PortContent[] = []): BoardState {
  const tileKinds: Record<string, string> = {};
  for (const tile of TOPO.tiles) tileKinds[tile.id] = 'desert';
  return {
    tileKinds,
    tileTokens: {},
    portContents,
    robberTileId: TOPO.tiles[0]?.id ?? 't',
  };
}

/**
 * `player-1` TRAILING (0 public VP, holding 1 poverty token), `player-2` the
 * LEADER (2 public VP via two settlements), `player-3` sitting exactly at the
 * trailing boundary (1 public VP — NOT trailing when leader=2, gap=2) and
 * also holding a token. No ports — mirrors core's `robinHood.test.ts` shape.
 */
function baseState(overrides: Partial<GameState> = {}): GameState {
  const [leaderA, leaderB, boundary] = nonPortVertices(3) as [
    VertexId,
    VertexId,
    VertexId,
  ];
  const buildings: BuildingsState = {
    settlements: {
      [leaderA]: 'player-2',
      [leaderB]: 'player-2',
      [boundary]: 'player-3',
    },
    roads: {},
  };
  return {
    matchId: 'match-v1-robinhood-1',
    phase: 'main',
    turn: 4,
    profileId: ROBIN_HOOD,
    currentPlayerId: 'player-1',
    players: [
      makePlayer('player-1', { timber: 8, iron: 0 }),
      makePlayer('player-2', { timber: 8, iron: 0 }),
      makePlayer('player-3', { timber: 8, iron: 0 }),
    ],
    eventIndex: 40,
    seedHash: 'deadbeef',
    board: emptyBoard(),
    buildings,
    povertyTokens: { 'player-1': 1, 'player-3': 1 },
    ...overrides,
  };
}

/**
 * `player-1` TRAILING (1 public VP: a settlement on the timber 2:1 port
 * slot) holding a token; `player-2` the leader (3 public VP via three
 * settlements, so `player-1` stays trailing despite the port settlement's
 * +1 VP: gap 2 → `1 <= 3-2=1`).
 */
function stateWithTimberPort(overrides: Partial<GameState> = {}): GameState {
  const portContents: PortContent[] = [];
  portContents[1] = { kind: 'resource', rate: 2, resource: 'timber' };
  const [leaderA, leaderB, leaderC] = nonPortVertices(3) as [
    VertexId,
    VertexId,
    VertexId,
  ];
  const buildings: BuildingsState = {
    settlements: {
      [vertexForPortSlot(1)]: 'player-1',
      [leaderA]: 'player-2',
      [leaderB]: 'player-2',
      [leaderC]: 'player-2',
    },
    roads: {},
  };
  return {
    matchId: 'match-v1-robinhood-port',
    phase: 'main',
    turn: 4,
    profileId: ROBIN_HOOD,
    currentPlayerId: 'player-1',
    players: [
      makePlayer('player-1', { timber: 8, iron: 0 }),
      makePlayer('player-2', { timber: 8, iron: 0 }),
    ],
    eventIndex: 40,
    seedHash: 'deadbeef',
    board: emptyBoard(portContents),
    buildings,
    povertyTokens: { 'player-1': 1 },
    ...overrides,
  };
}

/** Drops `profileId` entirely (never `undefined` — `exactOptionalPropertyTypes`) so the state resolves to Classic's `robinHood:false`. */
function withoutProfileId(state: GameState): GameState {
  const { profileId: _profileId, ...rest } = state;
  return rest;
}

describe('povertyDiscountRate — the pure eval feature (S2.4.4)', () => {
  it('a trailing token-holder with no port gets the discounted rate when it is cheaper than the natural 4:1', () => {
    const state = baseState();
    expect(povertyDiscountRate(state, 'player-1', 'timber')).toBe(2); // robinHoodExchangeRate
  });

  it('returns null when the player already has an equal-or-better rate (a 2:1 port for that resource)', () => {
    const state = stateWithTimberPort();
    expect(povertyDiscountRate(state, 'player-1', 'timber')).toBeNull();
  });

  it('returns null for a non-trailing token-holder', () => {
    const state = baseState();
    expect(povertyDiscountRate(state, 'player-3', 'timber')).toBeNull();
  });

  it('returns null with zero tokens', () => {
    const state = baseState({ povertyTokens: { 'player-1': 0 } });
    expect(povertyDiscountRate(state, 'player-1', 'timber')).toBeNull();
  });

  it('returns null when robinHood is off (byte-identical to no-discount)', () => {
    const state = withoutProfileId(baseState());
    expect(povertyDiscountRate(state, 'player-1', 'timber')).toBeNull();
  });
});

describe('bankTradeToward — proposes the discount exactly when the feature says one applies (S2.4.4)', () => {
  it('a trailing token-holder with a natural 4:1 rate proposes count === robinHoodExchangeRate', () => {
    const state = baseState();
    const intent = bankTradeToward(state, 'player-1', { iron: 1 }, BANK_DEFAULT);
    expect(intent).toMatchObject({
      type: 'intent.bankTrade',
      give: 'timber',
      get: 'iron',
      count: 2,
    });
  });

  it('a trailing token-holder with a 2:1 port proposes the port rate — no token spent', () => {
    const state = stateWithTimberPort();
    const intent = bankTradeToward(state, 'player-1', { iron: 1 }, BANK_DEFAULT);
    expect(intent).toMatchObject({
      type: 'intent.bankTrade',
      give: 'timber',
      get: 'iron',
      count: 2,
    });
    // The count alone can't distinguish "port" from "discount" (both are 2
    // here by construction — the exact landmine the story calls out), so
    // prove directly that no discount was available for this trade.
    expect(povertyDiscountRate(state, 'player-1', 'timber')).toBeNull();
  });

  it('a non-trailing token-holder proposes its natural rate (no discount)', () => {
    const state = baseState();
    const intent = bankTradeToward(state, 'player-3', { iron: 1 }, BANK_DEFAULT);
    expect(intent).toMatchObject({
      type: 'intent.bankTrade',
      give: 'timber',
      get: 'iron',
      count: 4,
    });
  });

  it('robinHood:false proposes its natural rate, byte-identically to the pre-S2.4.4 proposal', () => {
    const state = withoutProfileId(baseState());
    const intent = bankTradeToward(state, 'player-1', { iron: 1 }, BANK_DEFAULT);
    expect(intent).toMatchObject({
      type: 'intent.bankTrade',
      give: 'timber',
      get: 'iron',
      count: 4,
    });
  });
});
