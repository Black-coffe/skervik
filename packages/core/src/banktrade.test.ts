// @skervik/core — S1.3.3: bank & port trade (4:1 / 3:1 / 2:1). Exercises the
// full `intent.bankTrade` -> `validate` -> events -> `reduce` pipeline: rate
// resolution from owned ports (port ownership = a settlement/city on either
// endpoint of that port slot's edge, S1.1.1/S1.1.2 pairing), the "owns a 2:1
// port for a DIFFERENT resource doesn't help" edge case, give-count/
// affordability/bank-stock negative tests, and bank conservation.

import { describe, expect, it } from 'vitest';

import { buildTopology, findEdge, type PortSlot, type VertexId } from './board.js';
import { reduce } from './reduce.js';
import type {
  BankTradedEvent,
  BoardState,
  BuildingsState,
  GameState,
  PlayerState,
  PortContent,
} from './types.js';
import { validate } from './validate.js';

// No RNG in this story (pure resource logic) — passed only as `validate`'s
// 4th param, per the engine contract (A1).
const SEED = 'skervik-banktrade-seed-1';

const topology = buildTopology();

/** This fixture's port contents, 1:1 by index with `topology.portSlots` (S1.1.2 pairing, `types.ts`'s `PortContent` docstring). */
const PORT_CONTENTS: PortContent[] = [
  { kind: 'generic', rate: 3 }, // slot 0 — player-2's generic port
  { kind: 'resource', rate: 2, resource: 'timber' }, // slot 1 — player-3's timber port
  { kind: 'generic', rate: 3 },
  { kind: 'resource', rate: 2, resource: 'clay' },
  { kind: 'generic', rate: 3 },
  { kind: 'resource', rate: 2, resource: 'fleece' },
  { kind: 'resource', rate: 2, resource: 'barley' },
  { kind: 'resource', rate: 2, resource: 'iron' },
  { kind: 'generic', rate: 3 },
];

/** One endpoint of the given port slot's edge — placing a settlement here "owns" that port (S1.3.3 spec). */
function vertexForPortSlot(index: number): VertexId {
  const slot = topology.portSlots[index] as PortSlot;
  const edge = findEdge(topology, slot.edgeId);
  if (!edge) throw new Error(`fixture bug: no edge for port slot ${index}`);
  return edge.vertexIds[0];
}

function makePlayer(id: string, resources: Record<string, number> = {}): PlayerState {
  return { id, name: id, victoryPoints: 0, resources };
}

function makeBoard(): BoardState {
  return {
    tileKinds: {},
    tileTokens: {},
    portContents: PORT_CONTENTS,
    robberTileId: topology.tiles[0]?.id ?? '0,0',
  };
}

/**
 * Genesis: 3 players in the main phase, `player-1` current, each holding
 * plenty of every traded resource so affordability isn't the thing under
 * test unless a case overrides it. `player-2` owns the generic port (slot
 * 0); `player-3` owns the timber-resource port (slot 1) only — reused for
 * both the matching-resource 2:1 case (trading timber) and the "2:1 for a
 * DIFFERENT resource doesn't help" edge case (trading clay, which falls
 * through to the base 4:1 since player-3 owns no generic port either).
 */
function makeState(overrides: Partial<GameState> = {}): GameState {
  const buildings: BuildingsState = {
    settlements: {
      [vertexForPortSlot(0)]: 'player-2',
      [vertexForPortSlot(1)]: 'player-3',
    },
    roads: {},
  };
  return {
    matchId: 'match-banktrade-1',
    phase: 'main',
    turn: 4,
    currentPlayerId: 'player-1',
    players: [
      makePlayer('player-1', { timber: 8, clay: 8, fleece: 8, barley: 8, iron: 8 }),
      makePlayer('player-2', { timber: 8, clay: 8, fleece: 8, barley: 8, iron: 8 }),
      makePlayer('player-3', { timber: 8, clay: 8, fleece: 8, barley: 8, iron: 8 }),
    ],
    playerOrder: ['player-1', 'player-2', 'player-3'],
    eventIndex: 30,
    seedHash: 'deadbeef',
    board: makeBoard(),
    buildings,
    ...overrides,
  };
}

/** Player-held cards + the bank pool for `resources` — the conservation measure (an untouched bank line defaults to the full Classic 19). */
function totalConserved(state: GameState, resources: readonly string[]): number {
  const playerTotal = state.players.reduce(
    (sum, player) =>
      sum +
      Object.values(player.resources).reduce((lineSum, amount) => lineSum + amount, 0),
    0,
  );
  const bankTotal = resources.reduce(
    (sum, resource) => sum + (state.bank?.[resource] ?? 19),
    0,
  );
  return playerTotal + bankTotal;
}

