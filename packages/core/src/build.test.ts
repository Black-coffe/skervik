// @skervik/core — S1.2.2: build actions (road / settlement / city). Exercises
// the full `intent.buildRoad` / `intent.buildSettlement` / `intent.buildCity`
// -> `validate` -> events -> `reduce` pipeline: Classic costs, network/
// distance/upgrade legality (reusing the S1.1.1 topology adjacency and the
// S1.1.3 distance-rule helper, never duplicating it), piece-supply limits,
// and one negative test per S1.2.2 reject reason.

import { describe, expect, it } from 'vitest';

import {
  type BoardTopology,
  buildTopology,
  type EdgeTopology,
  findEdge,
  findVertex,
  type VertexTopology,
} from './board.js';
import { reduce } from './reduce.js';
import type {
  CityBuiltEvent,
  GameEvent,
  GameState,
  PlayerState,
  RoadBuiltEvent,
  SettlementBuiltEvent,
} from './types.js';
import { validate } from './validate.js';

// Build actions never draw from the PRNG (cost/legality is deterministic) —
// the seed is passed only to satisfy the fixed `validate` signature (plan §1).
const SEED = 'skervik-build-seed-1';

const topology = buildTopology();

/**
 * A 3-vertex chain `A - B - C` from 2 of `vertexB`'s incident edges. The hex
 * vertex graph is bipartite (no triangles), so `A` and `C` — both neighbors
 * of `B` — are never adjacent to each other; this makes the chain a safe,
 * reusable fixture for both the distance rule (A and C never collide) and
 * network-connectivity legality (B links A's network to edge B-C).
 */
function findChain(topo: BoardTopology): {
  vertexA: VertexTopology;
  edgeAB: EdgeTopology;
  vertexB: VertexTopology;
  edgeBC: EdgeTopology;
  vertexC: VertexTopology;
} {
  const vertexB = topo.vertices.find((v) => v.edgeIds.length >= 2);
  if (!vertexB) throw new Error('fixture bug: no vertex with >=2 edges found');
  const edgeAB = findEdge(topo, vertexB.edgeIds[0] as string) as EdgeTopology;
  const edgeBC = findEdge(topo, vertexB.edgeIds[1] as string) as EdgeTopology;
  const vertexA = findVertex(
    topo,
    edgeAB.vertexIds.find((id) => id !== vertexB.id) as string,
  ) as VertexTopology;
  const vertexC = findVertex(
    topo,
    edgeBC.vertexIds.find((id) => id !== vertexB.id) as string,
  ) as VertexTopology;
  return { vertexA, edgeAB, vertexB, edgeBC, vertexC };
}

const { vertexA, edgeAB, vertexB, edgeBC, vertexC } = findChain(topology);

// Rich enough to afford every Classic build several times over, so
// affordability never accidentally masks the legality rule under test.
const RICH_RESOURCES = { timber: 5, clay: 5, fleece: 5, barley: 5, iron: 5 };

function makePlayer(
  id: string,
  victoryPoints: number,
  resources: Record<string, number>,
): PlayerState {
  return { id, name: id, victoryPoints, resources };
}

/**
 * Genesis: player-1 already has the setup-phase settlement at `vertexA` +
 * road `edgeAB` (as if the S1.1.3 draft already ran); both players are rich
 * enough to afford any Classic build. Overridable per test.
 */
function makeGenesis(overrides: Partial<GameState> = {}): GameState {
  return {
    matchId: 'match-build-1',
    phase: 'main',
    turn: 5,
    currentPlayerId: 'player-1',
    players: [
      makePlayer('player-1', 1, { ...RICH_RESOURCES }),
      makePlayer('player-2', 0, { ...RICH_RESOURCES }),
    ],
    eventIndex: 10,
    seedHash: 'deadbeef',
    buildings: {
      settlements: { [vertexA.id]: 'player-1' },
      roads: { [edgeAB.id]: 'player-1' },
    },
    ...overrides,
  };
}

