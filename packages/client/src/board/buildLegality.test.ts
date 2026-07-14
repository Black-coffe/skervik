import type { BuildingsState, GameState } from '@skervik/core';
import { buildTopology, CLASSIC_BUILD_PROFILE } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import {
  canAffordCost,
  canBuildType,
  legalBuildCities,
  legalBuildRoads,
  legalBuildSettlements,
} from './buildLegality.js';

const topology = buildTopology();
const ME = 'player-1';
const FOE = 'player-2';

function stateWith(buildings: BuildingsState | undefined): GameState {
  return {
    matchId: 'test-match',
    phase: 'main',
    turn: 3,
    currentPlayerId: ME,
    players: [],
    eventIndex: 0,
    seedHash: 'test-seed-hash',
    ...(buildings ? { buildings } : {}),
  };
}

// A connected chain V0 -(E0)- V1 -(E1)- V2 where V2 is NOT adjacent to V0
// (so a settlement at V2 clears the distance rule against a settlement at V0).
function findChain() {
  for (const v0 of topology.vertices) {
    for (const e0 of topology.edges) {
      if (!e0.vertexIds.includes(v0.id)) continue;
      const v1 = e0.vertexIds.find((id) => id !== v0.id);
      if (v1 === undefined) continue;
      for (const e1 of topology.edges) {
        if (e1.id === e0.id) continue;
        if (!e1.vertexIds.includes(v1)) continue;
        if (e1.vertexIds.includes(v0.id)) continue;
        const v2 = e1.vertexIds.find((id) => id !== v1);
        if (v2 === undefined) continue;
        if (v0.adjacentVertexIds.includes(v2)) continue;
        return { v0: v0.id, e0: e0.id, v1, e1: e1.id, v2 };
      }
    }
  }
  throw new Error('expected a V0-E0-V1-E1-V2 chain in the board topology');
}

const chain = findChain();

describe('legalBuildRoads', () => {
  it('an edge incident to an own settlement is legal (network connectivity)', () => {
    const buildings: BuildingsState = { settlements: { [chain.v0]: ME }, roads: {} };
    const legal = legalBuildRoads(stateWith(buildings), topology, ME);
    expect(legal).toContain(chain.e0);
  });

  it("excludes an already-occupied edge (even the player's own road)", () => {
    const buildings: BuildingsState = {
      settlements: { [chain.v0]: ME },
      roads: { [chain.e0]: ME },
    };
    const legal = legalBuildRoads(stateWith(buildings), topology, ME);
    expect(legal).not.toContain(chain.e0);
  });

  it("excludes edges with no connection to the player's own network", () => {
    // Only a FOE settlement exists — the player has no network at all.
    const buildings: BuildingsState = { settlements: { [chain.v0]: FOE }, roads: {} };
    const legal = legalBuildRoads(stateWith(buildings), topology, ME);
    expect(legal).toHaveLength(0);
  });

  it('returns nothing when road supply is exhausted', () => {
    const roads: Record<string, string> = {};
    for (const edge of topology.edges.slice(0, CLASSIC_BUILD_PROFILE.supply.roads)) {
      roads[edge.id] = ME;
    }
    const buildings: BuildingsState = { settlements: { [chain.v0]: ME }, roads };
    expect(legalBuildRoads(stateWith(buildings), topology, ME)).toHaveLength(0);
  });
});

