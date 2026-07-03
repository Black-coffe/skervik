// @skervik/core — S1.3.4: longest road, largest army, VP tally, victory.
// Exercises the award-recomputation + victory pipeline `validate` appends
// after any VP/award-affecting action (build road/settlement/city,
// road-building card, knight play, dev-card buy): the longest-simple-path
// DFS (opponent buildings break the chain), the largest-army rule
// (strict-exceed steals, ties keep the incumbent), the full VP tally
// (settlement 1, city 2, award 2, hidden VP card 1) checked only on the
// acting player's own turn, and the `game.ended` freeze. Also covers the
// road-BUILD enemy-cut deferred here from S1.2.2 — the SAME graph rule the
// longest-road DFS uses.

import { describe, expect, it } from 'vitest';

import { buildTopology, type EdgeId, type TileTopology, type VertexId } from './board.js';
import { reduce } from './reduce.js';
import type {
  BoardState,
  GameEvent,
  GameState,
  LargestArmyAwardedEvent,
  LongestRoadAwardedEvent,
  PlayerState,
} from './types.js';
import { validate } from './validate.js';

// Awards/victory are deterministic (no PRNG) — the seed is passed only to
// satisfy the fixed `validate` signature (plan §1). The knight tests move the
// robber with no card-holding victim (a no-op steal), so no draw happens
// either.
const SEED = 'skervik-victory-seed-1';

const topology = buildTopology();

const RICH = { timber: 9, clay: 9, fleece: 9, barley: 9, iron: 9 };

function makePlayer(
  id: string,
  resources: Record<string, number> = {},
  victoryPoints = 0,
): PlayerState {
  return { id, name: id, victoryPoints, resources };
}

function makeBoard(robberTileId: string): BoardState {
  return { tileKinds: {}, tileTokens: {}, portContents: [], robberTileId };
}

/** The edge joining two adjacent vertices (test topology lookup). */
function edgeBetween(a: VertexId, b: VertexId): EdgeId {
  const edge = topology.edges.find(
    (e) => e.vertexIds.includes(a) && e.vertexIds.includes(b),
  );
  if (!edge) throw new Error(`no edge between ${a} and ${b}`);
  return edge.id;
}

/**
 * The first simple vertex path with exactly `edgeCount` edges satisfying
 * `accept`, avoiding every vertex in `exclude`. A simple VERTEX path never
 * repeats a vertex, so its edges never repeat either — a valid road chain.
 */
function findPath(
  edgeCount: number,
  accept: (path: VertexId[]) => boolean = () => true,
  exclude: ReadonlySet<VertexId> = new Set(),
): { vertices: VertexId[]; edges: EdgeId[] } {
  function dfs(path: VertexId[]): VertexId[] | null {
    if (path.length === edgeCount + 1) return accept(path) ? path : null;
    const last = path[path.length - 1] as VertexId;
    const vertex = topology.vertices.find((v) => v.id === last);
    if (!vertex) return null;
    for (const neighbor of [...vertex.adjacentVertexIds].sort()) {
      if (exclude.has(neighbor) || path.includes(neighbor)) continue;
      const found = dfs([...path, neighbor]);
      if (found) return found;
    }
    return null;
  }
  for (const start of topology.vertices) {
    if (exclude.has(start.id)) continue;
    const found = dfs([start.id]);
    if (found) {
      const edges: EdgeId[] = [];
      for (let i = 0; i < found.length - 1; i++) {
        edges.push(edgeBetween(found[i] as VertexId, found[i + 1] as VertexId));
      }
      return { vertices: found, edges };
    }
  }
  throw new Error(`no simple path of ${edgeCount} edges`);
}

/**
 * An interior vertex of `path` with a spare incident edge (not on the path)
 * whose far endpoint is off the path — the seam a break test attaches an
 * opponent's road+settlement to. Returns null if none (so `findPath`'s
 * `accept` can keep searching).
 */