describe('build actions (S1.2.2)', () => {
  describe('happy paths', () => {
    it('road: debits cost, places it, connects via the S1.1.1 network helper', () => {
      const genesis = makeGenesis();

      const result = validate(
        genesis,
        { type: 'intent.buildRoad', playerId: 'player-1', edgeId: edgeBC.id },
        'player-1',
        SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as RoadBuiltEvent;
      expect(event).toMatchObject({
        type: 'road.built',
        edgeId: edgeBC.id,
        cost: { timber: 1, clay: 1 },
      });

      const next = reduce(genesis, event);
      expect(next.buildings?.roads[edgeBC.id]).toBe('player-1');
      expect(next.players.find((p) => p.id === 'player-1')?.resources).toEqual({
        ...RICH_RESOURCES,
        timber: 4,
        clay: 4,
      });
      expect(next.eventIndex).toBe(genesis.eventIndex + 1);
    });

    it('settlement: debits cost, places it, awards +1 VP, requires an own road', () => {
      const genesis = makeGenesis({
        buildings: {
          settlements: { [vertexA.id]: 'player-1' },
          roads: { [edgeAB.id]: 'player-1', [edgeBC.id]: 'player-1' },
        },
      });

      const result = validate(
        genesis,
        { type: 'intent.buildSettlement', playerId: 'player-1', vertexId: vertexC.id },
        'player-1',
        SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as SettlementBuiltEvent;
      expect(event).toMatchObject({
        type: 'settlement.built',
        vertexId: vertexC.id,
        cost: { timber: 1, clay: 1, fleece: 1, barley: 1 },
      });

      const next = reduce(genesis, event);
      expect(next.buildings?.settlements[vertexC.id]).toBe('player-1');
      expect(next.players.find((p) => p.id === 'player-1')?.victoryPoints).toBe(2);
      expect(next.players.find((p) => p.id === 'player-1')?.resources).toEqual({
        ...RICH_RESOURCES,
        timber: 4,
        clay: 4,
        fleece: 4,
        barley: 4,
      });
    });

    it('city: upgrades the own settlement, returns it to supply, nets +1 VP', () => {
      const genesis = makeGenesis();

      const result = validate(
        genesis,
        { type: 'intent.buildCity', playerId: 'player-1', vertexId: vertexA.id },
        'player-1',
        SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as CityBuiltEvent;
      expect(event).toMatchObject({
        type: 'city.built',
        vertexId: vertexA.id,
        cost: { iron: 3, barley: 2 },
      });

      const next = reduce(genesis, event);
      // The settlement is returned to supply (no longer a key at all — free
      // for a future different settlement) and the vertex now belongs to `cities`.
      expect(next.buildings?.settlements[vertexA.id]).toBeUndefined();
      expect(next.buildings?.cities?.[vertexA.id]).toBe('player-1');
      expect(next.players.find((p) => p.id === 'player-1')?.victoryPoints).toBe(2);
      expect(next.players.find((p) => p.id === 'player-1')?.resources).toEqual({
        ...RICH_RESOURCES,
        iron: 2,
        barley: 3,
      });
    });
  });

  describe('legality rejections', () => {
    it('rejects OCCUPIED when the target edge already holds a road', () => {
      const result = validate(
        makeGenesis(),
        { type: 'intent.buildRoad', playerId: 'player-1', edgeId: edgeAB.id },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'OCCUPIED' });
    });

    it('rejects OCCUPIED when the target vertex already holds a settlement', () => {
      const result = validate(
        makeGenesis(),
        { type: 'intent.buildSettlement', playerId: 'player-1', vertexId: vertexA.id },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'OCCUPIED' });
    });

    it('rejects DISTANCE_VIOLATION when the target vertex is adjacent to an existing settlement', () => {
      const genesis = makeGenesis({ currentPlayerId: 'player-2' });

      const result = validate(
        genesis,
        { type: 'intent.buildSettlement', playerId: 'player-2', vertexId: vertexB.id },
        'player-2',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'DISTANCE_VIOLATION' });
    });

    it('rejects NOT_CONNECTED when the target edge does not touch the own network', () => {
      const genesis = makeGenesis({ currentPlayerId: 'player-2' });

      const result = validate(
        genesis,
        { type: 'intent.buildRoad', playerId: 'player-2', edgeId: edgeBC.id },
        'player-2',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'NOT_CONNECTED' });
    });

    it('rejects NOT_CONNECTED when the target vertex does not touch an own road', () => {
      const genesis = makeGenesis({ currentPlayerId: 'player-2' });

      const result = validate(
        genesis,
        { type: 'intent.buildSettlement', playerId: 'player-2', vertexId: vertexC.id },
        'player-2',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'NOT_CONNECTED' });
    });

    it("rejects NOT_OWN_SETTLEMENT when the target vertex holds no settlement of the actor's", () => {
      const result = validate(
        makeGenesis(),
        { type: 'intent.buildCity', playerId: 'player-1', vertexId: vertexC.id },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'NOT_OWN_SETTLEMENT' });
    });

    it('rejects CANNOT_AFFORD when the actor lacks the Classic cost', () => {
      const genesis = makeGenesis({
        players: [makePlayer('player-1', 1, {}), makePlayer('player-2', 0, {})],
      });

      const result = validate(
        genesis,
        { type: 'intent.buildRoad', playerId: 'player-1', edgeId: edgeBC.id },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'CANNOT_AFFORD' });
    });

    it('rejects SUPPLY_EXHAUSTED at the 15-road cap', () => {
      const roads: Record<string, string> = { [edgeAB.id]: 'player-1' };
      for (let i = 0; i < 14; i++) roads[`fake-edge-${i}`] = 'player-1';
      expect(Object.keys(roads)).toHaveLength(15);
      const genesis = makeGenesis({
        buildings: { settlements: { [vertexA.id]: 'player-1' }, roads },
      });

      const result = validate(
        genesis,
        { type: 'intent.buildRoad', playerId: 'player-1', edgeId: edgeBC.id },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'SUPPLY_EXHAUSTED' });
    });

    it('rejects SUPPLY_EXHAUSTED at the 5-settlement cap', () => {
      const settlements: Record<string, string> = { [vertexA.id]: 'player-1' };
      for (let i = 0; i < 4; i++) settlements[`fake-vertex-${i}`] = 'player-1';
      expect(Object.keys(settlements)).toHaveLength(5);
      const genesis = makeGenesis({
        buildings: {
          settlements,
          roads: { [edgeAB.id]: 'player-1', [edgeBC.id]: 'player-1' },
        },
      });

      const result = validate(
        genesis,
        { type: 'intent.buildSettlement', playerId: 'player-1', vertexId: vertexC.id },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'SUPPLY_EXHAUSTED' });
    });

    it('rejects SUPPLY_EXHAUSTED at the 4-city cap', () => {
      const cities: Record<string, string> = {};
      for (let i = 0; i < 4; i++) cities[`fake-city-${i}`] = 'player-1';
      expect(Object.keys(cities)).toHaveLength(4);
      const genesis = makeGenesis({
        buildings: { settlements: { [vertexA.id]: 'player-1' }, roads: {}, cities },
      });

      const result = validate(
        genesis,
        { type: 'intent.buildCity', playerId: 'player-1', vertexId: vertexA.id },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'SUPPLY_EXHAUSTED' });
    });

    it('rejects NOT_YOUR_TURN and INVALID_PHASE like every other main-phase intent', () => {
      const genesis = makeGenesis();

      const wrongTurn = validate(
        genesis,
        { type: 'intent.buildRoad', playerId: 'player-2', edgeId: edgeBC.id },
        'player-2',
        SEED,
      );
      expect(wrongTurn).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });

      const wrongPhase = validate(
        { ...genesis, phase: 'setup' },
        { type: 'intent.buildRoad', playerId: 'player-1', edgeId: edgeBC.id },
        'player-1',
        SEED,
      );
      expect(wrongPhase).toEqual({ ok: false, reason: 'INVALID_PHASE' });
    });
  });

  describe('determinism', () => {
    it('replays a full road -> settlement -> city sequence to the same deep-equal state', () => {
      const genesis = makeGenesis();
      let state = genesis;
      const events: GameEvent[] = [];

      const roadResult = validate(
        state,
        { type: 'intent.buildRoad', playerId: 'player-1', edgeId: edgeBC.id },
        'player-1',
        SEED,
      );
      if (!roadResult.ok) throw new Error('expected ok result');
      state = roadResult.events.reduce(reduce, state);
      events.push(...roadResult.events);

      const settlementResult = validate(
        state,
        { type: 'intent.buildSettlement', playerId: 'player-1', vertexId: vertexC.id },
        'player-1',
        SEED,
      );
      if (!settlementResult.ok) throw new Error('expected ok result');
      state = settlementResult.events.reduce(reduce, state);
      events.push(...settlementResult.events);

      const cityResult = validate(
        state,
        { type: 'intent.buildCity', playerId: 'player-1', vertexId: vertexA.id },
        'player-1',
        SEED,
      );
      if (!cityResult.ok) throw new Error('expected ok result');
      state = cityResult.events.reduce(reduce, state);
      events.push(...cityResult.events);

      // 1 (genesis) + 1 (new settlement) + 1 more (city) = 3 total VP.
      expect(state.players.find((p) => p.id === 'player-1')?.victoryPoints).toBe(3);

      const replayed = events.reduce(reduce, genesis);
      expect(replayed).toEqual(state);
    });

    it('never mutates input state through the full buildRoad -> events -> reduce pipeline', () => {
      const genesis = makeGenesis();
      const before: GameState = JSON.parse(JSON.stringify(genesis)) as GameState;

      const result = validate(
        genesis,
        { type: 'intent.buildRoad', playerId: 'player-1', edgeId: edgeBC.id },
        'player-1',
        SEED,
      );
      if (!result.ok) throw new Error('expected ok result');
      result.events.reduce(reduce, genesis);

      expect(genesis).toEqual(before);
    });
  });
});
