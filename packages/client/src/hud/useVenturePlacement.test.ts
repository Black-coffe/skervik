import type { BuildingsState, GameState, PlayerState } from '@skervik/core';
import { buildTopology } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import {
  appendRoadBuildingEdge,
  buildRoadBuildingIntent,
  deriveVenturePlacement,
  resolveKnightTilePick,
  resolveKnightVictimPick,
} from './useVenturePlacement.js';

const topology = buildTopology();
const MY_ID = 'player-1';
const OPPONENT_ID = 'player-2';

const TILE = topology.tiles[0]!;
const OTHER_TILE = topology.tiles.find((t) => t.id !== TILE.id)!;
const V0 = topology.vertices[0]!;
const E0 = topology.edges.find((e) => e.vertexIds.includes(V0.id))!;
const E1 = topology.edges.find((e) => e.vertexIds.includes(V0.id) && e.id !== E0.id)!;

function player(
  id: string,
  resources: Partial<PlayerState['resources']> = {},
): PlayerState {
  return {
    id,
    name: id,
    victoryPoints: 0,
    resources: { timber: 0, clay: 0, fleece: 0, barley: 0, iron: 0, ...resources },
  };
}

function baseState(overrides: Partial<GameState>): GameState {
  return {
    matchId: 'test-match',
    phase: 'main',
    turn: 3,
    currentPlayerId: MY_ID,
    players: [],
    eventIndex: 0,
    seedHash: 'test-seed-hash',
    board: { tileKinds: {}, tileTokens: {}, portContents: [], robberTileId: TILE.id },
    buildings: { settlements: { [V0.id]: MY_ID }, roads: { [E0.id]: MY_ID } },
    ...overrides,
  };
}

describe('deriveVenturePlacement — inactive guards', () => {
  it('is inactive when no play is armed', () => {
    expect(deriveVenturePlacement(baseState({}), MY_ID, 'none', null, [])).toEqual({
      active: false,
      pickMode: 'none',
      legalTargets: null,
      prompt: null,
      victims: [],
    });
  });

  it('is inactive outside the main phase', () => {
    const view = deriveVenturePlacement(
      baseState({ phase: 'roll' }),
      MY_ID,
      'knight',
      null,
      [],
    );
    expect(view.active).toBe(false);
  });

  it("is inactive when it isn't my turn", () => {
    const view = deriveVenturePlacement(
      baseState({ currentPlayerId: OPPONENT_ID }),
      MY_ID,
      'knight',
      null,
      [],
    );
    expect(view.active).toBe(false);
  });

  it('is inactive once a Venture has already been played this turn', () => {
    const view = deriveVenturePlacement(
      baseState({ devCardPlayedThisTurn: true }),
      MY_ID,
      'roadBuilding',
      null,
      [],
    );
    expect(view.active).toBe(false);
  });
});

describe('deriveVenturePlacement — knight', () => {
  it('arms tile picking (prompt knightMove) when no tile is pending', () => {
    const view = deriveVenturePlacement(baseState({}), MY_ID, 'knight', null, []);
    expect(view.active).toBe(true);
    expect(view.pickMode).toBe('tile');
    expect(view.prompt).toBe('knightMove');
    expect(view.victims).toEqual([]);
  });

  it('shows the victim picker when a tile with ≥1 eligible victim is pending', () => {
    const buildings: BuildingsState = {
      settlements: { [OTHER_TILE.vertexIds[0]!]: OPPONENT_ID },
      roads: {},
    };
    const state = baseState({
      buildings,
      players: [player(MY_ID), player(OPPONENT_ID, { timber: 1 })],
    });
    const view = deriveVenturePlacement(state, MY_ID, 'knight', OTHER_TILE.id, []);
    expect(view.pickMode).toBe('none');
    expect(view.prompt).toBe('knightChooseVictim');
    expect(view.victims).toEqual([OPPONENT_ID]);
  });

  it('self-heals a stale pending tile with 0 victims back to tile-picking', () => {
    const state = baseState({ buildings: { settlements: {}, roads: {} }, players: [] });
    const view = deriveVenturePlacement(state, MY_ID, 'knight', OTHER_TILE.id, []);
    expect(view.pickMode).toBe('tile');
    expect(view.prompt).toBe('knightMove');
    expect(view.victims).toEqual([]);
  });
});

