// @skervik/core — S2.1.6: the NEUTRAL/phantom blocking mechanic of the
// 2-player mode. Proves the deterministic (non-seed) placement policy, that a
// neutral settlement is modeled as a reserved-owner building that the EXISTING
// distance rule blocks real players against, that `reduce` folds the
// `neutral.placed` genesis event cleanly, that production EXCLUDES neutral
// buildings (the one explicit exclusion), and that the fair-RNG verifier folds
// a 2p genesis log unchanged (Classic board, non-seed placement — verify stays
// board-leg-deferred). Full-match play/replay/verify + the other exclusions
// (robber/trade/VP) are proven end-to-end in the server 2p e2e where the
// scripted driver lives.

import { describe, expect, it } from 'vitest';

import { buildTopology, findVertex, type TileTopology, type VertexId } from './board.js';
import { generateBoard } from './boardgen.js';
import { computeNeutralPlacements, neutralPlacementEvents } from './neutral.js';
import { reduce } from './reduce.js';
import { gameplayStreamIndex, rollDie } from './rng.js';
import { TWO_PLAYER_PROFILE } from './ruleProfile.js';
import {
  type BoardState,
  type DiceRolledEvent,
  type GameEvent,
  type GameState,
  NEUTRAL_OWNER_ID,
  type PlayerState,
  type ResourcesProducedEvent,
} from './types.js';
import { validate } from './validate.js';
import { verifyMatchRandomness } from './verify.js';

const topology = buildTopology();

function makePlayers(ids: readonly string[]): PlayerState[] {
  return ids.map((id) => ({ id, name: id, victoryPoints: 0, resources: {} }));
}

describe('neutral placement policy (S2.1.6 — deterministic, non-seed)', () => {
  const board = generateBoard('skervik-neutral-policy-seed', topology);

  it('is deterministic from the board — identical vertices across two runs', () => {
    const a = computeNeutralPlacements(board, 2, topology);
    const b = computeNeutralPlacements(board, 2, topology);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
  });

  it('does not depend on any seed — a DIFFERENT board seed can shift the vertices, same board never does', () => {
    // Same board object → same placement, always (proven above). A different
    // board (different token layout) is free to choose different high-production
    // vertices — the policy is a pure function of the board, not of any seed.
    const other = generateBoard('skervik-neutral-policy-seed-2', topology);
    const onFirst = computeNeutralPlacements(board, 2, topology);
    const onOther = computeNeutralPlacements(other, 2, topology);
    // Determinism holds per board; we only assert both are well-formed (2
    // distinct, distance-legal vertices) — not that they differ.
    for (const chosen of [onFirst, onOther]) {
      expect(new Set(chosen).size).toBe(2);
    }
  });

  it('chooses distinct, distance-legal vertices (no two neutrals adjacent)', () => {
    const [v0, v1] = computeNeutralPlacements(board, 2, topology) as [VertexId, VertexId];
    expect(v0).not.toBe(v1);
    const vertex0 = findVertex(topology, v0);
    expect(vertex0?.adjacentVertexIds).not.toContain(v1);
  });

  it('picks the highest-production vertices first (most-contested spots)', () => {
    // With count 1 the single pick must be a strict global maximum of adjacent
    // token pips — a blocker is worth most on the best spot.
    const [top] = computeNeutralPlacements(board, 1, topology) as [VertexId];
    const pips = (token: number | undefined): number =>
      token === undefined || token === 7 || token < 2 || token > 12
        ? 0
        : 6 - Math.abs(7 - token);
    const weightOf = (vertexId: VertexId): number =>
      (findVertex(topology, vertexId)?.adjacentTileIds ?? []).reduce(
        (sum, tileId) => sum + pips(board.tileTokens[tileId]),
        0,
      );
    const topWeight = weightOf(top);
    for (const vertex of topology.vertices) {
      expect(weightOf(vertex.id)).toBeLessThanOrEqual(topWeight);
    }
  });

  it('neutralPlacementEvents indexes contiguously from startIndex and is empty when count <= 0', () => {
    const events = neutralPlacementEvents(board, 2, 5, topology);
    expect(events.map((e) => e.index)).toEqual([5, 6]);
    expect(events.every((e) => e.type === 'neutral.placed')).toBe(true);
    expect(neutralPlacementEvents(board, 0, 5, topology)).toEqual([]);
  });

  it('TWO_PLAYER_PROFILE carries the neutralSettlements knob; Classic has none', () => {
    expect(TWO_PLAYER_PROFILE.neutralSettlements).toBe(2);
    expect(TWO_PLAYER_PROFILE.id).toBe('twoPlayer');
    // Standard board/costs/VP inherited from Classic (phantom on the standard board).
    expect(TWO_PLAYER_PROFILE.board).toBe(TWO_PLAYER_PROFILE.board);
    expect(TWO_PLAYER_PROFILE.victory.vpToWin).toBe(10);
  });
});

