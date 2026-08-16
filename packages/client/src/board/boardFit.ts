// S2.1.7b-06 / S2.7.2: pure board auto-fit-zoom math. The board's default
// (un-panned) view scales its ACTUAL field extent — read from the per-match
// `BoardTopology` (radius 2 for Classic, radius 3 for the 37-tile expanded
// board), never a hardcoded radius-2 size — to whatever chart box is
// currently available, and centers it there. No Pixi imports: this module is
// unit-testable without a canvas. `BoardScene.ts` is the only caller that
// turns a `FitResult` into `world.position`/`world.scale`.

import type { BoardTopology, EdgeId } from '@skervik/core';

import {
  axialToPixel,
  edgeToPixel,
  HEX_SIZE,
  hexCorners,
  parseTileId,
  type Point,
} from './hexGeometry.js';

/**
 * How far a port marker sits beyond its coastal edge's midpoint — mirrors
 * `pieceModel.ts`'s `PORT_MARKER_OFFSET`/`buildPortDescriptors` radial-offset
 * math exactly. Duplicated (not imported) so this module stays free of any
 * Pixi-adjacent import chain and independently unit-testable.
 */
const PORT_MARKER_OFFSET = HEX_SIZE * 0.55;
const PORT_MARKER_RADIUS = HEX_SIZE * 0.22;

/** Generous, fixed backdrop margin beyond the field's own bounding circle — keeps the sea reading as "beyond the coast" rather than clipped tight to the last port marker. */
const SEA_MARGIN_PX = HEX_SIZE * 2;

/** Caps how large the default fit can scale the board — otherwise very wide viewports (S2.7.2 AC3, ≥1920px) blow the field up disproportionately to HEX_SIZE-tuned art. */
export const MAX_FIT_SCALE = 1.5;

export interface FieldExtent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** The box to fit the field into, in the same coordinate space as the resulting `FitResult` (screen px; `(x, y)` is the box's top-left corner — e.g. shifted right by the trade-dock reserve). */
export interface FitBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FitResult {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export interface FitOptions {
  readonly maxScale?: number;
}

function portMarkerPosition(edgeId: EdgeId, topology: BoardTopology): Point {
  const { mid } = edgeToPixel(edgeId, topology);
  const magnitude = Math.sqrt(mid.x * mid.x + mid.y * mid.y);
  const outward: Point =
    magnitude > 0 ? { x: mid.x / magnitude, y: mid.y / magnitude } : { x: 0, y: 1 };
  return {
    x: mid.x + outward.x * PORT_MARKER_OFFSET,
    y: mid.y + outward.y * PORT_MARKER_OFFSET,
  };
}

/**
 * The field's full pixel bounding box for `topology`: every tile's 6 corners
 * (true `HEX_SIZE`, not the gap-shrunk render size, so the bound is
 * conservative — real rendered tiles sit strictly inside it) plus every port
 * marker's footprint. This is what "fits in the chart box" means for S2.7.2
 * AC1 — the board is tiles AND the port discs beyond the coast, not tiles
 * alone.
 */
export function computeFieldExtent(topology: BoardTopology): FieldExtent {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const corners = hexCorners(HEX_SIZE);
  for (const tile of topology.tiles) {
    const center = axialToPixel(parseTileId(tile.id));
    for (const corner of corners) {
      const x = center.x + corner.x;
      const y = center.y + corner.y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  for (const slot of topology.portSlots) {
    const marker = portMarkerPosition(slot.edgeId, topology);
    minX = Math.min(minX, marker.x - PORT_MARKER_RADIUS);
    maxX = Math.max(maxX, marker.x + PORT_MARKER_RADIUS);
    minY = Math.min(minY, marker.y - PORT_MARKER_RADIUS);
    maxY = Math.max(maxY, marker.y + PORT_MARKER_RADIUS);
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Scales+centers `extent` inside `box`: `scale` is the largest value that
 * still fits both axes (capped at `options.maxScale`, default
 * {@link MAX_FIT_SCALE}), and `(x, y)` is the `world.position` that puts the
 * extent's center at the box's center under that scale — i.e. the value to
 * feed straight into a Pixi `Container.position.set(x, y)` /
 * `Container.scale.set(scale)` pair.
 */
export function fitFieldToBox(
  extent: FieldExtent,
  box: FitBox,
  options: FitOptions = {},
): FitResult {
  const maxScale = options.maxScale ?? MAX_FIT_SCALE;
  const fieldWidth = extent.maxX - extent.minX;
  const fieldHeight = extent.maxY - extent.minY;
  const scale = Math.min(box.width / fieldWidth, box.height / fieldHeight, maxScale);
  const centerX = (extent.minX + extent.maxX) / 2;
  const centerY = (extent.minY + extent.maxY) / 2;
  return {
    scale,
    x: box.x + box.width / 2 - centerX * scale,
    y: box.y + box.height / 2 - centerY * scale,
  };
}

/**
 * Sea backdrop radius for `extent` — half the bounding box's diagonal (so
 * the circle comfortably covers every corner, not just the axis-aligned
 * edges) plus a fixed margin. Derived from the actual field rather than a
 * fixed radius-2 constant, so the sea ring surrounds the 37-tile expanded
 * board too, not just Classic's 19.
 */
export function seaRadiusForExtent(extent: FieldExtent): number {
  const halfWidth = (extent.maxX - extent.minX) / 2;
  const halfHeight = (extent.maxY - extent.minY) / 2;
  return Math.hypot(halfWidth, halfHeight) + SEA_MARGIN_PX;
}
