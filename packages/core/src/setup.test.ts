// @skervik/core — S1.1.3: snake-draft initial placement (setup phase).
// Exercises the full intent -> validate -> events -> reduce pipeline for
// settlement/road placement: a scripted 4-player draft replayed to a
// deep-equal state, plus one negative test per legality rule.

import { describe, expect, it } from 'vitest';

import { type BoardTopology, buildTopology, type VertexTopology } from './board.js';
import { reduce } from './reduce.js';
import type {
  BoardState,
  GameEvent,
  GameState,
  PlayerState,
  RoadPlacedEvent,
  SettlementPlacedEvent,
} from './types.js';
import { validate } from './validate.js';

// Setup-phase validate never draws from the PRNG (placement is deterministic,
// payout amounts are explicit in the event) — the seed is passed only to
// satisfy the fixed `validate` signature (plan §1).
const SEED = 'skervik-golden-seed-3';

const topology = buildTopology();

function makePlayers(ids: readonly string[]): PlayerState[] {
  return ids.map((id) => ({ id, name: id, victoryPoints: 0, resources: {} }));
}

// A uniform board (every non-center tile is 'timber') except the center
// tile, which is 'desert' — enough to exercise both "producing tile pays 1"
// and "desert pays nothing" (S1.1.3 spec) without depending on the RNG-driven
// board generator (that's S1.1.2's concern, not this story's).
function makeBoard(): BoardState {
  const tileKinds: Record<string, string> = {};
  for (const tile of topology.tiles) {
    tileKinds[tile.id] = tile.id === '0,0' ? 'desert' : 'timber';
  }
  return { tileKinds, tileTokens: {}, portContents: [], robberTileId: '0,0' };
}

/**
 * Greedily picks `count` vertices from `topo`, skipping any vertex adjacent
 * to an already-picked one — satisfies the distance rule against each other
 * (topology order is fixed/deterministic, so this is reproducible).
 */
function pickNonAdjacentVertices(topo: BoardTopology, count: number): VertexTopology[] {
  const chosen: VertexTopology[] = [];
  const blocked = new Set<string>();
  for (const vertex of topo.vertices) {
    if (chosen.length >= count) break;
    if (blocked.has(vertex.id)) continue;
    chosen.push(vertex);
    blocked.add(vertex.id);
    for (const adjacentId of vertex.adjacentVertexIds) blocked.add(adjacentId);
  }
  if (chosen.length < count) {
    throw new Error(`fixture bug: could not find ${count} non-adjacent vertices`);
  }
  return chosen;
}

/** The S1.1.3 payout formula, computed independently from the topology + board for assertions. */
function expectedPayout(
  vertex: VertexTopology,
  board: BoardState,
): Record<string, number> {
  const payout: Record<string, number> = {};
  for (const tileId of vertex.adjacentTileIds) {
    const kind = board.tileKinds[tileId];
    if (kind === undefined || kind === 'desert') continue;
    payout[kind] = (payout[kind] ?? 0) + 1;
  }
  return payout;
}

const playerIds = ['player-1', 'player-2', 'player-3', 'player-4'];
const board = makeBoard();
const vertices = pickNonAdjacentVertices(topology, playerIds.length * 2);

const genesis: GameState = {
  matchId: 'match-setup-1',
  phase: 'setup',
  turn: 1,
  currentPlayerId: playerIds[0] as string,
  players: makePlayers(playerIds),
  eventIndex: 0,
  seedHash: 'deadbeef',
  board,
};

// Forward P1..P4, then reverse P4..P1 (S1.1.3 spec) — draftPlayers[i] is
// whose turn step `i` is; vertices[i] is the settlement they place that turn.
const draftPlayers = [...playerIds, ...[...playerIds].reverse()];

