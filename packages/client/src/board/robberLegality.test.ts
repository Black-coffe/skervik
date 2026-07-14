import type { BuildingsState, GameState, PlayerState } from '@skervik/core';
import { buildTopology } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { legalRobberTiles, stealVictims } from './robberLegality.js';

const topology = buildTopology();
const ME = 'player-1';
const FOE_A = 'player-2';
const FOE_B = 'player-3';

const TILE = topology.tiles[0]!;
const TILE_VERTICES = TILE.vertexIds;

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
    currentPlayerId: ME,
    players: [],
    eventIndex: 0,
    seedHash: 'test-seed-hash',
    ...overrides,
  };
}

describe('legalRobberTiles', () => {
  it('excludes exactly the current robber tile', () => {
    const state = baseState({
      board: { tileKinds: {}, tileTokens: {}, portContents: [], robberTileId: TILE.id },
    });
    const legal = legalRobberTiles(state, topology);
    expect(legal).not.toContain(TILE.id);
    expect(legal).toHaveLength(topology.tiles.length - 1);
  });

  it('with no board state (robberTileId undefined), every tile is legal', () => {
    const state = baseState({});
    expect(legalRobberTiles(state, topology)).toHaveLength(topology.tiles.length);
  });
});

describe('stealVictims', () => {
  it('returns [] for a tile with no buildings at all', () => {
    const state = baseState({ buildings: { settlements: {}, roads: {} }, players: [] });
    expect(stealVictims(state, topology, TILE.id, ME)).toEqual([]);
  });

  it('returns [] when the tile has only my own building', () => {
    const buildings: BuildingsState = {
      settlements: { [TILE_VERTICES[0]!]: ME },
      roads: {},
    };
    const state = baseState({ buildings, players: [player(ME, { timber: 3 })] });
    expect(stealVictims(state, topology, TILE.id, ME)).toEqual([]);
  });

  it('excludes an owner with 0 cards (card-less owners are not eligible victims)', () => {
    const buildings: BuildingsState = {
      settlements: { [TILE_VERTICES[0]!]: FOE_A },
      roads: {},
    };
    const state = baseState({
      buildings,
      players: [player(ME), player(FOE_A, { timber: 0 })],
    });
    expect(stealVictims(state, topology, TILE.id, ME)).toEqual([]);
  });

  it('returns the single eligible victim (settlement owner, ≥1 card)', () => {
    const buildings: BuildingsState = {
      settlements: { [TILE_VERTICES[0]!]: FOE_A },
      roads: {},
    };
    const state = baseState({
      buildings,
      players: [player(ME), player(FOE_A, { timber: 2 })],
    });
    expect(stealVictims(state, topology, TILE.id, ME)).toEqual([FOE_A]);
  });

  it('a CITY owner counts as an eligible victim too', () => {
    const buildings: BuildingsState = {
      settlements: {},
      roads: {},
      cities: { [TILE_VERTICES[0]!]: FOE_A },
    };
    const state = baseState({
      buildings,
      players: [player(ME), player(FOE_A, { clay: 1 })],
    });
    expect(stealVictims(state, topology, TILE.id, ME)).toEqual([FOE_A]);
  });

  it('returns multiple victims in stable seat order', () => {
    const buildings: BuildingsState = {
      settlements: {
        [TILE_VERTICES[0]!]: FOE_A,
        [TILE_VERTICES[1]!]: FOE_B,
      },
      roads: {},
    };
    const state = baseState({
      buildings,
      playerOrder: [ME, FOE_A, FOE_B],
      players: [player(ME), player(FOE_A, { iron: 1 }), player(FOE_B, { barley: 2 })],
    });
    expect(stealVictims(state, topology, TILE.id, ME)).toEqual([FOE_A, FOE_B]);
  });

  it('the mover is never a victim, even when they own a building on the tile', () => {
    const buildings: BuildingsState = {
      settlements: {
        [TILE_VERTICES[0]!]: ME,
        [TILE_VERTICES[1]!]: FOE_A,
      },
      roads: {},
    };
    const state = baseState({
      buildings,
      players: [player(ME, { timber: 5 }), player(FOE_A, { clay: 1 })],
    });
    const victims = stealVictims(state, topology, TILE.id, ME);
    expect(victims).not.toContain(ME);
    expect(victims).toEqual([FOE_A]);
  });

  it('returns [] for an unknown tile id', () => {
    const state = baseState({ buildings: { settlements: {}, roads: {} }, players: [] });
    expect(stealVictims(state, topology, 'not-a-real-tile', ME)).toEqual([]);
  });
});
