// S2.8.1 — pure inverse-geometry: turns a world-space point into the
// nearest `VertexId`/`EdgeId`, or the `TileId` whose hex contains it. Ground
// truth for all 3 is `hexGeometry`'s FORWARD transforms (`axialToPixel`,
// `vertexToPixel`, `edgeToPixel`, `hexCorners`) — no constants are
// re-derived here. Pixi-free so it's unit-testable without a canvas/WebGPU
// context. NO game logic, NO intents — S2.8.2+ consume `Pick` to build
// those; this module only answers "what's under this point?".

import type { BoardTopology, EdgeId, TileId, VertexId } from '@skervik/core';

import {
  axialToPixel,
  edgeToPixel,
  HEX_SIZE,
  hexCorners,
  parseTileId,
  type Point,
  vertexToPixel,
} from './hexGeometry.js';

/** The 3 pickable target kinds — mirrors `PieceKind` at a geometry level, not a game-rule level. */
export type PickKind = 'vertex' | 'edge' | 'tile';

/** `'none'` disables picking entirely (the pre-S2.8.1 board behavior). */
export type PickMode = 'none' | PickKind;

export interface Pick {
  readonly kind: PickKind;
  readonly id: string;
}

/** Full-size (un-shrunk) hex corners, reused as the ground truth for tile hit-testing — deliberately NOT `BoardScene`'s `GAP_SCALE`-shrunk render corners, so a click anywhere inside the tile's true hex (including the inter-tile gap) still resolves to it. */
const TILE_CORNERS = hexCorners(HEX_SIZE);

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest distance from `p` to the segment `a`-`b` (0 if `p` projects outside the segment, clamped to the nearer endpoint). */
function pointToSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Even-odd-free convex-polygon containment: `point` is inside (or ON) `corners` iff it never sits on the outside of any edge. Corners may be wound either way. Used for `tileAt`'s point-in-hex test. */
function pointInConvexPolygon(point: Point, corners: readonly Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i] as Point;
    const b = corners[(i + 1) % corners.length] as Point;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross === 0) continue; // on the edge line — doesn't disqualify
    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) sign = currentSign;
    else if (currentSign !== sign) return false;
  }
  return true;
}

/**
 * The vertex whose `vertexToPixel` is closest to `worldPoint`, if within
 * `maxDistPx` — else `null`. `worldPoint` is board/world space (post
 * screen->world inversion, pre any DOM/canvas coords).
 */
export function nearestVertex(
  worldPoint: Point,
  topology: BoardTopology,
  maxDistPx: number,
): VertexId | null {
  let best: VertexId | null = null;
  let bestDist = Infinity;
  for (const vertex of topology.vertices) {
    const d = distance(worldPoint, vertexToPixel(vertex.id));
    if (d < bestDist) {
      bestDist = d;
      best = vertex.id;
    }
  }
  return best !== null && bestDist <= maxDistPx ? best : null;
}

/**
 * The edge closest to `worldPoint` by point-to-segment distance (not just
 * midpoint distance — this keeps clicks near either end of a long edge
 * resolving to it, matching how a player actually aims at a road slot), if
 * within `maxDistPx` — else `null`.
 */
export function nearestEdge(
  worldPoint: Point,
  topology: BoardTopology,
  maxDistPx: number,
): EdgeId | null {
  let best: EdgeId | null = null;
  let bestDist = Infinity;
  for (const edge of topology.edges) {
    const { a, b } = edgeToPixel(edge.id, topology);
    const d = pointToSegmentDistance(worldPoint, a, b);
    if (d < bestDist) {
      bestDist = d;
      best = edge.id;
    }
  }
  return best !== null && bestDist <= maxDistPx ? best : null;
}

/**
 * The tile whose hex (full circumradius `HEX_SIZE`, not the render's
 * gap-shrunk outline) contains `worldPoint` — `null` for open sea/gaps
 * beyond the board.
 */
export function tileAt(worldPoint: Point, topology: BoardTopology): TileId | null {
  for (const tile of topology.tiles) {
    const center = axialToPixel(parseTileId(tile.id));
    const local = { x: worldPoint.x - center.x, y: worldPoint.y - center.y };
    if (pointInConvexPolygon(local, TILE_CORNERS)) return tile.id;
  }
  return null;
}