function spareEdgeFor(
  path: VertexId[],
): { breakVertex: VertexId; spareEdge: EdgeId; spareEnd: VertexId } | null {
  const pathEdges = new Set<EdgeId>();
  for (let i = 0; i < path.length - 1; i++) {
    pathEdges.add(edgeBetween(path[i] as VertexId, path[i + 1] as VertexId));
  }
  for (let i = 1; i < path.length - 1; i++) {
    const vertexId = path[i] as VertexId;
    const vertex = topology.vertices.find((v) => v.id === vertexId);
    if (!vertex) continue;
    for (const edgeId of vertex.edgeIds) {
      if (pathEdges.has(edgeId)) continue;
      const edge = topology.edges.find((e) => e.id === edgeId);
      if (!edge) continue;
      const other =
        edge.vertexIds[0] === vertexId ? edge.vertexIds[1] : edge.vertexIds[0];
      if (!path.includes(other))
        return { breakVertex: vertexId, spareEdge: edgeId, spareEnd: other };
    }
  }
  return null;
}

/**
 * Like {@link spareEdgeFor}, but pinned to the exact `path[index]` vertex
 * rather than searching every interior vertex — the middle-split exactness
 * test below needs the opponent seated at a SPECIFIC (dead-center) vertex,
 * not merely "some breakable one".
 */
function spareEdgeAt(
  path: readonly VertexId[],
  index: number,
): { breakVertex: VertexId; spareEdge: EdgeId; spareEnd: VertexId } | null {
  const pathEdges = new Set<EdgeId>();
  for (let i = 0; i < path.length - 1; i++) {
    pathEdges.add(edgeBetween(path[i] as VertexId, path[i + 1] as VertexId));
  }
  const vertexId = path[index] as VertexId;
  const vertex = topology.vertices.find((v) => v.id === vertexId);
  if (!vertex) return null;
  for (const edgeId of vertex.edgeIds) {
    if (pathEdges.has(edgeId)) continue;
    const edge = topology.edges.find((e) => e.id === edgeId);
    if (!edge) continue;
    const other = edge.vertexIds[0] === vertexId ? edge.vertexIds[1] : edge.vertexIds[0];
    if (!path.includes(other))
      return { breakVertex: vertexId, spareEdge: edgeId, spareEnd: other };
  }
  return null;
}

function ok(result: ReturnType<typeof validate>): { ok: true; events: GameEvent[] } {
  if (!result.ok) throw new Error(`expected ok result, got ${result.reason}`);
  return result;
}

/**
 * A simple vertex path of exactly `edgeLength` edges STARTING at `start`,
 * avoiding every vertex in `exclude` (S1.3.4 DFS-hardening follow-up). Same
 * DFS shape as `findPath` above, but pinned to a fixed start rather than
 * searching every vertex — the building block {@link findYBranch} uses to
 * grow each arm out from a shared branch vertex.
 */
function armFrom(
  start: VertexId,
  edgeLength: number,
  exclude: ReadonlySet<VertexId>,
): VertexId[] {
  function dfs(path: VertexId[]): VertexId[] | null {
    if (path.length === edgeLength + 1) return path;
    const last = path[path.length - 1] as VertexId;
    const vertex = topology.vertices.find((v) => v.id === last);
    if (!vertex) return null;
    for (const neighbor of [...vertex.adjacentVertexIds].sort()) {
      if (exclude.has(neighbor) || path.includes(neighbor)) continue;
      const found = dfs([...path, neighbor]);
      if (found) return found;
    }
    return null;
  }
  const found = dfs([start]);
  if (!found) throw new Error(`no ${edgeLength}-edge arm from ${start}`);
  return found;
}

/**
 * A Y-branch: a degree-3 interior vertex (`center`) with 3 arms of
 * `armEdgeLengths` edges each, all vertex-disjoint except at `center`
 * (S1.3.4 DFS-hardening follow-up — real topology only, per the DFS's own
 * docstring in `validate.ts`: it walks `VertexTopology.adjacentVertexIds`/
 * `edgeIds`, so a fabricated graph would exercise nothing real).
 */