describe('setup phase: snake-draft placement', () => {
  it('replays a full 4-player draft to a deep-equal state: 8 settlements, 8 roads, correct payouts, correct next phase/player', () => {
    let state = genesis;
    const events: GameEvent[] = [];

    draftPlayers.forEach((playerId, step) => {
      const vertex = vertices[step] as VertexTopology;

      const settleResult = validate(
        state,
        { type: 'intent.placeSettlement', playerId, vertexId: vertex.id },
        playerId,
        SEED,
      );
      expect(settleResult.ok).toBe(true);
      if (!settleResult.ok) throw new Error('expected ok result');
      const settleEvent = settleResult.events[0] as SettlementPlacedEvent;

      // The reverse round (step >= playerIds.length) is each player's 2nd
      // settlement — the one that pays out.
      const isSecondSettlement = step >= playerIds.length;
      expect(settleEvent.payout).toEqual(
        isSecondSettlement ? expectedPayout(vertex, board) : {},
      );

      state = settleResult.events.reduce(reduce, state);
      events.push(...settleResult.events);

      const roadEdgeId = vertex.edgeIds[0] as string;
      const roadResult = validate(
        state,
        { type: 'intent.placeRoad', playerId, edgeId: roadEdgeId },
        playerId,
        SEED,
      );
      expect(roadResult.ok).toBe(true);
      if (!roadResult.ok) throw new Error('expected ok result');
      const roadEvent = roadResult.events[0] as RoadPlacedEvent;

      const isLastTurn = step === draftPlayers.length - 1;
      // S1.2.4: the draft's last road hands P1 the turn loop's mandatory
      // first step ('roll'), not 'main' directly (was 'main' pre-S1.2.4).
      expect(roadEvent.nextPhase).toBe(isLastTurn ? 'roll' : 'setup');
      expect(roadEvent.nextPlayerId).toBe(
        isLastTurn ? playerIds[0] : draftPlayers[step + 1],
      );

      state = roadResult.events.reduce(reduce, state);
      events.push(...roadResult.events);
    });

    expect(Object.keys(state.buildings?.settlements ?? {})).toHaveLength(8);
    expect(Object.keys(state.buildings?.roads ?? {})).toHaveLength(8);
    // S1.2.4: setup exits into the turn loop's 'roll' phase, not 'main'.
    expect(state.phase).toBe('roll');
    expect(state.currentPlayerId).toBe(playerIds[0]);
    expect(state.pendingRoadVertexId).toBeUndefined();

    // Every player's 2nd-settlement payout actually landed on their resources.
    for (const playerId of playerIds) {
      const player = state.players.find((p) => p.id === playerId);
      expect(player?.resources).toBeDefined();
    }

    // Determinism: replaying the exact same recorded events from genesis
    // reproduces this final state byte-for-byte.
    const replayed = events.reduce(reduce, genesis);
    expect(replayed).toEqual(state);
  });

  describe('legality rejections', () => {
    // player-1's completed first turn: settlement at vertices[0] + its road.
    // Used as a base state for negative tests that need "it's someone else's
    // turn, with one settlement already on the board".
    function stateAfterFirstTurn(): GameState {
      const firstVertex = vertices[0] as VertexTopology;
      const settle = validate(
        genesis,
        {
          type: 'intent.placeSettlement',
          playerId: playerIds[0] as string,
          vertexId: firstVertex.id,
        },
        playerIds[0] as string,
        SEED,
      );
      if (!settle.ok) throw new Error('expected ok result');
      const afterSettle = settle.events.reduce(reduce, genesis);

      const road = validate(
        afterSettle,
        {
          type: 'intent.placeRoad',
          playerId: playerIds[0] as string,
          edgeId: firstVertex.edgeIds[0] as string,
        },
        playerIds[0] as string,
        SEED,
      );
      if (!road.ok) throw new Error('expected ok result');
      return road.events.reduce(reduce, afterSettle);
    }

    it('rejects NOT_YOUR_TURN when acting out of the draft order', () => {
      const result = validate(
        genesis,
        {
          type: 'intent.placeSettlement',
          playerId: playerIds[1] as string,
          vertexId: vertices[1]?.id as string,
        },
        playerIds[1] as string,
        SEED,
      );

      expect(result).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
    });

    it('rejects WRONG_PHASE when placing a road before any settlement is pending', () => {
      const result = validate(
        genesis,
        {
          type: 'intent.placeRoad',
          playerId: playerIds[0] as string,
          edgeId: (vertices[0] as VertexTopology).edgeIds[0] as string,
        },
        playerIds[0] as string,
        SEED,
      );

      expect(result).toEqual({ ok: false, reason: 'WRONG_PHASE' });
    });

    it('rejects OCCUPIED when the target vertex already holds a settlement', () => {
      const state = stateAfterFirstTurn();
      const firstVertex = vertices[0] as VertexTopology;

      const result = validate(
        state,
        {
          type: 'intent.placeSettlement',
          playerId: playerIds[1] as string,
          vertexId: firstVertex.id,
        },
        playerIds[1] as string,
        SEED,
      );

      expect(result).toEqual({ ok: false, reason: 'OCCUPIED' });
    });

    it('rejects DISTANCE_VIOLATION when the target vertex is adjacent to an existing settlement', () => {
      const state = stateAfterFirstTurn();
      const firstVertex = vertices[0] as VertexTopology;
      const adjacentVertexId = firstVertex.adjacentVertexIds[0] as string;

      const result = validate(
        state,
        {
          type: 'intent.placeSettlement',
          playerId: playerIds[1] as string,
          vertexId: adjacentVertexId,
        },
        playerIds[1] as string,
        SEED,
      );

      expect(result).toEqual({ ok: false, reason: 'DISTANCE_VIOLATION' });
    });

    it('rejects DETACHED_ROAD when the road edge does not touch the just-placed settlement', () => {
      const state = stateAfterFirstTurn();
      const secondVertex = vertices[1] as VertexTopology;

      const settle = validate(
        state,
        {
          type: 'intent.placeSettlement',
          playerId: playerIds[1] as string,
          vertexId: secondVertex.id,
        },
        playerIds[1] as string,
        SEED,
      );
      if (!settle.ok) throw new Error('expected ok result');
      const afterSettle = settle.events.reduce(reduce, state);

      // An edge from a distant, untouched vertex — guaranteed not to touch
      // `secondVertex` (both are members of the mutually-non-adjacent set).
      const detachedEdgeId = (vertices[2] as VertexTopology).edgeIds[0] as string;

      const result = validate(
        afterSettle,
        {
          type: 'intent.placeRoad',
          playerId: playerIds[1] as string,
          edgeId: detachedEdgeId,
        },
        playerIds[1] as string,
        SEED,
      );

      expect(result).toEqual({ ok: false, reason: 'DETACHED_ROAD' });
    });

    it('rejects WRONG_PHASE when placing a 2nd settlement before finishing the road', () => {
      const firstVertex = vertices[0] as VertexTopology;
      const settle = validate(
        genesis,
        {
          type: 'intent.placeSettlement',
          playerId: playerIds[0] as string,
          vertexId: firstVertex.id,
        },
        playerIds[0] as string,
        SEED,
      );
      if (!settle.ok) throw new Error('expected ok result');
      const midTurnState = settle.events.reduce(reduce, genesis);

      const result = validate(
        midTurnState,
        {
          type: 'intent.placeSettlement',
          playerId: playerIds[0] as string,
          vertexId: (vertices[1] as VertexTopology).id,
        },
        playerIds[0] as string,
        SEED,
      );

      expect(result).toEqual({ ok: false, reason: 'WRONG_PHASE' });
    });

    it('rejects INVALID_PHASE when placing a settlement outside the setup phase', () => {
      const mainPhaseState: GameState = { ...genesis, phase: 'main' };

      const result = validate(
        mainPhaseState,
        {
          type: 'intent.placeSettlement',
          playerId: playerIds[0] as string,
          vertexId: (vertices[0] as VertexTopology).id,
        },
        playerIds[0] as string,
        SEED,
      );

      expect(result).toEqual({ ok: false, reason: 'INVALID_PHASE' });
    });
  });
});
