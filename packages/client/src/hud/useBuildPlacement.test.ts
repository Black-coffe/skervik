import type { BuildingsState, GameState } from '@skervik/core';
import { buildTopology } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import type { Pick } from '../board/BoardScene.js';
import { deriveBuildPlacement, resolveBuildPick } from './useBuildPlacement.js';

const topology = buildTopology();
const MY_ID = 'player-1';
const OPPONENT_ID = 'player-2';

// A settlement + a road on one of its edges, so the derived legal-target sets
// for road/settlement are non-empty (network connectivity present).
const V0 = topology.vertices[0]!;
const E0 = topology.edges.find((e) => e.vertexIds.includes(V0.id))!;
const BUILDINGS: BuildingsState = {
  settlements: { [V0.id]: MY_ID },
  roads: { [E0.id]: MY_ID },
};

function baseState(overrides: Partial<GameState>): GameState {
  return {
    matchId: 'test-match',
    phase: 'main',
    turn: 3,
    currentPlayerId: MY_ID,
    players: [],
    eventIndex: 0,
    seedHash: 'test-seed-hash',
    buildings: BUILDINGS,
    ...overrides,
  };
}

describe('deriveBuildPlacement', () => {
  it('is inactive outside the main phase', () => {
    expect(deriveBuildPlacement(baseState({ phase: 'roll' }), MY_ID, 'road')).toEqual({
      pickMode: 'none',
      legalTargets: null,
      prompt: null,
    });
  });

  it("is inactive when it isn't my turn", () => {
    const view = deriveBuildPlacement(
      baseState({ currentPlayerId: OPPONENT_ID }),
      MY_ID,
      'settlement',
    );
    expect(view.pickMode).toBe('none');
    expect(view.prompt).toBeNull();
  });

  it('is inactive when no build submode is armed', () => {
    expect(deriveBuildPlacement(baseState({}), MY_ID, 'none')).toEqual({
      pickMode: 'none',
      legalTargets: null,
      prompt: null,
    });
  });

  it('arms vertex picking for the settlement submode', () => {
    const view = deriveBuildPlacement(baseState({}), MY_ID, 'settlement');
    expect(view.pickMode).toBe('vertex');
    expect(view.prompt).toBe('buildSettlement');
    expect(view.legalTargets?.kind).toBe('vertex');
  });

  it('arms edge picking for the road submode', () => {
    const view = deriveBuildPlacement(baseState({}), MY_ID, 'road');
    expect(view.pickMode).toBe('edge');
    expect(view.prompt).toBe('buildRoad');
    expect(view.legalTargets?.kind).toBe('edge');
    expect(view.legalTargets?.ids).toContain(
      topology.edges.find((e) => e.vertexIds.includes(V0.id) && e.id !== E0.id)!.id,
    );
  });

  it('arms vertex picking over own settlements for the city submode', () => {
    const view = deriveBuildPlacement(baseState({}), MY_ID, 'city');
    expect(view.pickMode).toBe('vertex');
    expect(view.prompt).toBe('buildCity');
    expect(view.legalTargets?.ids).toEqual([V0.id]);
  });
});

describe('resolveBuildPick', () => {
  const vertexPick: Pick = { kind: 'vertex', id: V0.id };
  const edgePick: Pick = { kind: 'edge', id: E0.id };

  it('maps a vertex pick in settlement mode to a buildSettlement intent', () => {
    expect(resolveBuildPick('settlement', vertexPick, MY_ID)).toEqual({
      type: 'intent.buildSettlement',
      playerId: MY_ID,
      vertexId: V0.id,
    });
  });

  it('maps a vertex pick in city mode to a buildCity intent', () => {
    expect(resolveBuildPick('city', vertexPick, MY_ID)).toEqual({
      type: 'intent.buildCity',
      playerId: MY_ID,
      vertexId: V0.id,
    });
  });

  it('maps an edge pick in road mode to a buildRoad intent', () => {
    expect(resolveBuildPick('road', edgePick, MY_ID)).toEqual({
      type: 'intent.buildRoad',
      playerId: MY_ID,
      edgeId: E0.id,
    });
  });

  it('is null when the pick kind does not match the armed submode', () => {
    expect(resolveBuildPick('road', vertexPick, MY_ID)).toBeNull();
    expect(resolveBuildPick('settlement', edgePick, MY_ID)).toBeNull();
    expect(resolveBuildPick('none', vertexPick, MY_ID)).toBeNull();
  });

  it('is ADVISORY — resolves a pick even when it is NOT in the legal set', () => {
    // A vertex with an occupied/illegal target still resolves to an intent; the
    // SERVER rejects it (never the client). Here V0 is occupied, yet a
    // settlement pick on it still produces an intent to dispatch.
    expect(resolveBuildPick('settlement', vertexPick, MY_ID)).not.toBeNull();
  });
});
