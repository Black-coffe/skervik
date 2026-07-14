import type { BuildingsState, GameState } from '@skervik/core';
import { buildTopology } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { legalSetupRoads, legalSetupSettlements } from './setupLegality.js';

const topology = buildTopology();

function stateWithBuildings(buildings: BuildingsState | undefined): GameState {
  return {
    matchId: 'test-match',
    phase: 'setup',
    turn: 1,
    currentPlayerId: 'player-1',
    players: [],
    eventIndex: 0,
    seedHash: 'test-seed-hash',
    ...(buildings ? { buildings } : {}),
  };
}

describe('legalSetupSettlements', () => {
  it('returns every vertex when no buildings exist', () => {
    const legal = legalSetupSettlements(stateWithBuildings(undefined), topology);
    expect(legal).toHaveLength(topology.vertices.length);
  });

  it('a placed settlement blocks itself and its adjacent vertices (distance rule)', () => {
    const vertex = topology.vertices[0];
    expect(vertex).toBeDefined();
    if (!vertex) throw new Error('expected a vertex');

    const buildings: BuildingsState = {
      settlements: { [vertex.id]: 'player-1' },
      roads: {},
    };
    const legal = legalSetupSettlements(stateWithBuildings(buildings), topology);

    expect(legal).not.toContain(vertex.id);
    for (const adjacentId of vertex.adjacentVertexIds) {
      expect(legal).not.toContain(adjacentId);
    }
    // A vertex 2+ hops away is unaffected.
    const untouched = topology.vertices.find(
      (v) => v.id !== vertex.id && !vertex.adjacentVertexIds.includes(v.id),
    );
    expect(untouched).toBeDefined();
    if (untouched) expect(legal).toContain(untouched.id);
  });

  it('a city on a vertex blocks it the same as a settlement', () => {
    const vertex = topology.vertices[0];
    expect(vertex).toBeDefined();
    if (!vertex) throw new Error('expected a vertex');

    const buildings: BuildingsState = {
      settlements: {},
      roads: {},
      cities: { [vertex.id]: 'player-1' },
    };
    const legal = legalSetupSettlements(stateWithBuildings(buildings), topology);
    expect(legal).not.toContain(vertex.id);
  });
});

describe('legalSetupRoads', () => {
  it('returns only empty edges incident to the pending vertex', () => {
    const vertex = topology.vertices[0];
    expect(vertex).toBeDefined();
    if (!vertex) throw new Error('expected a vertex');

    const buildings: BuildingsState = {
      settlements: { [vertex.id]: 'player-1' },
      roads: {},
    };
    const legal = legalSetupRoads(stateWithBuildings(buildings), topology, vertex.id);

    expect([...legal].sort()).toEqual([...vertex.edgeIds].sort());
    // Every returned edge is genuinely incident to the pending vertex.
    for (const edgeId of legal) {
      const edge = topology.edges.find((e) => e.id === edgeId);
      expect(edge?.vertexIds).toContain(vertex.id);
    }
    // An edge NOT incident to the pending vertex is excluded.
    const detached = topology.edges.find((e) => !e.vertexIds.includes(vertex.id));
    expect(detached).toBeDefined();
    if (detached) expect(legal).not.toContain(detached.id);
  });

  it('excludes an already-taken edge incident to the pending vertex', () => {
    const vertex = topology.vertices[0];
    expect(vertex).toBeDefined();
    if (!vertex) throw new Error('expected a vertex');
    const takenEdgeId = vertex.edgeIds[0];
    expect(takenEdgeId).toBeDefined();
    if (!takenEdgeId) throw new Error('expected an edge on the vertex');

    const buildings: BuildingsState = {
      settlements: { [vertex.id]: 'player-1' },
      roads: { [takenEdgeId]: 'player-1' },
    };
    const legal = legalSetupRoads(stateWithBuildings(buildings), topology, vertex.id);

    expect(legal).not.toContain(takenEdgeId);
    expect([...legal].sort()).toEqual(
      [...vertex.edgeIds].filter((id) => id !== takenEdgeId).sort(),
    );
  });
});