describe('legalBuildSettlements', () => {
  it('a distance-clear vertex connected to an own road is legal', () => {
    const buildings: BuildingsState = {
      settlements: { [chain.v0]: ME },
      roads: { [chain.e0]: ME, [chain.e1]: ME },
    };
    const legal = legalBuildSettlements(stateWith(buildings), topology, ME);
    expect(legal).toContain(chain.v2);
  });

  it('requires road connectivity — a lone settlement (no roads) yields nothing', () => {
    const buildings: BuildingsState = { settlements: { [chain.v0]: ME }, roads: {} };
    expect(legalBuildSettlements(stateWith(buildings), topology, ME)).toHaveLength(0);
  });

  it('excludes a vertex adjacent to an existing building (distance rule)', () => {
    // V1 touches own road E0 but is adjacent to the V0 settlement.
    const buildings: BuildingsState = {
      settlements: { [chain.v0]: ME },
      roads: { [chain.e0]: ME },
    };
    const legal = legalBuildSettlements(stateWith(buildings), topology, ME);
    expect(legal).not.toContain(chain.v1);
  });

  it('excludes an occupied vertex', () => {
    const buildings: BuildingsState = {
      settlements: { [chain.v0]: ME },
      roads: { [chain.e0]: ME, [chain.e1]: ME },
    };
    const legal = legalBuildSettlements(stateWith(buildings), topology, ME);
    expect(legal).not.toContain(chain.v0);
  });

  it('returns nothing when settlement supply is exhausted', () => {
    const settlements: Record<string, string> = {};
    for (const vertex of topology.vertices.slice(
      0,
      CLASSIC_BUILD_PROFILE.supply.settlements,
    )) {
      settlements[vertex.id] = ME;
    }
    const buildings: BuildingsState = {
      settlements,
      roads: { [chain.e0]: ME, [chain.e1]: ME },
    };
    expect(legalBuildSettlements(stateWith(buildings), topology, ME)).toHaveLength(0);
  });
});

describe('legalBuildCities', () => {
  it("returns the player's own settlement vertices", () => {
    const buildings: BuildingsState = {
      settlements: { [chain.v0]: ME, [chain.v2]: FOE },
      roads: {},
    };
    const legal = legalBuildCities(stateWith(buildings), ME);
    expect(legal).toContain(chain.v0);
    expect(legal).not.toContain(chain.v2); // enemy settlement
  });

  it('excludes a vertex already upgraded to a city (no longer a settlements key)', () => {
    const buildings: BuildingsState = {
      settlements: {},
      roads: {},
      cities: { [chain.v0]: ME },
    };
    expect(legalBuildCities(stateWith(buildings), ME)).toHaveLength(0);
  });

  it('returns nothing when city supply is exhausted', () => {
    const settlements: Record<string, string> = {};
    const cities: Record<string, string> = {};
    for (const vertex of topology.vertices.slice(
      0,
      CLASSIC_BUILD_PROFILE.supply.cities,
    )) {
      cities[vertex.id] = ME;
    }
    settlements[chain.v0] = ME;
    const buildings: BuildingsState = { settlements, roads: {}, cities };
    expect(legalBuildCities(stateWith(buildings), ME)).toHaveLength(0);
  });
});

describe('canAffordCost', () => {
  it('is true when every cost line is covered', () => {
    expect(canAffordCost({ timber: 1, clay: 1 }, { timber: 1, clay: 1 })).toBe(true);
  });

  it('is false when one resource is one short (boundary)', () => {
    expect(canAffordCost({ timber: 1, clay: 0 }, { timber: 1, clay: 1 })).toBe(false);
  });

  it('treats an absent resource as zero', () => {
    expect(canAffordCost({ timber: 5 }, { clay: 1 })).toBe(false);
  });
});

describe('canBuildType', () => {
  const road = CLASSIC_BUILD_PROFILE.costs.road;

  it('is true when affordable and supply remains', () => {
    expect(canBuildType(stateWith(undefined), road, ME, 'road')).toBe(true);
  });

  it('is false when unaffordable (one short of the cost)', () => {
    expect(canBuildType(stateWith(undefined), { timber: 1 }, ME, 'road')).toBe(false);
  });

  it("is false when that type's supply is exhausted despite affordability", () => {
    const settlements: Record<string, string> = {};
    for (const vertex of topology.vertices.slice(
      0,
      CLASSIC_BUILD_PROFILE.supply.settlements,
    )) {
      settlements[vertex.id] = ME;
    }
    const buildings: BuildingsState = { settlements, roads: {} };
    const rich = { timber: 9, clay: 9, fleece: 9, barley: 9, iron: 9 };
    expect(canBuildType(stateWith(buildings), rich, ME, 'settlement')).toBe(false);
  });
});