describe('deriveVenturePlacement — roadBuilding', () => {
  it('arms edge picking with prompt roadBuildingFirst at 0 picked', () => {
    const view = deriveVenturePlacement(baseState({}), MY_ID, 'roadBuilding', null, []);
    expect(view.active).toBe(true);
    expect(view.pickMode).toBe('edge');
    expect(view.prompt).toBe('roadBuildingFirst');
    expect(view.legalTargets?.kind).toBe('edge');
    expect(view.legalTargets?.ids).toContain(E1.id);
  });

  it('shows prompt roadBuildingSecond once 1 edge is picked', () => {
    const view = deriveVenturePlacement(baseState({}), MY_ID, 'roadBuilding', null, [
      E1.id,
    ]);
    expect(view.pickMode).toBe('edge');
    expect(view.prompt).toBe('roadBuildingSecond');
  });

  it('drops pickMode to none (and prompt to null) once 2 edges are picked (the cap)', () => {
    const view = deriveVenturePlacement(baseState({}), MY_ID, 'roadBuilding', null, [
      E0.id,
      E1.id,
    ]);
    expect(view.active).toBe(true);
    expect(view.pickMode).toBe('none');
    expect(view.prompt).toBeNull();
  });
});

describe('resolveKnightTilePick', () => {
  it('dispatches playDevCard{card:knight,tileId} immediately when 0 victims are eligible', () => {
    const state = baseState({ buildings: { settlements: {}, roads: {} }, players: [] });
    const result = resolveKnightTilePick(state, topology, OTHER_TILE.id, MY_ID);
    expect(result).toEqual({
      dispatch: {
        type: 'intent.playDevCard',
        playerId: MY_ID,
        card: 'knight',
        tileId: OTHER_TILE.id,
      },
    });
  });

  it('enters victim-choice (pendingTile) when ≥1 victim is eligible', () => {
    const buildings: BuildingsState = {
      settlements: { [OTHER_TILE.vertexIds[0]!]: OPPONENT_ID },
      roads: {},
    };
    const state = baseState({
      buildings,
      players: [player(MY_ID), player(OPPONENT_ID, { clay: 2 })],
    });
    const result = resolveKnightTilePick(state, topology, OTHER_TILE.id, MY_ID);
    expect(result).toEqual({ pendingTile: OTHER_TILE.id });
  });
});

describe('resolveKnightVictimPick', () => {
  it('builds the full playDevCard{card:knight,tileId,victimId} intent', () => {
    expect(resolveKnightVictimPick(OTHER_TILE.id, OPPONENT_ID, MY_ID)).toEqual({
      type: 'intent.playDevCard',
      playerId: MY_ID,
      card: 'knight',
      tileId: OTHER_TILE.id,
      victimId: OPPONENT_ID,
    });
  });
});

describe('appendRoadBuildingEdge', () => {
  it('appends a new edge', () => {
    expect(appendRoadBuildingEdge([], E0.id)).toEqual([E0.id]);
    expect(appendRoadBuildingEdge([E0.id], E1.id)).toEqual([E0.id, E1.id]);
  });

  it('dedupes a re-clicked edge (no-op)', () => {
    expect(appendRoadBuildingEdge([E0.id], E0.id)).toEqual([E0.id]);
  });

  it('caps at 2 — a 3rd pick is ignored', () => {
    const OTHER_EDGE = topology.edges.find((e) => e.id !== E0.id && e.id !== E1.id)!;
    expect(appendRoadBuildingEdge([E0.id, E1.id], OTHER_EDGE.id)).toEqual([E0.id, E1.id]);
  });
});

describe('buildRoadBuildingIntent', () => {
  it('builds the playDevCard{card:roadBuilding,edgeIds} intent for 2 edges', () => {
    expect(buildRoadBuildingIntent([E0.id, E1.id], MY_ID)).toEqual({
      type: 'intent.playDevCard',
      playerId: MY_ID,
      card: 'roadBuilding',
      edgeIds: [E0.id, E1.id],
    });
  });

  it('allows just 1 edge (the core is tolerant, validate.ts:1554-1588)', () => {
    expect(buildRoadBuildingIntent([E0.id], MY_ID)).toEqual({
      type: 'intent.playDevCard',
      playerId: MY_ID,
      card: 'roadBuilding',
      edgeIds: [E0.id],
    });
  });
});
