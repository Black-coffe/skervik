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
import { type BoardProfile, CLASSIC_PROFILE } from './ruleProfile.js';
import type { PortContent, TileKind } from './types.js';

/**
 * Back-compat alias for the Classic board sub-profile — the single source of
 * truth now lives on {@link CLASSIC_PROFILE} (`ruleProfile.ts`, S2.1.1); this
 * re-derives it so existing importers (`boardgen.test.ts`, `@skervik/core`
 * re-export) keep working with byte-identical values. `generateBoard` reads
 * from its `board` parameter, not from this global, so a match under a
 * different profile generates its own board.
 */
export const CLASSIC_BOARD_PROFILE: BoardProfile = CLASSIC_PROFILE.board;

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
 * `(seed, topology, board)` in -> byte-identical `BoardLayout` out, every time
 * (ADR-0003). `topology` defaults to a fresh `buildTopology()` call — pass
 * one in to avoid recomputing it when generating many boards. `board` is the
 * board sub-profile to lay out; it defaults to Classic (`CLASSIC_PROFILE.board`)
 * so every existing caller stays byte-identical, and the server passes the
 * resolved profile's board for other modes (S2.1.1).
 */
export function generateBoard(
  seed: Seed,
  topology: BoardTopology = buildTopology(),
  board: BoardProfile = CLASSIC_PROFILE.board,
): BoardLayout {
  const tileIds = topology.tiles.map((tile) => tile.id);

  const shuffledKinds = shuffle(board.tileMix, seed, BOARD_GEN_STREAM.TILE_KIND_SHUFFLE);
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
    const candidate = shuffle(board.tokens, seed, streamIndex);
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

  const portContents = shuffle(board.ports, seed, BOARD_GEN_STREAM.PORT_SHUFFLE);

  // Exactly one 'desert' entry in the board profile's tileMix guarantees
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
