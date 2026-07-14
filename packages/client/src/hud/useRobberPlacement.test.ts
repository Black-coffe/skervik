import type { BuildingsState, GameState, PlayerState } from '@skervik/core';
import { buildTopology } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import {
  deriveRobberPlacement,
  resolveRobberTilePick,
  resolveVictimPick,
} from './useRobberPlacement.js';

const topology = buildTopology();
const MY_ID = 'player-1';
const OPPONENT_ID = 'player-2';

const TILE = topology.tiles[0]!;
const OTHER_TILE = topology.tiles.find((t) => t.id !== TILE.id)!;

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
    phase: 'robber',
    turn: 3,
    currentPlayerId: MY_ID,
    players: [],
    eventIndex: 0,
    seedHash: 'test-seed-hash',
    board: { tileKinds: {}, tileTokens: {}, portContents: [], robberTileId: TILE.id },
    ...overrides,
  };
}

describe('deriveRobberPlacement', () => {
  it('is inactive outside the robber phase', () => {
    expect(deriveRobberPlacement(baseState({ phase: 'main' }), MY_ID, null)).toEqual({
      pickMode: 'none',
      legalTargets: null,
      prompt: null,
      victims: [],
    });
  });

  it("is inactive when it isn't my turn", () => {
    const view = deriveRobberPlacement(
      baseState({ currentPlayerId: OPPONENT_ID }),
      MY_ID,
      null,
    );
    expect(view.pickMode).toBe('none');
    expect(view.prompt).toBeNull();
  });

  it('is inactive while a discard is still outstanding (S2.8.4b territory)', () => {
    const view = deriveRobberPlacement(
      baseState({ playersToDiscard: [OPPONENT_ID] }),
      MY_ID,
      null,
    );
    expect(view.pickMode).toBe('none');
    expect(view.prompt).toBeNull();
  });

  it('is active with an empty playersToDiscard array (nobody actually owes)', () => {
    const view = deriveRobberPlacement(baseState({ playersToDiscard: [] }), MY_ID, null);
    expect(view.pickMode).toBe('tile');
    expect(view.prompt).toBe('moveRobber');
  });

  it('arms tile picking (prompt moveRobber) when no tile is pending', () => {
    const view = deriveRobberPlacement(baseState({}), MY_ID, null);
    expect(view.pickMode).toBe('tile');
    expect(view.prompt).toBe('moveRobber');
    expect(view.legalTargets).toBeNull();
    expect(view.victims).toEqual([]);
  });

  it('pauses board picking and shows the victim list when a tile is pending', () => {
    const buildings: BuildingsState = {
      settlements: { [OTHER_TILE.vertexIds[0]!]: OPPONENT_ID },
      roads: {},
    };
    const state = baseState({
      buildings,
      players: [player(MY_ID), player(OPPONENT_ID, { timber: 1 })],
    });
    const view = deriveRobberPlacement(state, MY_ID, OTHER_TILE.id);
    expect(view.pickMode).toBe('none');
    expect(view.prompt).toBe('chooseVictim');
    expect(view.victims).toEqual([OPPONENT_ID]);
  });
});

describe('resolveRobberTilePick', () => {
  it('dispatches moveRobber{tileId} immediately when 0 victims are eligible', () => {
    const state = baseState({ buildings: { settlements: {}, roads: {} }, players: [] });
    const result = resolveRobberTilePick(state, topology, OTHER_TILE.id, MY_ID);
    expect(result).toEqual({
      dispatch: { type: 'intent.moveRobber', playerId: MY_ID, tileId: OTHER_TILE.id },
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
    const result = resolveRobberTilePick(state, topology, OTHER_TILE.id, MY_ID);
    expect(result).toEqual({ pendingTile: OTHER_TILE.id });
  });

  it('is ADVISORY — resolves the current robber tile too (server rejects ROBBER_SAME_TILE)', () => {
    const state = baseState({ buildings: { settlements: {}, roads: {} }, players: [] });
    const result = resolveRobberTilePick(state, topology, TILE.id, MY_ID);
    expect(result).toEqual({
      dispatch: { type: 'intent.moveRobber', playerId: MY_ID, tileId: TILE.id },
    });
  });
});

describe('resolveVictimPick', () => {
  it('builds the full moveRobber intent with tileId + victimId', () => {
    expect(resolveVictimPick(OTHER_TILE.id, OPPONENT_ID, MY_ID)).toEqual({
      type: 'intent.moveRobber',
      playerId: MY_ID,
      tileId: OTHER_TILE.id,
      victimId: OPPONENT_ID,
    });
  });
});
