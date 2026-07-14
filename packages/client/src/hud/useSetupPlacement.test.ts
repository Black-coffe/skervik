import type { GameState } from '@skervik/core';
import { buildTopology } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { deriveSetupPlacement, resolveSetupPick } from './useSetupPlacement.js';

const topology = buildTopology();
const MY_ID = 'player-1';
const OPPONENT_ID = 'player-2';

function baseState(overrides: Partial<GameState>): GameState {
  return {
    matchId: 'test-match',
    phase: 'setup',
    turn: 1,
    currentPlayerId: MY_ID,
    players: [],
    eventIndex: 0,
    seedHash: 'test-seed-hash',
    ...overrides,
  };
}

describe('deriveSetupPlacement', () => {
  it('is fully inactive outside the setup phase', () => {
    const state = baseState({ phase: 'main' });
    expect(deriveSetupPlacement(state, MY_ID)).toEqual({
      pickMode: 'none',
      legalTargets: null,
      prompt: null,
    });
  });

  it("shows an 'opponentTurn' prompt with no picking when it isn't my turn", () => {
    const state = baseState({ currentPlayerId: OPPONENT_ID });
    const view = deriveSetupPlacement(state, MY_ID);
    expect(view.pickMode).toBe('none');
    expect(view.legalTargets).toBeNull();
    expect(view.prompt).toBe('opponentTurn');
  });

  it('expects a settlement (pickMode vertex) when no road is pending, on my turn', () => {
    const state = baseState({});
    const view = deriveSetupPlacement(state, MY_ID);
    expect(view.pickMode).toBe('vertex');
    expect(view.prompt).toBe('placeSettlement');
    expect(view.legalTargets?.kind).toBe('vertex');
    expect(view.legalTargets?.ids.length).toBe(topology.vertices.length);
  });

  it('expects a road (pickMode edge) incident to the pending vertex, on my turn', () => {
    const vertex = topology.vertices[0];
    expect(vertex).toBeDefined();
    if (!vertex) throw new Error('expected a vertex');

    const state = baseState({
      pendingRoadVertexId: vertex.id,
      buildings: { settlements: { [vertex.id]: MY_ID }, roads: {} },
    });
    const view = deriveSetupPlacement(state, MY_ID);
    expect(view.pickMode).toBe('edge');
    expect(view.prompt).toBe('placeRoad');
    expect(view.legalTargets?.kind).toBe('edge');
    expect([...(view.legalTargets?.ids ?? [])].sort()).toEqual(
      [...vertex.edgeIds].sort(),
    );
  });
});

describe('resolveSetupPick', () => {
  it('resolves a vertex pick into a placeSettlement intent when pickMode is vertex', () => {
    const view = { pickMode: 'vertex' as const, legalTargets: null, prompt: null };
    const intent = resolveSetupPick(view, { kind: 'vertex', id: 'v-1' }, MY_ID);
    expect(intent).toEqual({
      type: 'intent.placeSettlement',
      playerId: MY_ID,
      vertexId: 'v-1',
    });
  });

  it('resolves an edge pick into a placeRoad intent when pickMode is edge', () => {
    const view = { pickMode: 'edge' as const, legalTargets: null, prompt: null };
    const intent = resolveSetupPick(view, { kind: 'edge', id: 'e-1' }, MY_ID);
    expect(intent).toEqual({ type: 'intent.placeRoad', playerId: MY_ID, edgeId: 'e-1' });
  });

  it('never dispatches an intent whose kind mismatches the expected pickMode', () => {
    const view = { pickMode: 'vertex' as const, legalTargets: null, prompt: null };
    expect(resolveSetupPick(view, { kind: 'edge', id: 'e-1' }, MY_ID)).toBeNull();
  });

  it('resolves an off-hint pick too — advisory only, never blocked by legalTargets', () => {
    const view = {
      pickMode: 'vertex' as const,
      legalTargets: { kind: 'vertex' as const, ids: ['v-legal'] },
      prompt: null,
    };
    // 'v-off-hint' is NOT in legalTargets.ids — still resolves, left for the
    // server to reject (the story's Constraints: no client-side hard gate).
    const intent = resolveSetupPick(view, { kind: 'vertex', id: 'v-off-hint' }, MY_ID);
    expect(intent).toEqual({
      type: 'intent.placeSettlement',
      playerId: MY_ID,
      vertexId: 'v-off-hint',
    });
  });
});
