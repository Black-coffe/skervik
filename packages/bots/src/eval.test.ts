// S2.4.2 — unit tests for the shared evaluation module (`eval/`): the pip table
// and that a high-pip, diverse vertex out-scores a low-pip one. These prove the
// scorer the v1 brain and the M4 advisor both consume, independent of any match.
import { buildTopology, type GameState, type TileId, type TileKind } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { evaluateVertex, FEATURE_WEIGHTS } from './eval/evaluate.js';
import { pipWeight, vertexProductionValue } from './eval/features.js';

/** Classic radius-2 topology, built locally — this file's fixtures are deliberately
 *  Classic-only (S2.1.7b Non-goals), independent of the per-match `topologyOf`
 *  seam the production code now resolves from `state.profileId`. */
const TOPO = buildTopology();

/** A minimal `main`-phase state carrying a hand-crafted board (no ports → no port skew). */
function stateWithBoard(
  tileKinds: Record<TileId, TileKind>,
  tileTokens: Record<TileId, number>,
): GameState {
  return {
    matchId: 'eval-test',
    phase: 'main',
    turn: 1,
    currentPlayerId: 'a',
    players: [{ id: 'a', name: 'A', victoryPoints: 0, resources: {} }],
    eventIndex: 0,
    seedHash: 'eval-hash',
    board: {
      tileKinds,
      tileTokens,
      portContents: [],
      robberTileId: TOPO.tiles[0]?.id ?? 't',
    },
  };
}

describe('pipWeight — the 2d6 frequency table', () => {
  it('scores tokens by their number of ways to roll (6−|7−token|)', () => {
    expect(pipWeight(6)).toBe(5);
    expect(pipWeight(8)).toBe(5);
    expect(pipWeight(5)).toBe(4);
    expect(pipWeight(9)).toBe(4);
    expect(pipWeight(4)).toBe(3);
    expect(pipWeight(10)).toBe(3);
    expect(pipWeight(3)).toBe(2);
    expect(pipWeight(11)).toBe(2);
    expect(pipWeight(2)).toBe(1);
    expect(pipWeight(12)).toBe(1);
  });

  it('a desert (no token) produces nothing', () => {
    expect(pipWeight(undefined)).toBe(0);
  });

  it('the academic 7 is the peak of the distribution (never on a real tile)', () => {
    expect(pipWeight(7)).toBe(6);
  });
});

describe('evaluateVertex — a rich, diverse spot out-scores a poor one', () => {
  it('a 3-tile 6/8/5 diverse vertex beats a single-2-token vertex', () => {
    const rich = TOPO.vertices.find((v) => v.adjacentTileIds.length === 3);
    expect(rich).toBeDefined();
    const richTiles = rich?.adjacentTileIds ?? [];
    const poor = TOPO.vertices.find(
      (v) =>
        v.adjacentTileIds.length >= 1 &&
        v.adjacentTileIds.every((t) => !richTiles.includes(t)),
    );
    expect(poor).toBeDefined();
    const poorTiles = poor?.adjacentTileIds ?? [];

    // Whole board desert; tokens only on the two spots we compare.
    const tileKinds: Record<TileId, TileKind> = {};
    for (const tile of TOPO.tiles) tileKinds[tile.id] = 'desert';
    const tileTokens: Record<TileId, number> = {};

    const diverse: TileKind[] = ['timber', 'clay', 'fleece'];
    richTiles.forEach((t, i) => {
      tileKinds[t] = diverse[i] ?? 'timber';
    });
    const richTokens = [6, 8, 5];
    richTiles.forEach((t, i) => {
      tileTokens[t] = richTokens[i] ?? 6;
    });
    const firstPoor = poorTiles[0];
    if (firstPoor !== undefined) {
      tileKinds[firstPoor] = 'timber';
      tileTokens[firstPoor] = 2;
    }

    const state = stateWithBoard(tileKinds, tileTokens);
    const weights = FEATURE_WEIGHTS.hard;

    // Raw production: 6/8/5 → 5+5+4 = 14; single 2 → 1.
    expect(vertexProductionValue(state, rich?.id ?? '')).toBe(14);
    expect(vertexProductionValue(state, poor?.id ?? '')).toBe(1);

    const richScore = evaluateVertex(state, 'a', rich?.id ?? '', weights).score;
    const poorScore = evaluateVertex(state, 'a', poor?.id ?? '', weights).score;
    expect(richScore).toBeGreaterThan(poorScore);
  });

  it('returns a features breakdown (the advisor consumes it)', () => {
    const tileKinds: Record<TileId, TileKind> = {};
    for (const tile of TOPO.tiles) tileKinds[tile.id] = 'desert';
    const state = stateWithBoard(tileKinds, {});
    const anyVertex = TOPO.vertices[0]?.id ?? '';
    const evaluation = evaluateVertex(state, 'a', anyVertex, FEATURE_WEIGHTS.hard);
    expect(evaluation).toHaveProperty('score');
    expect(evaluation.features).toHaveProperty('production');
    expect(evaluation.features).toHaveProperty('diversity');
    expect(evaluation.features).toHaveProperty('port');
  });
});