describe('intent.bankTrade — rate resolution (S1.3.3)', () => {
  it('resolves 4:1 for a player who owns no port', () => {
    const state = makeState();
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 4,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: 'bank.trade',
          index: state.eventIndex,
          playerId: 'player-1',
          give: 'timber',
          count: 4,
          get: 'iron',
          bank: { iron: 18, timber: 23 },
        },
      ],
    });
  });

  it('resolves 3:1 for a player who owns a generic port', () => {
    const state = makeState({ currentPlayerId: 'player-2' });
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-2',
        give: 'timber',
        count: 3,
        get: 'iron',
      },
      'player-2',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect((result.events[0] as BankTradedEvent).count).toBe(3);
  });

  it('resolves 2:1 for a player who owns a matching resource port', () => {
    const state = makeState({ currentPlayerId: 'player-3' });
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-3',
        give: 'timber',
        count: 2,
        get: 'iron',
      },
      'player-3',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect((result.events[0] as BankTradedEvent).count).toBe(2);
  });

  it('a 2:1 port for a DIFFERENT resource does not help — still falls to the base 4:1', () => {
    const state = makeState({ currentPlayerId: 'player-3' });
    // player-3 owns the TIMBER port, not clay, and owns no generic port —
    // trading clay must fall all the way to the base rate.
    const wrongCount = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-3',
        give: 'clay',
        count: 2,
        get: 'iron',
      },
      'player-3',
      SEED,
    );
    expect(wrongCount).toEqual({ ok: false, reason: 'WRONG_RATE_COUNT' });

    const rightCount = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-3',
        give: 'clay',
        count: 4,
        get: 'iron',
      },
      'player-3',
      SEED,
    );
    expect(rightCount.ok).toBe(true);
  });
});

describe('intent.bankTrade — negative cases (S1.3.3)', () => {
  it('rejects WRONG_RATE_COUNT when count does not match the resolved rate', () => {
    const result = validate(
      makeState(),
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 3,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'WRONG_RATE_COUNT' });
  });

  it('rejects MALFORMED_INTENT for a non-positive count', () => {
    const result = validate(
      makeState(),
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 0,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'MALFORMED_INTENT' });
  });

  it('rejects CANNOT_AFFORD when the player cannot cover the give amount', () => {
    const state = makeState({
      players: [
        makePlayer('player-1', { timber: 2 }), // only 2, needs 4 at the base rate
        makePlayer('player-2', { timber: 8 }),
        makePlayer('player-3', { timber: 8 }),
      ],
    });
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 4,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'CANNOT_AFFORD' });
  });

  it('rejects BANK_EXHAUSTED when the bank holds none of the requested get-resource', () => {
    const state = makeState({ bank: { iron: 0 } });
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 4,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'BANK_EXHAUSTED' });
  });

  it('rejects NOT_YOUR_TURN for a non-current player', () => {
    const result = validate(
      makeState(),
      {
        type: 'intent.bankTrade',
        playerId: 'player-2',
        give: 'timber',
        count: 3,
        get: 'iron',
      },
      'player-2',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
  });

  it('rejects MUST_ROLL_FIRST from the roll phase (bank trades are main-phase only)', () => {
    const result = validate(
      makeState({ phase: 'roll' }),
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 4,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'MUST_ROLL_FIRST' });
  });
});

describe('intent.bankTrade — reduce + conservation (S1.3.3)', () => {
  it('debits the give resource and credits the get resource in one reduce step, bank conserved', () => {
    const state = makeState();
    const before = totalConserved(state, ['timber', 'iron']);

    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 4,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    const next = reduce(state, result.events[0] as BankTradedEvent);

    expect(next.players.find((p) => p.id === 'player-1')?.resources).toMatchObject({
      timber: 4, // 8 - 4
      iron: 9, // 8 + 1
    });
    expect(next.bank).toEqual({ iron: 18, timber: 23 }); // 19-1 get, 19+4 give-back
    expect(totalConserved(next, ['timber', 'iron'])).toBe(before);
  });

  it('never mutates its input state', () => {
    const state = makeState();
    const before: GameState = JSON.parse(JSON.stringify(state)) as GameState;
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 4,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    reduce(state, result.events[0] as BankTradedEvent);
    expect(state).toEqual(before);
  });

  it('is deterministic: same state -> same event, no ambient draw', () => {
    const state = makeState();
    const first = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 4,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    const second = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 4,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(second).toEqual(first);
  });
});