function findYBranch(armEdgeLengths: readonly [number, number, number]): {
  edges: EdgeId[];
  vertices: VertexId[];
  /** Each arm's own vertex list, `center` first through its far end last. */
  arms: VertexId[][];
} {
  for (const center of topology.vertices) {
    if (center.edgeIds.length !== 3) continue; // need exactly 3 arms to grow
    const used = new Set<VertexId>([center.id]);
    const arms: VertexId[][] = [];
    let ok3 = true;
    const neighbors = [...center.adjacentVertexIds].sort();
    for (let i = 0; i < neighbors.length; i++) {
      const near = neighbors[i] as VertexId;
      if (used.has(near)) {
        ok3 = false;
        break;
      }
      try {
        const rest = armFrom(near, (armEdgeLengths[i] as number) - 1, used);
        for (const v of rest) used.add(v);
        arms.push([center.id, ...rest]);
      } catch {
        ok3 = false;
        break;
      }
    }
    if (ok3 && arms.length === 3) {
      const edges: EdgeId[] = [];
      for (const arm of arms) {
        for (let i = 0; i < arm.length - 1; i++) {
          edges.push(edgeBetween(arm[i] as VertexId, arm[i + 1] as VertexId));
        }
      }
      return { edges, vertices: [...used], arms };
    }
  }
  throw new Error('no Y-branch fixture found');
}

