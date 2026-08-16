import { describe, expect, it } from 'vitest';

import { buildTopology } from './board.js';
import { BOARD_GEN_STREAM, CLASSIC_BOARD_PROFILE, generateBoard } from './boardgen.js';
import { reduce } from './reduce.js';
import { EXPANDED_BOARD } from './ruleProfile.js';
import type { GameEvent, GameState } from './types.js';

const SEED = 'skervik-golden-seed-1';
const topology = buildTopology();
const RED_TOKENS = [6, 8];

// `exp-0` is a seed whose expanded token shuffle satisfies the red-token
// constraint — needing 26 of the 64 available attempts
// (BOARD_GEN_STREAM.TOKEN_RETRY_BOUND), NOT "well within" the bound the
// comfortable way Classic's golden seed is (4 of 64, see the Classic golden
// test below): the S2.1.7a finding is that only ~25% of expanded-board seeds
// ever satisfy the constraint within 64 attempts AT ALL (vs ~100% for
// Classic) — `exp-0` is one of that minority, and 26 attempts is typical for
// a seed that succeeds, not an outlier. A satisfied seed still makes the
// golden board a clean, fair reference; see the radius-3 describe block
// below for the full note.
const EXPANDED_SEED = 'exp-0';
const expandedTopology = buildTopology(3, 11);

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
    // satisfy the red-token constraint — well within TOKEN_RETRY_BOUND (64),
    // and typical for Classic (near-100% of seeds succeed this fast).
    // Contrast the expanded board's golden seed below, which needs 26 of the
    // same 64 attempts, because only a minority of expanded seeds ever
    // succeed at all (see the radius-3 describe block's note).
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

// S2.1.7a / ADR-0013 — the radius-3 expanded board generated through the SAME
// `generateBoard` (board contents were already config; only the geometry moved
// to a parameter). Proves the expanded profile lays out deterministically at
// the larger size and that verify can recompute it (verify round-trip lives in
// verify.test.ts).
//
// NOTE (S2.1.7b comment-nit follow-up, reconciling the "26 vs 64" confusion):
// unlike Classic — where near-100% of seeds satisfy the red-token constraint
// in a handful of attempts (see the Classic golden test's `attemptsUsed: 4`
// above) — the expanded board's 8 red tokens on 37 tiles satisfy the
// no-adjacent-6/8 constraint for only ~25% of seeds within the full
// 64-attempt `TOKEN_RETRY_BOUND`; the other ~75% exhaust every attempt and
// ship with `redConstraintSatisfied: false`. The golden `exp-0` needs 26 of
// those 64 attempts — typical for a seed that DOES succeed, not an outlier
// among them — so, despite 26 ≤ 64, it is NOT "well within the bound" in the
// comfortable sense Classic's 4-attempt golden seed is. The mix/bound is v1
// and flagged for M3 re-tune (ADR-0013 Decision 2).
describe('generateBoard (radius-3 expanded board)', () => {
  it('produces a valid expanded layout: 37 tile kinds, 36 tokens, 11 ports, robber on the desert', () => {
    const layout = generateBoard(EXPANDED_SEED, expandedTopology, EXPANDED_BOARD);

    expect(Object.keys(layout.tileKinds)).toHaveLength(37);
    expect(Object.keys(layout.tileTokens)).toHaveLength(36);
    expect(layout.portContents).toHaveLength(11);

    const kindCounts = Object.values(layout.tileKinds).reduce<Record<string, number>>(
      (counts, kind) => {
        counts[kind] = (counts[kind] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(kindCounts).toEqual({
      timber: 8,
      clay: 6,
      fleece: 8,
      barley: 8,
      iron: 6,
      desert: 1,
    });

    expect(layout.tileKinds[layout.robberTileId]).toBe('desert');
    expect(layout.tileTokens[layout.robberTileId]).toBeUndefined();

    const tokenCounts = [...Object.values(layout.tileTokens)].sort((a, b) => a - b);
    expect(tokenCounts).toEqual([...EXPANDED_BOARD.tokens].sort((a, b) => a - b));
  });

  it('is deterministic: same seed -> byte-identical expanded layout, called twice', () => {
    const first = generateBoard(EXPANDED_SEED, expandedTopology, EXPANDED_BOARD);
    const second = generateBoard(EXPANDED_SEED, expandedTopology, EXPANDED_BOARD);
    expect(second).toEqual(first);
  });

  it('is pure: passing a fresh topology vs the shared one yields the same layout', () => {
    const shared = generateBoard(EXPANDED_SEED, expandedTopology, EXPANDED_BOARD);
    const fresh = generateBoard(EXPANDED_SEED, buildTopology(3, 11), EXPANDED_BOARD);
    expect(fresh).toEqual(shared);
  });

  it('satisfies the red-token (no adjacent 6/8) constraint for the golden seed', () => {
    const layout = generateBoard(EXPANDED_SEED, expandedTopology, EXPANDED_BOARD);
    expect(layout.redConstraintSatisfied).toBe(true);

    const adjacency: Record<string, string[]> = {};
    for (const tile of expandedTopology.tiles) adjacency[tile.id] = [];
    for (const edge of expandedTopology.edges) {
      const incident = expandedTopology.tiles.filter((t) => t.edgeIds.includes(edge.id));
      if (incident.length !== 2) continue;
      const [a, b] = incident as [
        (typeof expandedTopology.tiles)[number],
        (typeof expandedTopology.tiles)[number],
      ];
      (adjacency[a.id] as string[]).push(b.id);
      (adjacency[b.id] as string[]).push(a.id);
    }
    for (const [tId, token] of Object.entries(layout.tileTokens)) {
      if (!RED_TOKENS.includes(token)) continue;
      for (const neighborId of adjacency[tId] ?? []) {
        const neighborToken = layout.tileTokens[neighborId];
        if (neighborToken !== undefined) {
          expect(RED_TOKENS.includes(neighborToken)).toBe(false);
        }
      }
    }
  });

  it('golden: matches a fixed expanded layout for the golden seed (regression guard)', () => {
    const layout = generateBoard(EXPANDED_SEED, expandedTopology, EXPANDED_BOARD);

    expect(layout.tileKinds['0,0']).toBe('fleece');
    expect(layout.robberTileId).toBe('0,3');
    // 26 of the 64 TOKEN_RETRY_BOUND attempts — see the describe block's note
    // above: typical for a satisfying expanded seed, not "well within" the
    // bound the comfortable way Classic's 4-attempt golden seed is.
    expect(layout.attemptsUsed).toBe(26);
    expect(layout.redConstraintSatisfied).toBe(true);
    expect(layout.portContents[0]).toEqual({
      kind: 'resource',
      rate: 2,
      resource: 'clay',
    });
  });

  it('different seeds produce different expanded layouts', () => {
    const a = generateBoard(EXPANDED_SEED, expandedTopology, EXPANDED_BOARD);
    const b = generateBoard('exp-1', expandedTopology, EXPANDED_BOARD);
    expect(a).not.toEqual(b);
  });
});
