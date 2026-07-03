// @skervik/core — deterministic Classic board generation from seed (S1.1.2).
//
// Turns the S1.1.1 topology into a concrete Classic layout: tile resource
// kinds, number tokens (no two red 6/8 on adjacent tiles), port contents,
// robber start. Same `seed` -> byte-identical layout, forever (ADR-0003) —
// this is the first real consumer of `rng.ts` beyond dice, and it
// establishes the RNG stream-index convention documented in
// `docs/wiki/rng-stream-map.md`.
//
// Board generation deliberately does NOT draw from `state.eventIndex` (the
// stream gameplay events use, e.g. `rollDie(seed, state.eventIndex)` in
// `validate.ts`). It draws from a fixed reserved band instead (see
// `BOARD_GEN_STREAM` below) so the two stream "namespaces" can never
// collide, even though both derive from the same match seed.

import {
  type BoardTopology,
  buildTopology,
  type TileId,
  type TileTopology,
} from './board.js';
import { type Seed, shuffle } from './rng.js';
import type { PortContent, TileKind } from './types.js';

/** Classic profile constants (tile mix, token multiset, port mix) — a single swappable object per the M1 plan's rule-profile discipline; M2 profiles replace this, not the algorithm below. */
interface ClassicBoardProfile {
  /** 19 tile kinds (4 timber / 3 clay / 4 fleece / 4 barley / 3 iron / 1 desert), shuffled onto the 19 tiles. */
  readonly tileMix: readonly TileKind[];
  /** 18 number tokens, shuffled onto the 18 non-desert tiles. */
  readonly tokens: readonly number[];
  /** 9 port contents (4x generic 3:1, 5x resource 2:1 — one per resource), shuffled onto the 9 fixed port slots. */
  readonly ports: readonly PortContent[];
}

export const CLASSIC_BOARD_PROFILE: ClassicBoardProfile = {
  tileMix: [
    'timber',
    'timber',
    'timber',
    'timber',
    'clay',
    'clay',
    'clay',
    'fleece',
    'fleece',
    'fleece',
    'fleece',
    'barley',
    'barley',
    'barley',
    'barley',
    'iron',
    'iron',
    'iron',
    'desert',
  ],
  tokens: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
  ports: [
    { kind: 'generic', rate: 3 },
    { kind: 'generic', rate: 3 },
    { kind: 'generic', rate: 3 },
    { kind: 'generic', rate: 3 },
    { kind: 'resource', rate: 2, resource: 'timber' },
    { kind: 'resource', rate: 2, resource: 'clay' },
    { kind: 'resource', rate: 2, resource: 'fleece' },
    { kind: 'resource', rate: 2, resource: 'barley' },
    { kind: 'resource', rate: 2, resource: 'iron' },
  ],
};

/**
 * Reserved RNG stream-index band for board generation (see
 * `docs/wiki/rng-stream-map.md` for the full map + rationale). Fixed,
 * documented offsets far outside any range gameplay's `state.eventIndex`
 * ever reaches in one match, so the two stream "namespaces" never collide.
 * Token-shuffle retry attempt `k` (0-based) draws at
 * `TOKEN_SHUFFLE_BASE + k * TOKEN_SHUFFLE_STRIDE`.
 */
export const BOARD_GEN_STREAM = {
  TILE_KIND_SHUFFLE: 1_000_000,
  PORT_SHUFFLE: 1_000_100,
  TOKEN_SHUFFLE_BASE: 1_001_000,
  TOKEN_SHUFFLE_STRIDE: 100,
  /** Bounded retry: first constraint-satisfying attempt wins; on exhaustion the last attempt is returned with `redConstraintSatisfied: false` (never thrown, ADR-0003). */
  TOKEN_RETRY_BOUND: 64,
} as const;

/** Red (high-probability) tokens — the adjacency constraint applies to these two only. */
const RED_TOKENS: readonly number[] = [6, 8];

/**
 * The full deterministic Classic layout produced by {@link generateBoard} —
 * a superset of `GameState.board` (`BoardState`, `types.ts`) with
 * generation diagnostics that are useful for tests/audits but never applied
 * to state: only `tileKinds`/`tileTokens`/`portContents`/`robberTileId`
 * travel into the `board.generated` event.
 */
export interface BoardLayout {
  readonly tileKinds: Readonly<Record<TileId, TileKind>>;
  readonly tileTokens: Readonly<Record<TileId, number>>;
  readonly portContents: readonly PortContent[];
  readonly robberTileId: TileId;
  /** `false` only if all `BOARD_GEN_STREAM.TOKEN_RETRY_BOUND` attempts failed the red-token constraint. */
  readonly redConstraintSatisfied: boolean;
  /** 1-based count of token-shuffle attempts tried (the winning attempt, or `TOKEN_RETRY_BOUND` on exhaustion). */
  readonly attemptsUsed: number;
}