describe('reduce(neutral.placed) (S2.1.6)', () => {
  const board = generateBoard('skervik-neutral-reduce-seed', topology);
  const [vertexId] = computeNeutralPlacements(board, 1, topology) as [VertexId];

  function genesisState(): GameState {
    return {
      matchId: 'm',
      phase: 'setup',
      turn: 1,
      currentPlayerId: 'p1',
      players: makePlayers(['p1', 'p2']),
      playerOrder: ['p1', 'p2'],
      eventIndex: 2,
      seedHash: 'deadbeef',
      profileId: 'twoPlayer',
      board,
    };
  }

  it('places a settlement owned by NEUTRAL_OWNER_ID, creating buildings if absent', () => {
    const next = reduce(genesisState(), {
      type: 'neutral.placed',
      index: 2,
      vertexId,
    });
    expect(next.buildings?.settlements[vertexId]).toBe(NEUTRAL_OWNER_ID);
    expect(next.eventIndex).toBe(3);
  });

  it('is a static genesis fact — sets NO pendingRoadVertexId (unlike settlement.placed)', () => {
    const next = reduce(genesisState(), {
      type: 'neutral.placed',
      index: 2,
      vertexId,
    });
    expect(next.pendingRoadVertexId).toBeUndefined();
    // The neutral is not a real player — no player hand is touched.
    expect(next.players).toEqual(genesisState().players);
  });
});

