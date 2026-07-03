import { describe, expect, it } from 'vitest';

import { buildTopology } from './board.js';
import { BOARD_GEN_STREAM, CLASSIC_BOARD_PROFILE, generateBoard } from './boardgen.js';
import { reduce } from './reduce.js';
import type { GameEvent, GameState } from './types.js';

const SEED = 'skervik-golden-seed-1';
const topology = buildTopology();
const RED_TOKENS = [6, 8];

function tileAdjacencyMap(): Record<string, string[]> {
  const adjacency: Record<string, string[]> = {};
  for (const tile of topology.tiles) adjacency[tile.id] = [];
  for (const edge of topology.edges) {
    const incident = topology.tiles.filter((tile) => tile.edgeIds.includes(edge.id));
    if (incident.length !== 2) continue;
    const [a, b] = incident as [
      (typeof topology.tiles)[number],
      (typeof topology.tiles)[number],
    ];
    (adjacency[a.id] as string[]).push(b.id);
    (adjacency[b.id] as string[]).push(a.id);
  }
  return adjacency;
}

function assertNoAdjacentRedTokens(layout: ReturnType<typeof generateBoard>): void {
  const adjacency = tileAdjacencyMap();
  for (const [tileId, token] of Object.entries(layout.tileTokens)) {
    if (!RED_TOKENS.includes(token)) continue;
    for (const neighborId of adjacency[tileId] ?? []) {
      const neighborToken = layout.tileTokens[neighborId];
      if (neighborToken !== undefined) {
        expect(RED_TOKENS.includes(neighborToken)).toBe(false);
      }
    }
  }
}

describe('generateBoard', () => {
  it('produces a valid Classic layout: 19 tile kinds, 18 tokens, 9 ports, robber on the desert', () => {
    const layout = generateBoard(SEED, topology);

    expect(Object.keys(layout.tileKinds)).toHaveLength(19);
    expect(Object.keys(layout.tileTokens)).toHaveLength(18);
    expect(layout.portContents).toHaveLength(9);

    const kindCounts = Object.values(layout.tileKinds).reduce<Record<string, number>>(
      (counts, kind) => {
        counts[kind] = (counts[kind] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(kindCounts).toEqual({
      timber: 4,
      clay: 3,
      fleece: 4,
      barley: 4,
      iron: 3,
      desert: 1,
    });

    expect(layout.tileKinds[layout.robberTileId]).toBe('desert');
    expect(layout.tileTokens[layout.robberTileId]).toBeUndefined();

    const tokenCounts = [...Object.values(layout.tileTokens)].sort((a, b) => a - b);
    expect(tokenCounts).toEqual([...CLASSIC_BOARD_PROFILE.tokens].sort((a, b) => a - b));
  });

  it('satisfies the red-token (no adjacent 6/8) constraint for the golden seed within the retry bound', () => {
    const layout = generateBoard(SEED, topology);

    expect(layout.redConstraintSatisfied).toBe(true);
    expect(layout.attemptsUsed).toBeLessThanOrEqual(BOARD_GEN_STREAM.TOKEN_RETRY_BOUND);
    assertNoAdjacentRedTokens(layout);
  });

  it('satisfies the red-token constraint across 50 derived seeds (property test)', () => {
    for (let i = 0; i < 50; i++) {
      const layout = generateBoard(`seed-${i}`, topology);

      expect(layout.redConstraintSatisfied).toBe(true);
      assertNoAdjacentRedTokens(layout);
    }
  });

  it('is deterministic: same seed -> byte-identical layout, called twice', () => {
    const first = generateBoard(SEED, topology);
    const second = generateBoard(SEED, topology);

    expect(second).toEqual(first);
  });

  it('is deterministic through the event-sourced setup: applying board.generated via reduce reproduces the same layout', () => {
    const layout = generateBoard(SEED, topology);
    const state: GameState = {
      matchId: 'match-1',
      phase: 'setup',
      turn: 1,
      currentPlayerId: 'player-1',
      players: [],
      eventIndex: 1,
      seedHash: 'deadbeef',
    };
    const event: GameEvent = {
      type: 'board.generated',
      index: state.eventIndex,
      tileKinds: layout.tileKinds,
      tileTokens: layout.tileTokens,
      portContents: layout.portContents,
      robberTileId: layout.robberTileId,
    };

    const next = reduce(state, event);
    const again = reduce(state, event);

    expect(next.board).toEqual({
      tileKinds: layout.tileKinds,
      tileTokens: layout.tileTokens,
      portContents: layout.portContents,
      robberTileId: layout.robberTileId,
    });
    expect(next).toEqual(again);
    expect(next.eventIndex).toBe(state.eventIndex + 1);
  });

  it('different seeds produce different layouts', () => {
    const a = generateBoard(SEED, topology);
    const b = generateBoard('skervik-golden-seed-2', topology);

    expect(a).not.toEqual(b);
  });

  it('golden: matches a fixed layout for the golden seed (regression guard, docs/wiki/rng-stream-map.md)', () => {
    const layout = generateBoard(SEED, topology);

    // Hard-coded so a change to the algorithm or the reserved stream-index
    // map is caught as a regression, not silently shipped (same convention
    // as rng.test.ts's deriveValue/rollDie/shuffle golden assertions).
    expect(layout.tileKinds['0,0']).toBe('timber');
    // Golden seed needed 4 token-shuffle attempts (0.., stream indices
    // TOKEN_SHUFFLE_BASE .. TOKEN_SHUFFLE_BASE + 3*TOKEN_SHUFFLE_STRIDE) to
    // satisfy the red-token constraint — well within TOKEN_RETRY_BOUND (64).
    expect(layout.attemptsUsed).toBe(4);
    expect(layout.redConstraintSatisfied).toBe(true);
    expect(layout.robberTileId).toBe('-1,-1');
    expect(layout.tileTokens['-2,2']).toBe(6);
    expect(layout.portContents[0]).toEqual({
      kind: 'resource',
      rate: 2,
      resource: 'fleece',
    });
  });
});