/**
 * Tile-tile adjacency derived from the topology's interior edges (an edge
 * incident to exactly 2 on-board tiles connects those 2 tiles; coastal
 * edges are incident to only 1 and are skipped). Local to this module —
 * board generation's only consumer of tile adjacency.
 */
function buildTileAdjacency(
  topology: BoardTopology,
): Readonly<Record<TileId, readonly TileId[]>> {
  const adjacency: Record<TileId, TileId[]> = {};
  for (const tile of topology.tiles) {
    adjacency[tile.id] = [];
  }
  for (const edge of topology.edges) {
    const incidentTiles = topology.tiles.filter((tile) => tile.edgeIds.includes(edge.id));
    if (incidentTiles.length !== 2) continue;
    const tileA = incidentTiles[0] as TileTopology;
    const tileB = incidentTiles[1] as TileTopology;
    (adjacency[tileA.id] as TileId[]).push(tileB.id);
    (adjacency[tileB.id] as TileId[]).push(tileA.id);
  }
  return adjacency;
}

/**
 * Checks the fair-generation constraint: no two red (6/8) tokens on
 * adjacent tiles. `tileIds`/`tokens` are parallel arrays (same order the
 * caller zips into a tile -> token map).
 */
function satisfiesRedTokenConstraint(
  tileIds: readonly TileId[],
  tokens: readonly number[],
  adjacency: Readonly<Record<TileId, readonly TileId[]>>,
): boolean {
  const tokenByTile: Record<TileId, number> = {};
  tileIds.forEach((id, i) => {
    tokenByTile[id] = tokens[i] as number;
  });
  for (const id of tileIds) {
    const token = tokenByTile[id];
    if (token === undefined || !RED_TOKENS.includes(token)) continue;
    for (const neighborId of adjacency[id] ?? []) {
      const neighborToken = tokenByTile[neighborId];
      if (neighborToken !== undefined && RED_TOKENS.includes(neighborToken)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Generates the deterministic Classic board layout for `seed`. Pure: same
 * `(seed, topology)` in -> byte-identical `BoardLayout` out, every time
 * (ADR-0003). `topology` defaults to a fresh `buildTopology()` call — pass
 * one in to avoid recomputing it when generating many boards.
 */
export function generateBoard(
  seed: Seed,
  topology: BoardTopology = buildTopology(),
): BoardLayout {
  const tileIds = topology.tiles.map((tile) => tile.id);

  const shuffledKinds = shuffle(
    CLASSIC_BOARD_PROFILE.tileMix,
    seed,
    BOARD_GEN_STREAM.TILE_KIND_SHUFFLE,
  );
  const tileKinds: Record<TileId, TileKind> = {};
  tileIds.forEach((id, i) => {
    tileKinds[id] = shuffledKinds[i] as TileKind;
  });

  const nonDesertTileIds = tileIds.filter((id) => tileKinds[id] !== 'desert');
  const tileAdjacency = buildTileAdjacency(topology);

  // Bounded deterministic retry for the red-token constraint: attempt k
  // reshuffles the same 18 tokens at a fresh, documented stream index.
  // First satisfying attempt wins; on exhaustion the last attempt is kept
  // and `redConstraintSatisfied` is set to false — never thrown.
  let tokensForNonDesert: readonly number[] = [];
  let redConstraintSatisfied = false;
  let attemptsUsed = 0;
  for (let attempt = 0; attempt < BOARD_GEN_STREAM.TOKEN_RETRY_BOUND; attempt++) {
    attemptsUsed = attempt + 1;
    const streamIndex =
      BOARD_GEN_STREAM.TOKEN_SHUFFLE_BASE +
      attempt * BOARD_GEN_STREAM.TOKEN_SHUFFLE_STRIDE;
    const candidate = shuffle(CLASSIC_BOARD_PROFILE.tokens, seed, streamIndex);
    tokensForNonDesert = candidate;
    if (satisfiesRedTokenConstraint(nonDesertTileIds, candidate, tileAdjacency)) {
      redConstraintSatisfied = true;
      break;
    }
  }

  const tileTokens: Record<TileId, number> = {};
  nonDesertTileIds.forEach((id, i) => {
    tileTokens[id] = tokensForNonDesert[i] as number;
  });

  const portContents = shuffle(
    CLASSIC_BOARD_PROFILE.ports,
    seed,
    BOARD_GEN_STREAM.PORT_SHUFFLE,
  );

  // Exactly one 'desert' entry in CLASSIC_BOARD_PROFILE.tileMix guarantees
  // `.find` succeeds — the shuffle is a permutation, never drops elements.
  const robberTileId = tileIds.find((id) => tileKinds[id] === 'desert') as TileId;

  return {
    tileKinds,
    tileTokens,
    portContents,
    robberTileId,
    redConstraintSatisfied,
    attemptsUsed,
  };
}
