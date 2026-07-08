// @skervik/core — S2.4.2a: the finite bank is a CONSERVED pool. Building,
// buying a dev card, and discarding-on-7 all RETURN their resources to the
// bank (physical-Catan parity, `ruleProfile.ts` "Physical-Catan parity: 19"),
// so `bank + Σ(all player hands)` is INVARIANT across build/buy/discard and the
// total conserved pool stays 95. Before the fix those cases DESTROYED the
// resources: the bank strictly drained until the all-or-nothing production gate
// (`validate.ts`) froze and long matches stalled. This suite enshrines the
// conservation invariant and proves the credit un-freezes production.

import { describe, expect, it } from 'vitest';

import { type BoardTopology, buildTopology, type TileTopology } from './board.js';
import { reduce } from './reduce.js';
import type {
  BoardState,
  BuildingsState,
  CityBuiltEvent,
  DevCardBoughtEvent,
  GameEvent,
  GameState,
  PlayerState,
  ResourcesDiscardedEvent,
  ResourcesProducedEvent,
  ResourceType,
  RoadBuiltEvent,
  SettlementBuiltEvent,
} from './types.js';
import { validate } from './validate.js';

const RESOURCES: readonly ResourceType[] = ['timber', 'clay', 'fleece', 'barley', 'iron'];
const BANK_PER = 19; // CLASSIC_PRODUCTION_PROFILE.bankPerResource
const TOTAL_POOL = BANK_PER * RESOURCES.length; // 95 — the whole physical box

/**
 * The conserved-pool measure the fix protects: every resource is either in the
 * bank or in a hand. An absent bank key means that resource's full Classic pool
 * (the `?? bankPerResource` convention `validate`'s production gate uses).
 */
function totalResources(state: GameState): number {
  const bankSum = RESOURCES.reduce((sum, r) => sum + (state.bank?.[r] ?? BANK_PER), 0);
  const handSum = state.players.reduce(
    (sum, player) =>
      sum + Object.values(player.resources).reduce((acc, count) => acc + count, 0),
    0,
  );
  return bankSum + handSum;
}

function bankIsNonNegative(state: GameState): boolean {
  return RESOURCES.every((r) => (state.bank?.[r] ?? BANK_PER) >= 0);
}

