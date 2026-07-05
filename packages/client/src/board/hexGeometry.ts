// Pure hex geometry — ported from the E0.4 perf prototype (`src/proto/`,
// now deleted) into a tested, Pixi-free module. Flat-top hexes, y-flattened
// for the 2.5D isometric read (DESIGN.md §4). All 3 constants are locked to
// the Pixi v8 perf prototype's validated numbers (ADR-0002) — do NOT retune.

import type { AxialCoord, TileId } from '@skervik/core';

/** Circumradius of a tile in world pixels (before pan/zoom). Locked, E0.4. */
export const HEX_SIZE = 46;
/** Vertical flatten factor for the isometric read. Locked, E0.4. */
export const Y_SCALE = 0.6;
/** How far the darker side extrusion drops below the tile's lower contour. Locked, E0.4. */
export const EXTRUDE_DEPTH = 16;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Parses a core `TileId` (`"q,r"`) back into an `AxialCoord`. Inverse of `@skervik/core`'s `tileId()`. */
export function parseTileId(id: TileId): AxialCoord {
  const [qStr, rStr] = id.split(',');
  const q = Number(qStr);
  const r = Number(rStr);
  if (qStr === undefined || rStr === undefined || Number.isNaN(q) || Number.isNaN(r)) {
    throw new Error(`Malformed TileId: ${id}`);
  }
  return { q, r };
}

/** Axial -> world pixel, flat-top orientation, with the isometric y-flatten baked in. Pure & deterministic. */
export function axialToPixel(coord: AxialCoord): Point {
  const x = HEX_SIZE * 1.5 * coord.q;
  const y = HEX_SIZE * (Math.sqrt(3) / 2) * coord.q + HEX_SIZE * Math.sqrt(3) * coord.r;
  return { x, y: y * Y_SCALE };
}

/** Flat-top hex corners relative to its own center, at the given circumradius. */
export function hexCorners(radius: number): Point[] {
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    corners.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) * Y_SCALE });
  }
  return corners;
}

/**
 * Probability-frequency pip count for a number token (2..12, excl. 7):
 * `6 - |7 - token|`, so 2/12 -> 1 pip ... 6/8 -> 5 pips (the classic
 * dot-under-the-number convention — teaches roll odds without reading rules,
 * DESIGN.md §12).
 */
export function tokenPipCount(token: number): number {
  return 6 - Math.abs(7 - token);
}
