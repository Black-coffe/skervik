// Pure hex geometry — ported from the E0.4 perf prototype (`src/proto/`,
// now deleted) into a tested, Pixi-free module. Flat-top hexes, y-flattened
// for the 2.5D isometric read (DESIGN.md §4). All 3 constants are locked to
// the Pixi v8 perf prototype's validated numbers (ADR-0002) — do NOT retune.

import type { AxialCoord, BoardTopology, EdgeId, TileId, VertexId } from '@skervik/core';
import { findEdge } from '@skervik/core';

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

/** Parses a core `VertexId` (`"q,r|q,r|q,r"`, the vertex's 3 defining tile-coords) back into its 3 `AxialCoord`s. */
export function parseVertexId(id: VertexId): [AxialCoord, AxialCoord, AxialCoord] {
  const parts = id.split('|');
  if (parts.length !== 3) {
    throw new Error(`Malformed VertexId: ${id}`);
  }
  const coords = parts.map((part) => {
    const [qStr, rStr] = part.split(',');
    const q = Number(qStr);
    const r = Number(rStr);
    if (qStr === undefined || rStr === undefined || Number.isNaN(q) || Number.isNaN(r)) {
      throw new Error(`Malformed VertexId: ${id}`);
    }
    return { q, r };
  });
  return coords as [AxialCoord, AxialCoord, AxialCoord];
}

/**
 * Vertex -> world pixel: the AVERAGE of `axialToPixel` of the vertex's 3
 * defining tile-coords. Exact, not an approximation — 3 mutually-adjacent
 * flat-top hex centers form an equilateral triangle whose centroid is
 * equidistant (= circumradius `HEX_SIZE`) from each center, i.e. exactly the
 * shared corner. `Y_SCALE` is linear, so it commutes with the average
 * (centroid of flattened points = flatten of the centroid). Works for
 * coastal vertices too (still averages all 3 listed coords, including
 * off-board ones — they still define the corner).
 */
export function vertexToPixel(id: VertexId): Point {
  const [a, b, c] = parseVertexId(id);
  const pa = axialToPixel(a);
  const pb = axialToPixel(b);
  const pc = axialToPixel(c);
  return { x: (pa.x + pb.x + pc.x) / 3, y: (pa.y + pb.y + pc.y) / 3 };
}

export interface EdgeGeometry {
  readonly a: Point;
  readonly b: Point;
  readonly mid: Point;
  /** Radians, `atan2(b.y - a.y, b.x - a.x)` — orients a road segment / port marker along the edge. */
  readonly angle: number;
}

/** Edge -> world pixel geometry: endpoints via `vertexToPixel` of the edge's 2 `vertexIds`, plus their midpoint + angle. */
export function edgeToPixel(id: EdgeId, topology: BoardTopology): EdgeGeometry {
  const edge = findEdge(topology, id);
  if (!edge) {
    throw new Error(`Unknown EdgeId: ${id}`);
  }
  const a = vertexToPixel(edge.vertexIds[0]);
  const b = vertexToPixel(edge.vertexIds[1]);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return { a, b, mid, angle };
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