describe('bank conservation across build/buy/discard (S2.4.2a)', () => {
  it('`bank + Σ(hands)` is INVARIANT (== 95) across produce -> build road/settlement/city -> buy dev -> discard', () => {
    // A full bank + empty hands = the whole 95-card pool untouched.
    const genesis: GameState = {
      matchId: 'm-conservation',
      phase: 'main',
      turn: 3,
      currentPlayerId: 'player-1',
      players: [
        { id: 'player-1', name: 'player-1', victoryPoints: 0, resources: {} },
        { id: 'player-2', name: 'player-2', victoryPoints: 0, resources: {} },
      ],
      eventIndex: 10,
      seedHash: 'deadbeef',
      bank: { timber: 19, clay: 19, fleece: 19, barley: 19, iron: 19 },
    };
    expect(totalResources(genesis)).toBe(TOTAL_POOL);

    // Production moves resources bank -> hand (already conserved: `event.bank`
    // is the debited pool). Player-1 gets enough to fund every build below.
    const produce: ResourcesProducedEvent = {
      type: 'resources.produced',
      index: 10,
      grants: { 'player-1': { timber: 5, clay: 5, fleece: 5, barley: 8, iron: 8 } },
      bank: { timber: 14, clay: 14, fleece: 14, barley: 11, iron: 11 },
    };
    // Each build/buy/discard debits the hand AND (the fix) credits the bank —
    // deriving the credit from the event's OWN cost/discard payload.
    const road: RoadBuiltEvent = {
      type: 'road.built',
      index: 11,
      playerId: 'player-1',
      edgeId: 'e1',
      cost: { timber: 1, clay: 1 },
    };
    const settlement: SettlementBuiltEvent = {
      type: 'settlement.built',
      index: 12,
      playerId: 'player-1',
      vertexId: 'v1',
      cost: { timber: 1, clay: 1, fleece: 1, barley: 1 },
    };
    const city: CityBuiltEvent = {
      type: 'city.built',
      index: 13,
      playerId: 'player-1',
      vertexId: 'v1',
      cost: { iron: 3, barley: 2 },
    };
    const devCard: DevCardBoughtEvent = {
      type: 'devCard.bought',
      index: 14,
      playerId: 'player-1',
      card: 'knight',
      cost: { fleece: 1, barley: 1, iron: 1 },
      deckRemaining: 24,
    };
    const discard: ResourcesDiscardedEvent = {
      type: 'resources.discarded',
      index: 15,
      playerId: 'player-1',
      resources: { barley: 2, iron: 2 },
      remainingToDiscard: [],
    };

    const steps: readonly GameEvent[] = [
      produce,
      road,
      settlement,
      city,
      devCard,
      discard,
    ];

    let state = genesis;
    for (const event of steps) {
      state = reduce(state, event);
      // The headline invariant: nothing was created or destroyed.
      expect(totalResources(state)).toBe(TOTAL_POOL);
      expect(bankIsNonNegative(state)).toBe(true);
    }

    // Every player hand ends non-negative (the bank absorbed every debit's twin
    // credit), and the bank ends replenished by exactly the costs returned.
    for (const player of state.players) {
      for (const count of Object.values(player.resources)) {
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
    // produce debited (5,5,5,8,8); builds+buy+discard credited back
    // (2,2, ... ) — the net is the resources still in player-1's hand.
    expect(state.bank).toEqual({
      timber: 14 + 1 /* road */ + 1 /* settlement */,
      clay: 14 + 1 /* road */ + 1 /* settlement */,
      fleece: 14 + 1 /* settlement */ + 1 /* devcard */,
      barley: 11 + 1 /* settlement */ + 2 /* city */ + 1 /* devcard */ + 2 /* discard */,
      iron: 11 + 3 /* city */ + 1 /* devcard */ + 2 /* discard */,
    });
  });

  it('the credit derives from the profile, not a hardcoded 19 (bankPerResource honoured)', () => {
    // With no `bank` yet recorded, a credit seeds the pool from the resolved
    // profile default and adds the returned cost on top — the same
    // `?? bankPerResource` fallback the production gate uses.
    const state: GameState = {
      matchId: 'm',
      phase: 'main',
      turn: 3,
      currentPlayerId: 'player-1',
      players: [
        {
          id: 'player-1',
          name: 'player-1',
          victoryPoints: 0,
          resources: { timber: 1, clay: 1 },
        },
      ],
      eventIndex: 5,
      seedHash: '',
      // profileId absent -> resolves to 'classic' (bankPerResource 19)
    };
    const next = reduce(state, {
      type: 'road.built',
      index: 5,
      playerId: 'player-1',
      edgeId: 'e',
      cost: { timber: 1, clay: 1 },
    });
    expect(next.bank).toEqual({ timber: BANK_PER + 1, clay: BANK_PER + 1 });
  });
});

// --- No-starvation: the credit un-freezes the all-or-nothing production gate ---
// A minimal board mirroring production.test.ts: one timber tile (token 6) bears
// two settlements, so each 6-roll OWES 2 timber. With only 1 timber left the
// gate pays out NOBODY (all-or-nothing); after a build/discard credits timber
// back, the very same roll pays out again. Before S2.4.2a the bank could only
// ever drain here, so a build-heavy match froze production permanently.

// Seed + eventIndex chosen (per production.test.ts's header table) so this
// state's roll resolves to total 6 -> the timber tile produces.
const PROD_SEED = 'skervik-production-seed-1';
const topology = buildTopology();

function findDisjointTilePair(topo: BoardTopology): [TileTopology, TileTopology] {
  for (const a of topo.tiles) {
    for (const b of topo.tiles) {
      if (a.id === b.id) continue;
      if (!a.vertexIds.some((v) => b.vertexIds.includes(v))) return [a, b];
    }
  }
  throw new Error('fixture bug: no disjoint tile pair found');
}

const [tileA, tileB] = findDisjointTilePair(topology);

function makeBoard(): BoardState {
  const tileKinds: Record<string, string> = {};
  for (const tile of topology.tiles) {
    tileKinds[tile.id] =
      tile.id === tileA.id ? 'timber' : tile.id === tileB.id ? 'ore' : 'desert';
  }
  return {
    tileKinds,
    tileTokens: { [tileA.id]: 6, [tileB.id]: 11 },
    portContents: [],
    robberTileId: tileB.id, // parks the robber off the timber tile
  };
}

const board = makeBoard();
const vertexP1 = tileA.vertexIds[0] as string;
const vertexP2 = tileA.vertexIds[1] as string;

function makePlayers(): PlayerState[] {
  return [
    { id: 'player-1', name: 'player-1', victoryPoints: 0, resources: { timber: 2 } },
    { id: 'player-2', name: 'player-2', victoryPoints: 0, resources: {} },
  ];
}

function starvedState(bank: Record<ResourceType, number>): GameState {
  return {
    matchId: 'm-starve',
    phase: 'roll',
    turn: 1,
    currentPlayerId: 'player-1',
    players: makePlayers(),
    eventIndex: 1, // resolves to total 6 with PROD_SEED
    seedHash: 'deadbeef',
    board,
    buildings: {
      settlements: { [vertexP1]: 'player-1', [vertexP2]: 'player-2' },
      roads: {},
    } as BuildingsState,
    bank,
  };
}

describe('bank credit un-freezes starved production (S2.4.2a)', () => {
  function roll(state: GameState): ResourcesProducedEvent {
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      PROD_SEED,
    );
    if (!result.ok) throw new Error('expected ok roll');
    return result.events[1] as ResourcesProducedEvent;
  }

  it('with the bank starved (1 timber, 2 owed) the all-or-nothing gate pays out NOBODY', () => {
    const produced = roll(starvedState({ timber: 1 }));
    expect(produced.grants).toEqual({}); // frozen — bank can't cover the full 2
  });

  it('crediting timber back (a discard) lifts the bank over the threshold and production flows again', () => {
    // A discard-on-7 returns 2 timber to the starved bank via the fixed reduce.
    const credited = reduce(starvedState({ timber: 1 }), {
      type: 'resources.discarded',
      index: 1,
      playerId: 'player-1',
      resources: { timber: 2 },
      remainingToDiscard: [],
    } satisfies ResourcesDiscardedEvent);
    expect(credited.bank).toEqual({ timber: 3 }); // 1 + 2 returned

    // The SAME roll now clears the gate (3 available >= 2 owed) and pays out.
    const produced = roll(starvedState({ timber: 3 }));
    expect(produced.grants).toEqual({
      'player-1': { timber: 1 },
      'player-2': { timber: 1 },
    });
    expect(produced.bank).toEqual({ timber: 1 }); // 3 - 2 paid
  });
});