describe('longest road (S1.3.4)', () => {
  it('awards the sole leader once their road reaches the Classic minimum of 5', () => {
    // A 5-edge chain; player-1 already owns the first 4 roads (length 4, no
    // award yet) and builds the 5th, completing the ≥5 lead.
    const path = findPath(5);
    const roads: Record<string, string> = {};
    for (let i = 0; i < 4; i++) roads[path.edges[i] as string] = 'player-1';

    const genesis: GameState = {
      matchId: 'm-lr-1',
      phase: 'main',
      turn: 6,
      currentPlayerId: 'player-1',
      players: [makePlayer('player-1', { ...RICH }), makePlayer('player-2')],
      eventIndex: 40,
      seedHash: 'deadbeef',
      buildings: { settlements: {}, roads },
    };

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.buildRoad',
          playerId: 'player-1',
          edgeId: path.edges[4] as string,
        },
        'player-1',
        SEED,
      ),
    );
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ type: 'road.built' });
    const award = result.events[1] as LongestRoadAwardedEvent;
    expect(award).toMatchObject({
      type: 'award.longestRoad',
      playerId: 'player-1',
      length: 5,
    });

    const next = result.events.reduce(reduce, genesis);
    expect(next.longestRoadHolder).toBe('player-1');

    // Determinism: the exact recorded events replay to the same state.
    expect(result.events.reduce(reduce, genesis)).toEqual(next);
  });

  it('vacates the award when an opponent settlement breaks the leader into < 5', () => {
    // player-1 holds longest road on a 5-edge chain; player-2 places a
    // settlement on an interior vertex (via a spare road) — the shared cut
    // splits the chain into 2 + 3, so nobody now reaches 5.
    const path = findPath(5, (p) => spareEdgeFor(p) !== null);
    const seam = spareEdgeFor(path.vertices);
    if (!seam) throw new Error('fixture bug: no breakable interior vertex');

    const roads: Record<string, string> = {};
    for (const edgeId of path.edges) roads[edgeId] = 'player-1';
    roads[seam.spareEdge] = 'player-2'; // player-2's road anchoring the settlement

    const genesis: GameState = {
      matchId: 'm-lr-break',
      phase: 'main',
      turn: 9,
      currentPlayerId: 'player-2',
      players: [makePlayer('player-1'), makePlayer('player-2', { ...RICH })],
      eventIndex: 50,
      seedHash: 'deadbeef',
      buildings: { settlements: {}, roads },
      longestRoadHolder: 'player-1',
    };

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.buildSettlement',
          playerId: 'player-2',
          vertexId: seam.breakVertex,
        },
        'player-2',
        SEED,
      ),
    );
    expect(result.events[0]).toMatchObject({ type: 'settlement.built' });
    const award = result.events.find((e) => e.type === 'award.longestRoad') as
      LongestRoadAwardedEvent | undefined;
    expect(award).toBeDefined();
    expect(award?.playerId).toBeUndefined(); // vacated — no player ≥ 5
    expect(award?.length).toBeLessThan(5);

    const next = result.events.reduce(reduce, genesis);
    expect(next.longestRoadHolder).toBeUndefined();
  });

  it('keeps the award with the incumbent when a rival only ties the lead', () => {
    // Two disjoint 5-edge chains: player-1 holds the award at 5; player-2
    // owns 4 roads of theirs and builds the 5th — a 5–5 tie keeps player-1.
    const pathA = findPath(5);
    const pathB = findPath(5, () => true, new Set(pathA.vertices));

    const roads: Record<string, string> = {};
    for (const edgeId of pathA.edges) roads[edgeId] = 'player-1';
    for (let i = 0; i < 4; i++) roads[pathB.edges[i] as string] = 'player-2';

    const genesis: GameState = {
      matchId: 'm-lr-tie',
      phase: 'main',
      turn: 11,
      currentPlayerId: 'player-2',
      players: [makePlayer('player-1'), makePlayer('player-2', { ...RICH })],
      eventIndex: 60,
      seedHash: 'deadbeef',
      buildings: { settlements: {}, roads },
      longestRoadHolder: 'player-1',
    };

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.buildRoad',
          playerId: 'player-2',
          edgeId: pathB.edges[4] as string,
        },
        'player-2',
        SEED,
      ),
    );
    // Tie keeps the incumbent — no award event, holder unchanged.
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ type: 'road.built' });
    const next = result.events.reduce(reduce, genesis);
    expect(next.longestRoadHolder).toBe('player-1');
  });

  it('walks a full 6-edge cycle end-to-end when the leader closes the loop', () => {
    // The center tile (`tiles[0]`, the ONE fully-interior tile of the radius-2
    // board — see `enumerateTileCoords`) owns a closed 6-edge loop:
    // `edgeIds[i]` joins `vertexIds[i]` and `vertexIds[(i+1)%6]` (board.ts's
    // own construction docstring). player-1 owns the first 5 of its 6 edges
    // (a broken-open 5-chain, already at the ≥5 minimum) and builds the 6th,
    // CLOSING the loop.
    //
    // Regression guard: a DFS that only starts walks from degree-1
    // ("leaf") vertices finds NONE here — every vertex on a closed cycle has
    // degree 2 — so it would report 0 (or, if it fell back to an arbitrary
    // start, at best a broken-open ≤5 walk, never the true 6). The correct
    // edge-once DFS starts from EVERY own-road endpoint and walks all 6.
    const tile = topology.tiles[0] as TileTopology;
    const roads: Record<string, string> = {};
    for (let i = 0; i < 5; i++) roads[tile.edgeIds[i] as string] = 'player-1';

    const genesis: GameState = {
      matchId: 'm-lr-cycle',
      phase: 'main',
      turn: 6,
      currentPlayerId: 'player-1',
      players: [makePlayer('player-1', { ...RICH }), makePlayer('player-2')],
      eventIndex: 40,
      seedHash: 'deadbeef',
      buildings: { settlements: {}, roads },
    };

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.buildRoad',
          playerId: 'player-1',
          edgeId: tile.edgeIds[5] as string,
        },
        'player-1',
        SEED,
      ),
    );
    const award = result.events.find((e) => e.type === 'award.longestRoad') as
      LongestRoadAwardedEvent | undefined;
    expect(award).toMatchObject({ playerId: 'player-1', length: 6 });

    const next = result.events.reduce(reduce, genesis);
    expect(next.longestRoadHolder).toBe('player-1');
  });

  it('finds the longest single trail through a Y-branch, not the sum of all arms', () => {
    // A degree-3 interior vertex with 2 arms of 2 edges and 1 arm of 3 edges
    // (7 edges total): the longest SIMPLE trail through the branch combines
    // only its two longest arms end-to-end (3 + 2 = 5 — reaching the ≥5
    // minimum so the award actually fires and its `length` is observable).
    //
    // Regression guards this catches: an implementation that SUMS every arm
    // reachable from the branch vertex (instead of maxing a single trail
    // through it) would report 7; one that only follows the single longest
    // arm from the branch vertex (never combining two arms through it) would
    // report 3. Neither is 5 — the correct DFS-max-over-two-arms answer.
    const { edges, vertices } = findYBranch([2, 2, 3]);
    const roads: Record<string, string> = {};
    for (const edgeId of edges) roads[edgeId] = 'player-1';

    // The Y-branch's 7 (2+2+3) edges are already fully built and entirely
    // UNTOUCHED by the trigger below (unlike the other tests, which build
    // the AWARD-triggering edge as part of the Y itself) — `computeLongestRoad`
    // recomputes EVERY player's longest road on ANY award-affecting action
    // (`appendAwardsAndVictory`, S1.3.4), so player-2 building a small,
    // fully DISJOINT 2-edge road of their own (excluded from every Y vertex)
    // still triggers the recompute that surfaces player-1's Y-derived award.
    const yVertices = new Set(vertices);
    const p2Path = findPath(2, () => true, yVertices);
    roads[p2Path.edges[0] as string] = 'player-2';

    const genesis: GameState = {
      matchId: 'm-lr-y',
      phase: 'main',
      turn: 6,
      currentPlayerId: 'player-2',
      players: [makePlayer('player-1'), makePlayer('player-2', { ...RICH })],
      eventIndex: 40,
      seedHash: 'deadbeef',
      buildings: { settlements: {}, roads },
    };

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.buildRoad',
          playerId: 'player-2',
          edgeId: p2Path.edges[1] as string,
        },
        'player-2',
        SEED,
      ),
    );
    const award = result.events.find((e) => e.type === 'award.longestRoad') as
      LongestRoadAwardedEvent | undefined;
    expect(award).toMatchObject({ playerId: 'player-1', length: 5 });
  });

  it('splits a leader’s road exactly 3+3 when an opponent settles the MIDDLE vertex of a 6-chain', () => {
    // A 6-edge chain (7 vertices); player-2 settles the exact MIDDLE vertex
    // (index 3) via a spare road — the split is exactly symmetric (3 + 3),
    // so the recomputed max length across all players is exactly 3 (belt-
    // and-suspenders on the graph-cut's exactness, beyond the existing
    // "vacates when < 5" test's looser `toBeLessThan(5)` assertion). Also
    // proves edges-once-not-vertices-once: the edge ENDING at the opponent's
    // vertex still counts (a vertex-set-visited bug would instead report 2).
    const path = findPath(6, (p) => spareEdgeAt(p, 3) !== null);
    const seam = spareEdgeAt(path.vertices, 3);
    if (!seam) throw new Error('fixture bug: no breakable middle vertex');

    const roads: Record<string, string> = {};
    for (const edgeId of path.edges) roads[edgeId] = 'player-1';
    roads[seam.spareEdge] = 'player-2';

    const genesis: GameState = {
      matchId: 'm-lr-mid-split',
      phase: 'main',
      turn: 9,
      currentPlayerId: 'player-2',
      players: [makePlayer('player-1'), makePlayer('player-2', { ...RICH })],
      eventIndex: 50,
      seedHash: 'deadbeef',
      buildings: { settlements: {}, roads },
      longestRoadHolder: 'player-1',
    };

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.buildSettlement',
          playerId: 'player-2',
          vertexId: seam.breakVertex,
        },
        'player-2',
        SEED,
      ),
    );
    const award = result.events.find((e) => e.type === 'award.longestRoad') as
      LongestRoadAwardedEvent | undefined;
    expect(award).toBeDefined();
    expect(award?.playerId).toBeUndefined(); // 3 < 5, vacated
    expect(award?.length).toBe(3); // exact 3+3 split, not 2 or some other value

    const next = result.events.reduce(reduce, genesis);
    expect(next.longestRoadHolder).toBeUndefined();
  });

  it('counts a loop plus a tail once each (lollipop) — regression: a visited-VERTEX-set DFS under-counts by 1', () => {
    // The center tile's full 6-edge loop (as above) PLUS one extra edge
    // tacked onto a loop vertex, leading outward to a 7th vertex off the
    // loop. player-1 owns all 7 edges. The longest simple (edge-once) trail
    // is 7: walk the tail edge in, then the full loop (6 edges), ending back
    // where the loop closes — the loop's attach vertex is REVISITED (its
    // vertex degree here is 3: 1 tail edge + 2 loop edges), which is legal
    // because only EDGES may not repeat, not vertices.
    //
    // Regression guard: an implementation that tracks visited VERTICES
    // (forbidding a revisit) instead of visited EDGES could not close the
    // loop back through the already-visited attach vertex, and would report
    // only 6 (tail + 5 of the 6 loop edges) — one short of the correct 7.
    const tile = topology.tiles[0] as TileTopology;
    const loopEdges = tile.edgeIds;
    const attach = tile.vertexIds[0] as VertexId;
    const attachVertex = topology.vertices.find((v) => v.id === attach);
    if (!attachVertex) throw new Error('fixture bug: attach vertex missing');
    const tailEdgeId = attachVertex.edgeIds.find((edgeId) => !loopEdges.includes(edgeId));
    if (!tailEdgeId)
      throw new Error('fixture bug: no edge outside the loop at attach vertex');

    const tailEdge = topology.edges.find((e) => e.id === tailEdgeId);
    if (!tailEdge) throw new Error('fixture bug: tail edge missing from topology');
    const tailFar =
      tailEdge.vertexIds[0] === attach ? tailEdge.vertexIds[1] : tailEdge.vertexIds[0];

    const roads: Record<string, string> = {};
    for (const edgeId of loopEdges) roads[edgeId] = 'player-1';
    roads[tailEdgeId] = 'player-1';

    // Trigger the award recompute (`computeLongestRoad` runs for EVERY
    // player on any award-affecting action, S1.3.4) via player-2 building a
    // small, fully DISJOINT 2-edge road of their own — excluded from every
    // lollipop vertex (loop + tail-far) so it cannot itself affect the
    // length-7 answer under test.
    const lollipopVertices = new Set<VertexId>([...tile.vertexIds, tailFar]);
    const p2Path = findPath(2, () => true, lollipopVertices);

    const genesis: GameState = {
      matchId: 'm-lr-lollipop',
      phase: 'main',
      turn: 6,
      currentPlayerId: 'player-2',
      players: [makePlayer('player-1'), makePlayer('player-2', { ...RICH })],
      eventIndex: 40,
      seedHash: 'deadbeef',
      buildings: {
        settlements: {},
        roads: { ...roads, [p2Path.edges[0] as string]: 'player-2' },
      },
    };

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.buildRoad',
          playerId: 'player-2',
          edgeId: p2Path.edges[1] as string,
        },
        'player-2',
        SEED,
      ),
    );
    const award = result.events.find((e) => e.type === 'award.longestRoad') as
      LongestRoadAwardedEvent | undefined;
    expect(award).toMatchObject({ playerId: 'player-1', length: 7 });
  });
});

