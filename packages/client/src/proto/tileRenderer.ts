// Hex geometry + per-tile drawing for the S0.4.1 perf prototype.
// Flat-top hexes, y-flattened for a 2.5D isometric read, with an extruded
// darker "side" strip along the lower contour for tabletop depth.

import { Color, Container, Graphics, Text } from 'pixi.js';

import type { HexTile, TileType } from './hexBoard.js';

/** Circumradius of a tile in world pixels (before pan/zoom). */
export const HEX_SIZE = 46;
/** Vertical flatten factor for the isometric read. */
export const Y_SCALE = 0.6;
/** How far the darker side extrusion drops below the tile's lower contour. */
export const EXTRUDE_DEPTH = 16;
/** Shrink applied to each tile's own outline so neighbours leave a visible gap (avoids z-order fighting with the extrusion). */
const GAP_SCALE = 0.92;

const TILE_COLOR: Record<TileType, number> = {
  pines: 0x2d5016,
  clayShoals: 0xb5651d,
  meadows: 0xa8c686,
  barleyFields: 0xd4a017,
  oreRidges: 0x6b6b6b,
  mistBank: 0xcfcfc4,
};

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axial -> world pixel, flat-top orientation, with the isometric y-flatten baked in. */
export function axialToPixel(q: number, r: number): Point {
  const x = HEX_SIZE * 1.5 * q;
  const y = HEX_SIZE * (Math.sqrt(3) / 2) * q + HEX_SIZE * Math.sqrt(3) * r;
  return { x, y: y * Y_SCALE };
}

/** Flat-top hex corners relative to its own center, at the given circumradius. */
function hexCorners(radius: number): Point[] {
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    corners.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) * Y_SCALE });
  }
  return corners;
}

const CORNERS = hexCorners(HEX_SIZE * GAP_SCALE);

function darken(color: number, amount: number): number {
  const k = 1 - amount;
  return new Color(color).multiply([k, k, k]).toNumber();
}

function pointsToFlat(points: readonly Point[]): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}

/** Draws the darker extruded side faces along the tile's lower contour (edges whose midpoint sits below center). */
function drawExtrusion(g: Graphics, color: number): void {
  const sideColor = darken(color, 0.45);
  for (let i = 0; i < CORNERS.length; i++) {
    const a = CORNERS[i]!;
    const b = CORNERS[(i + 1) % CORNERS.length]!;
    const midY = (a.y + b.y) / 2;
    if (midY <= 0) continue; // upper-contour edge — no visible side face here
    g.poly(
      pointsToFlat([
        a,
        b,
        { x: b.x, y: b.y + EXTRUDE_DEPTH },
        { x: a.x, y: a.y + EXTRUDE_DEPTH },
      ]),
    ).fill(sideColor);
  }
}

/** Second visual cue beyond fill color, per tile type — cheap procedural strokes, clipped to the hex outline via a mask. */
function drawPattern(g: Graphics, type: TileType, color: number): void {
  const ink = darken(color, 0.3);
  const r = HEX_SIZE * GAP_SCALE;
  switch (type) {
    case 'pines':
      for (let x = -r; x <= r; x += r / 2.5) {
        g.moveTo(x, -r).lineTo(x, r);
      }
      g.stroke({ width: 2, color: ink, alpha: 0.6 });
      break;
    case 'meadows':
      for (let y = -r; y <= r; y += r / 2.5) {
        g.moveTo(-r, y).lineTo(r, y);
      }
      g.stroke({ width: 2, color: ink, alpha: 0.6 });
      break;
    case 'barleyFields':
      for (let d = -r; d <= r; d += r / 2) {
        g.moveTo(d - r, -r).lineTo(d + r, r);
      }
      g.stroke({ width: 2, color: ink, alpha: 0.55 });
      break;
    case 'oreRidges':
      for (let d = -r; d <= r; d += r / 2) {
        g.moveTo(d - r, -r).lineTo(d + r, r);
        g.moveTo(d + r, -r).lineTo(d - r, r);
      }
      g.stroke({ width: 1.5, color: ink, alpha: 0.5 });
      break;
    case 'clayShoals':
      for (let y = -r; y <= r; y += r / 2) {
        for (let x = -r; x <= r; x += r / 2) {
          g.circle(x, y, 2.5).fill({ color: ink, alpha: 0.6 });
        }
      }
      break;
    case 'mistBank':
      // No static pattern — the mist tile gets an animated fog overlay instead (see scene.ts).
      break;
  }
}

export interface TileVisual {
  readonly container: Container;
  /** Present only for the mist-bank tile; the scene ticker pulses its alpha. */
  readonly fogOverlay: Graphics | null;
}

/** Builds the full display object for one tile (side extrusion + top face + pattern + number token), positioned at its own axial-derived world coordinate. */
export function createTileVisual(tile: HexTile): TileVisual {
  const container = new Container();
  const { x, y } = axialToPixel(tile.q, tile.r);
  container.position.set(x, y);

  const color = TILE_COLOR[tile.type];
  const flatPoints = pointsToFlat(CORNERS);

  const side = new Graphics();
  drawExtrusion(side, color);
  container.addChild(side);

  const top = new Graphics();
  top.poly(flatPoints).fill(color);
  container.addChild(top);

  const pattern = new Graphics();
  drawPattern(pattern, tile.type, color);
  const mask = new Graphics().poly(flatPoints).fill(0xffffff);
  pattern.mask = mask;
  container.addChild(mask);
  container.addChild(pattern);

  let fogOverlay: Graphics | null = null;
  if (tile.type === 'mistBank') {
    fogOverlay = new Graphics();
    fogOverlay.poly(flatPoints).fill({ color: 0xffffff, alpha: 0.35 });
    container.addChild(fogOverlay);
  }

  if (tile.number !== null) {
    const disc = new Graphics();
    disc
      .circle(0, 0, HEX_SIZE * 0.28)
      .fill(0xf4ecd8)
      .stroke({ width: 1.5, color: 0x3a3226 });
    container.addChild(disc);

    const isHot = tile.number === 6 || tile.number === 8;
    const label = new Text({
      text: String(tile.number),
      style: {
        fontFamily: 'monospace',
        fontSize: 18,
        fontWeight: 'bold',
        fill: isHot ? 0xa61b1b : 0x2a2418,
      },
    });
    label.anchor.set(0.5);
    container.addChild(label);
  }

  return { container, fogOverlay };
}
