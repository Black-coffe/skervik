// Static board data for the E0.4 Pixi.js perf prototype (S0.4.1).
// Pure data, no rendering — the scene is a projection of this array (ADR-0002:
// canvas holds zero authoritative state). No randomness: layout is a fixed
// literal so perf runs are reproducible.

/** Placeholder resource types — lore names (timber/clay/fleece/barley/iron/mist) live only in these comments. */
export type TileType =
  | 'pines' // timber
  | 'clayShoals' // clay
  | 'meadows' // fleece
  | 'barleyFields' // barley
  | 'oreRidges' // iron
  | 'mistBank'; // center, no resource, no number token

export interface AxialCoord {
  readonly q: number;
  readonly r: number;
}

export interface HexTile extends AxialCoord {
  readonly type: TileType;
  readonly number: number | null;
}

export const HEX_RADIUS = 2;

/** Fixed tile-type assignment, index-aligned with `axialRing(HEX_RADIUS)`. Counts: 4 pines, 3 clayShoals, 4 meadows, 4 barleyFields, 3 oreRidges, 1 mistBank (center, index 9). */
const TILE_TYPES: readonly TileType[] = [
  'pines',
  'clayShoals',
  'meadows',
  'barleyFields',
  'oreRidges',
  'pines',
  'meadows',
  'barleyFields',
  'clayShoals',
  'mistBank',
  'oreRidges',
  'pines',
  'barleyFields',
  'meadows',
  'clayShoals',
  'pines',
  'oreRidges',
  'barleyFields',
  'meadows',
];

/** Classic 2..12 (minus 7) distribution, 18 values for the 18 producing tiles, assigned in fixed board-index order (skipping the mistBank index). */
const NUMBER_SEQUENCE: readonly number[] = [
  2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
];

/**
 * Enumerates axial coordinates of a hexagon-of-hexagons with the given radius,
 * in a fixed, deterministic order (outer loop over `q`, inner over `r`).
 * radius 2 -> 19 coords (rows of 3, 4, 5, 4, 3).
 */
export function axialRing(radius: number): AxialCoord[] {
  const coords: AxialCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      coords.push({ q, r });
    }
  }
  return coords;
}

function buildBoard(
  coords: readonly AxialCoord[],
  types: readonly TileType[],
): HexTile[] {
  let numberCursor = 0;
  return coords.map((coord, i) => {
    const type = types[i] ?? 'mistBank';
    const number = type === 'mistBank' ? null : (NUMBER_SEQUENCE[numberCursor++] ?? null);
    return { q: coord.q, r: coord.r, type, number };
  });
}

/** The 19-tile base board (radius 2). */
export const BASE_BOARD: readonly HexTile[] = buildBoard(
  axialRing(HEX_RADIUS),
  TILE_TYPES,
);

/**
 * Stress-test board: tiles `BASE_BOARD` across the 7 positions of a radius-1
 * hex-of-boards (center + 6 neighbors), each copy offset in axial space by the
 * full board span so copies never overlap. 19 * 7 = 133 hexes.
 */
function buildStressBoard(): readonly HexTile[] {
  const boardSpan = 2 * HEX_RADIUS + 1; // axial-unit spacing that clears one board's footprint
  const copyOffsets = axialRing(1); // 7 positions: center + 6 neighbors
  const tiles: HexTile[] = [];
  for (const offset of copyOffsets) {
    for (const tile of BASE_BOARD) {
      tiles.push({
        q: tile.q + offset.q * boardSpan,
        r: tile.r + offset.r * boardSpan,
        type: tile.type,
        number: tile.number,
      });
    }
  }
  return tiles;
}

export const STRESS_BOARD: readonly HexTile[] = buildStressBoard();