describe('largest army (S1.3.4)', () => {
  const tileR = topology.tiles[0] as { id: string };
  const tileT = topology.tiles[1] as { id: string };

  function knightGenesis(overrides: Partial<GameState> = {}): GameState {
    return {
      matchId: 'm-la',
      phase: 'main',
      turn: 7,
      currentPlayerId: 'player-1',
      players: [makePlayer('player-1'), makePlayer('player-2')],
      eventIndex: 70,
      seedHash: 'deadbeef',
      board: makeBoard(tileR.id),
      devCards: { 'player-1': { held: { knight: 1 }, boughtThisTurn: {} } },
      ...overrides,
    };
  }

  it('awards largest army when a player reaches the Classic minimum of 3 knights', () => {
    const genesis = knightGenesis({ knightsPlayed: { 'player-1': 2 } });

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'knight',
          tileId: tileT.id,
        },
        'player-1',
        SEED,
      ),
    );
    // knightPlayed + robber.moved + award.largestArmy.
    const award = result.events.find((e) => e.type === 'award.largestArmy') as
      LargestArmyAwardedEvent | undefined;
    expect(award).toMatchObject({ playerId: 'player-1', knights: 3 });

    const next = result.events.reduce(reduce, genesis);
    expect(next.largestArmyHolder).toBe('player-1');
    expect(next.knightsPlayed).toEqual({ 'player-1': 3 });
  });

  it('keeps the award with the incumbent when a rival only ties the knight count', () => {
    const genesis = knightGenesis({
      currentPlayerId: 'player-2',
      knightsPlayed: { 'player-1': 3, 'player-2': 2 },
      largestArmyHolder: 'player-1',
      devCards: { 'player-2': { held: { knight: 1 }, boughtThisTurn: {} } },
    });

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-2',
          card: 'knight',
          tileId: tileT.id,
        },
        'player-2',
        SEED,
      ),
    );
    // 3–3 tie keeps player-1 — no award event emitted.
    expect(result.events.some((e) => e.type === 'award.largestArmy')).toBe(false);
    const next = result.events.reduce(reduce, genesis);
    expect(next.largestArmyHolder).toBe('player-1');
  });

  it('transfers the award only when a rival STRICTLY exceeds the incumbent', () => {
    const genesis = knightGenesis({
      currentPlayerId: 'player-2',
      knightsPlayed: { 'player-1': 3, 'player-2': 3 },
      largestArmyHolder: 'player-1',
      devCards: { 'player-2': { held: { knight: 1 }, boughtThisTurn: {} } },
    });

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-2',
          card: 'knight',
          tileId: tileT.id,
        },
        'player-2',
        SEED,
      ),
    );
    const award = result.events.find((e) => e.type === 'award.largestArmy') as
      LargestArmyAwardedEvent | undefined;
    expect(award).toMatchObject({ playerId: 'player-2', knights: 4 });
    const next = result.events.reduce(reduce, genesis);
    expect(next.largestArmyHolder).toBe('player-2');
  });
});