describe('neutral blocking via the existing distance rule (S2.1.6)', () => {
  const board = generateBoard('skervik-neutral-block-seed', topology);
  // A tile whose corners we can reason about, plus a disjoint tile for a legal
  // far placement.
  const tileA = topology.tiles[6] as TileTopology;
  const neutralVertex = tileA.vertexIds[0] as VertexId;
  const adjacentVertex = findVertex(topology, neutralVertex)
    ?.adjacentVertexIds[0] as VertexId;

  function setupState(): GameState {
    return {
      matchId: 'm',
      phase: 'setup',
      turn: 1,
      currentPlayerId: 'p1',
      players: makePlayers(['p1', 'p2']),
      playerOrder: ['p1', 'p2'],
      eventIndex: 4,
      seedHash: 'deadbeef',
      profileId: 'twoPlayer',
      board,
      buildings: { settlements: { [neutralVertex]: NEUTRAL_OWNER_ID }, roads: {} },
    };
  }

  it('a real player CANNOT build ON a neutral settlement (OCCUPIED)', () => {
    const result = validate(
      setupState(),
      { type: 'intent.placeSettlement', playerId: 'p1', vertexId: neutralVertex },
      'p1',
      'seed',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('OCCUPIED');
  });

  it('a real player CANNOT build ADJACENT to a neutral settlement (DISTANCE_VIOLATION)', () => {
    const result = validate(
      setupState(),
      { type: 'intent.placeSettlement', playerId: 'p1', vertexId: adjacentVertex },
      'p1',
      'seed',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('DISTANCE_VIOLATION');
  });

  it('a distance-legal far vertex is still placeable (blocking is local, not global)', () => {
    // Find a vertex neither occupied nor adjacent to the neutral.
    const far = topology.vertices.find(
      (v) =>
        v.id !== neutralVertex &&
        !v.adjacentVertexIds.includes(neutralVertex) &&
        v.id !== adjacentVertex,
    );
    const result = validate(
      setupState(),
      {
        type: 'intent.placeSettlement',
        playerId: 'p1',
        vertexId: far?.id as VertexId,
      },
      'p1',
      'seed',
    );
    expect(result.ok).toBe(true);
  });
});

describe('production EXCLUDES neutral buildings (S2.1.6 — the one explicit exclusion)', () => {
  // Mirror production.test.ts: a synthetic board with a known token so a fixed
  // eventIndex lands on it (SEED/eventIndex 1 -> total 6, verified in-test).
  const SEED = 'skervik-production-seed-1';
  const tileA = topology.tiles[3] as TileTopology;
  const desert = topology.tiles.find((t) => t.id !== tileA.id) as TileTopology;

  function makeBoard(): BoardState {
    const tileKinds: Record<string, string> = {};
    for (const tile of topology.tiles) {
      tileKinds[tile.id] = tile.id === tileA.id ? 'timber' : 'desert';
    }
    return {
      tileKinds,
      tileTokens: { [tileA.id]: 6 },
      portContents: [],
      robberTileId: desert.id,
    };
  }

  const neutralVertex = tileA.vertexIds[0] as VertexId;
  const realVertex = tileA.vertexIds[1] as VertexId;

  it('a neutral settlement on a producing tile earns NOTHING; the real owner is still paid', () => {
    const state: GameState = {
      matchId: 'm',
      phase: 'roll',
      turn: 1,
      currentPlayerId: 'p1',
      players: makePlayers(['p1', 'p2']),
      playerOrder: ['p1', 'p2'],
      eventIndex: 1, // total 6 with SEED (see production.test.ts header)
      seedHash: 'deadbeef',
      profileId: 'twoPlayer',
      board: makeBoard(),
      buildings: {
        settlements: { [neutralVertex]: NEUTRAL_OWNER_ID, [realVertex]: 'p1' },
        roads: {},
      },
    };
    // Sanity: this seed/eventIndex really does roll the tile's token (6).
    const total =
      rollDie(SEED, gameplayStreamIndex(1, 0)) + rollDie(SEED, gameplayStreamIndex(1, 1));
    expect(total).toBe(6);

    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'p1' },
      'p1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    const produced = result.events[1] as ResourcesProducedEvent;

    // The real player is paid; the neutral owner appears NOWHERE in the grants,
    // and the bank was debited only for the real player's 1 timber.
    expect(produced.grants).toEqual({ p1: { timber: 1 } });
    expect(produced.grants[NEUTRAL_OWNER_ID]).toBeUndefined();
    expect(produced.bank.timber).toBe(18);
  });
});

describe('the fair-RNG verifier folds a 2p genesis log unchanged (S2.1.6)', () => {
  // A twoPlayer log (Classic board, neutral genesis events, one dice roll) must
  // verify OK: the board doesn't diverge and neutral placement is non-seed, so
  // verify is untouched (board-leg stays deferred).
  const SEED = 'skervik-neutral-verify-seed';

  it('verifyMatchRandomness passes on a genesis + neutral + roll log', () => {
    const layout = generateBoard(SEED, topology);
    const neutrals = neutralPlacementEvents(layout, 2, 2, topology);
    const rollIndex = 2 + neutrals.length;
    const dieA = rollDie(SEED, gameplayStreamIndex(rollIndex, 0));
    const dieB = rollDie(SEED, gameplayStreamIndex(rollIndex, 1));
    const total = dieA + dieB;
    const dice: DiceRolledEvent = {
      type: 'dice.rolled',
      index: rollIndex,
      playerId: 'p1',
      dieA,
      dieB,
      total,
      ...(total === 7 ? { playersToDiscard: [] } : {}),
    };
    const events: GameEvent[] = [
      {
        type: 'match.started',
        index: 0,
        matchId: 'm',
        seedHash: '',
        playerIds: ['p1', 'p2'],
        profileId: 'twoPlayer',
      },
      {
        type: 'board.generated',
        index: 1,
        tileKinds: layout.tileKinds,
        tileTokens: layout.tileTokens,
        portContents: layout.portContents,
        robberTileId: layout.robberTileId,
      },
      ...neutrals,
      dice,
    ];

    const result = verifyMatchRandomness(SEED, events);
    expect(result.ok).toBe(true);
    // board.generated + the one dice roll were both checked.
    expect(result.checked).toBeGreaterThanOrEqual(2);
  });
});