describe('victory point tally + game.ended (S1.3.4)', () => {
  // A target vertex with an own road to build a settlement onto, and 4 city
  // vertices well clear of it (never adjacent, so the distance rule is quiet).
  const target = topology.vertices[0] as {
    id: string;
    adjacentVertexIds: readonly string[];
  };
  const roadEdge = edgeBetween(target.id, target.adjacentVertexIds[0] as VertexId);
  const excluded = new Set<string>([target.id, ...target.adjacentVertexIds]);
  const cityVertices = topology.vertices
    .filter((v) => !excluded.has(v.id))
    .slice(0, 4)
    .map((v) => v.id);

  /** player-1: 4 cities (8 VP) + 1 hidden VP dev card = 9 VP, one road to build from. */
  function nearWinGenesis(overrides: Partial<GameState> = {}): GameState {
    const cities: Record<string, string> = {};
    for (const vertexId of cityVertices) cities[vertexId] = 'player-1';
    return {
      matchId: 'm-vp',
      phase: 'main',
      turn: 20,
      currentPlayerId: 'player-1',
      players: [makePlayer('player-1', { ...RICH }), makePlayer('player-2', { ...RICH })],
      eventIndex: 80,
      seedHash: 'deadbeef',
      buildings: { settlements: {}, roads: { [roadEdge]: 'player-1' }, cities },
      devCards: { 'player-1': { held: { victoryPoint: 1 }, boughtThisTurn: {} } },
      ...overrides,
    };
  }

  it('a hidden VP card completes a win on the owner’s OWN turn → game.ended + finished freeze', () => {
    const genesis = nearWinGenesis();
    // Sanity: 8 (cities) + 1 (hidden VP card) = 9 before the build.
    const result = ok(
      validate(
        genesis,
        { type: 'intent.buildSettlement', playerId: 'player-1', vertexId: target.id },
        'player-1',
        SEED,
      ),
    );
    expect(result.events[0]).toMatchObject({ type: 'settlement.built' });
    const ended = result.events.find((e) => e.type === 'game.ended');
    expect(ended).toMatchObject({ type: 'game.ended', winnerId: 'player-1' });
    expect(
      (ended as { finalStandings: Record<string, number> }).finalStandings['player-1'],
    ).toBe(10);

    const finished = result.events.reduce(reduce, genesis);
    expect(finished.phase).toBe('finished');

    // Freeze: every later gameplay intent is now rejected — not just
    // `endTurn`, the guard is unconditional (checked before ANY per-intent
    // phase/legality logic, `validate.ts`), so build/buy/roll intents earn
    // the same rejection too, total freeze rather than an endTurn-only gap.
    const afterEnd = validate(
      finished,
      { type: 'intent.endTurn', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    expect(afterEnd).toEqual({ ok: false, reason: 'GAME_ALREADY_ENDED' });

    const afterEndBuildRoad = validate(
      finished,
      { type: 'intent.buildRoad', playerId: 'player-1', edgeId: roadEdge },
      'player-1',
      SEED,
    );
    expect(afterEndBuildRoad).toEqual({ ok: false, reason: 'GAME_ALREADY_ENDED' });

    const afterEndBuyDevCard = validate(
      finished,
      { type: 'intent.buyDevCard', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    expect(afterEndBuyDevCard).toEqual({ ok: false, reason: 'GAME_ALREADY_ENDED' });

    const afterEndRollDice = validate(
      finished,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    expect(afterEndRollDice).toEqual({ ok: false, reason: 'GAME_ALREADY_ENDED' });
  });

  it('does NOT win on an opponent’s turn even when a player already sits at the threshold', () => {
    // player-1 sits at 10 (8 cities + 1 settlement + 1 hidden VP card), but it
    // is player-2's turn and player-2 acts — player-1's hidden tally is never
    // checked, so no win fires.
    const cities: Record<string, string> = {};
    for (const vertexId of cityVertices) cities[vertexId] = 'player-1';
    const p2Settlement = topology.vertices[10] as { id: string };
    const p2Road = edgeBetween(
      p2Settlement.id,
      (topology.vertices.find((v) => v.id === p2Settlement.id)?.adjacentVertexIds[0] ??
        p2Settlement.id) as VertexId,
    );
    const genesis: GameState = {
      matchId: 'm-vp-opp',
      phase: 'main',
      turn: 21,
      currentPlayerId: 'player-2',
      players: [makePlayer('player-1'), makePlayer('player-2', { ...RICH })],
      eventIndex: 90,
      seedHash: 'deadbeef',
      buildings: {
        settlements: { [target.id]: 'player-1', [p2Settlement.id]: 'player-2' },
        roads: {},
        cities,
      },
      devCards: { 'player-1': { held: { victoryPoint: 1 }, boughtThisTurn: {} } },
    };

    const result = ok(
      validate(
        genesis,
        { type: 'intent.buildRoad', playerId: 'player-2', edgeId: p2Road },
        'player-2',
        SEED,
      ),
    );
    // Only the road — player-1's over-threshold hidden tally is not the acting
    // player's, so no game.ended.
    expect(result.events.some((e) => e.type === 'game.ended')).toBe(false);
    const next = result.events.reduce(reduce, genesis);
    expect(next.phase).toBe('main');
  });
});

describe('road-build enemy-cut (deferred from S1.2.2, S1.3.4)', () => {
  // One vertex V with two incident edges: player-1 owns a road on the first
  // and wants to build the second, connecting only via V.
  const vertexV = topology.vertices.find((v) => v.edgeIds.length >= 2) as {
    id: string;
    edgeIds: readonly string[];
  };
  const ownedEdge = vertexV.edgeIds[0] as string;
  const buildEdge = vertexV.edgeIds[1] as string;

  function cutGenesis(settlements: Record<string, string>): GameState {
    return {
      matchId: 'm-cut',
      phase: 'main',
      turn: 8,
      currentPlayerId: 'player-1',
      players: [makePlayer('player-1', { ...RICH }), makePlayer('player-2')],
      eventIndex: 30,
      seedHash: 'deadbeef',
      buildings: { settlements, roads: { [ownedEdge]: 'player-1' } },
    };
  }

  it('rejects NOT_CONNECTED when an opponent building severs the only connection', () => {
    const result = validate(
      cutGenesis({ [vertexV.id]: 'player-2' }),
      { type: 'intent.buildRoad', playerId: 'player-1', edgeId: buildEdge },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_CONNECTED' });
  });

  it('allows the same build when the vertex is NOT held by an opponent (control)', () => {
    const result = validate(
      cutGenesis({}),
      { type: 'intent.buildRoad', playerId: 'player-1', edgeId: buildEdge },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
  });
});

describe('determinism (S1.3.4)', () => {
  it('never mutates input state through the award pipeline, and replays deep-equal', () => {
    const path = findPath(5);
    const roads: Record<string, string> = {};
    for (let i = 0; i < 4; i++) roads[path.edges[i] as string] = 'player-1';
    const genesis: GameState = {
      matchId: 'm-det',
      phase: 'main',
      turn: 6,
      currentPlayerId: 'player-1',
      players: [makePlayer('player-1', { ...RICH }), makePlayer('player-2')],
      eventIndex: 40,
      seedHash: 'deadbeef',
      buildings: { settlements: {}, roads },
    };
    const before = JSON.parse(JSON.stringify(genesis)) as GameState;

    const result = ok(
      validate(
        genesis,
        {
          type: 'intent.buildRoad',
          playerId: 'player-1',
          edgeId: path.edges[4] as string,
        },
        'player-1',
        SEED,
      ),
    );
    const applied = result.events.reduce(reduce, genesis);

    expect(genesis).toEqual(before); // validate + reduce left genesis untouched
    expect(result.events.reduce(reduce, genesis)).toEqual(applied); // replay = truth
  });
});
