// Pixi.js v8 scene: paints the board's `TileDescriptor[]` (from
// `boardModel.ts`) once into a Container, plus a sea backdrop and an
// ambient mist overlay. Ported feel from the E0.4 perf prototype
// (`src/proto/`, now deleted): y-flattened extrusion, per-kind stroke
// patterns, drag-pan + wheel-zoom, mist alpha pulse — but repainted with
// DESIGN.md §2 tokens and driven by real `TileDescriptor`s instead of
// ad-hoc proto data (DESIGN.md §12).

import type { BoardTopology } from '@skervik/core';
import { Application, Color, Container, FillGradient, Graphics, Text } from 'pixi.js';

import { CANVAS_COLORS } from '../theme/canvasColors.js';
import type { FlotillaId } from '../theme/flotillaColors.js';
import { computeFieldExtent, fitFieldToBox, seaRadiusForExtent } from './boardFit.js';
import type { TileDescriptor } from './boardModel.js';
import {
  axialToPixel,
  edgeToPixel,
  EXTRUDE_DEPTH,
  HEX_SIZE,
  hexCorners,
  parseTileId,
  type Point,
  vertexToPixel,
} from './hexGeometry.js';
import {
  type LegalTargets,
  nearestEdge,
  nearestVertex,
  type Pick,
  type PickMode,
  tileAt,
} from './picking.js';
import type {
  BuildingDescriptors,
  PieceDescriptor,
  PortDescriptor,
  RoadDescriptor,
} from './pieceModel.js';

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
/** Ambient mist pulse period, ms — DESIGN.md §9 requires "slow" (>= 4s period). */
const MIST_PULSE_PERIOD_MS = 6000;
const MIST_MIN_ALPHA = 0.08;
const MIST_MAX_ALPHA = 0.22;
/** Shrink applied to each tile's own outline so neighbours leave a visible gap. */
const GAP_SCALE = 0.92;
const CORNERS = hexCorners(HEX_SIZE * GAP_SCALE);

/**
 * S2.7.1/S2.7.2: horizontal space to reserve for the trade dock when it's
 * visible, so the board's default (un-panned) fit never sits under it.
 * Mirrors the dock's own CSS geometry (`TradeZone.css`: `left: 16px; width:
 * 372px`) plus a small gutter — duplicated here because Pixi can't read CSS
 * custom properties. The board is fit into whatever chart width is LEFT
 * after this reserve (see `recomputeFit`) — S2.7.2 supersedes the old fixed
 * `TRADE_DOCK_OFFSET_PX` shift, which only worked at scale=1.
 */
const TRADE_DOCK_RESERVE_PX = 372 + 16 + 20;

/** S2.8.1: pick radii in world px (pre-zoom — `toWorldPoint` already divides out `world.scale`). Vertices sit closer together than edges read comfortably at, so edge picking gets a slightly tighter radius. */
const VERTEX_PICK_RADIUS_PX = HEX_SIZE * 0.45;
const EDGE_PICK_RADIUS_PX = HEX_SIZE * 0.3;
/** A pointerdown->pointerup movement below this (screen px) is a click, not a pan drag. */
const CLICK_MOVE_THRESHOLD_PX = 5;

export type { LegalTargets, Pick, PickMode } from './picking.js';

export interface BoardSceneHandle {
  readonly app: Application;
  /**
   * S2.1.7b-06/S2.7.2: re-fits the board for the trade dock showing/hiding —
   * RESETS `world.position`/`world.scale` to the auto-fit baseline for the
   * now-available chart box (see `BoardScene.ts`'s `recomputeFit` for why
   * this resets rather than preserving an in-progress pan/zoom). Idempotent;
   * safe to call with the same value repeatedly.
   */
  setDockVisible(visible: boolean): void;
  /**
   * S2.8.1: switches picking behavior. `'none'` (the default) is the
   * pre-S2.8.1 board — no hover highlight, no click resolution, pan/zoom
   * only. Idempotent.
   */
  setPickMode(mode: PickMode): void;
  /**
   * S2.8.1: (re)binds the pick callback, replacing any previous one —
   * settable repeatedly so a caller (React) can rebind a changing callback
   * without remounting the scene. Fires only on a genuine click (not a pan
   * drag) that resolves to a real target under the current pick mode.
   */
  onPick(callback: (pick: Pick) => void): void;
  /**
   * S2.8.2: (re)draws the PERSISTENT legal-target layer — distinct from the
   * transient hover highlight above it (`drawHighlight`/`highlightLayer`).
   * `null` clears it. Idempotent to call with the same targets repeatedly.
   */
  setLegalTargets(targets: LegalTargets | null): void;
  /** Cleans up ticker/listeners and destroys the Pixi application. Safe to call once. */
  destroy(): void;
}

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
    const a = CORNERS[i] as Point;
    const b = CORNERS[(i + 1) % CORNERS.length] as Point;
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

/** Second visual cue beyond fill color, per resource kind — the a11y-required stroke pattern (DESIGN.md §2.3, §12). */
function drawPattern(
  g: Graphics,
  patternKind: TileDescriptor['patternKind'],
  color: number,
): void {
  const ink = darken(color, 0.3);
  const r = HEX_SIZE * GAP_SCALE;
  switch (patternKind) {
    case 'timber':
      for (let x = -r; x <= r; x += r / 2.5) {
        g.moveTo(x, -r).lineTo(x, r);
      }
      g.stroke({ width: 2, color: ink, alpha: 0.6 });
      break;
    case 'fleece':
      for (let y = -r; y <= r; y += r / 2.5) {
        g.moveTo(-r, y).lineTo(r, y);
      }
      g.stroke({ width: 2, color: ink, alpha: 0.6 });
      break;
    case 'barley':
      for (let d = -r; d <= r; d += r / 2) {
        g.moveTo(d - r, -r).lineTo(d + r, r);
      }
      g.stroke({ width: 2, color: ink, alpha: 0.55 });
      break;
    case 'iron':
      for (let d = -r; d <= r; d += r / 2) {
        g.moveTo(d - r, -r).lineTo(d + r, r);
        g.moveTo(d + r, -r).lineTo(d - r, r);
      }
      g.stroke({ width: 1.5, color: ink, alpha: 0.5 });
      break;
    case 'clay':
      for (let y = -r; y <= r; y += r / 2) {
        for (let x = -r; x <= r; x += r / 2) {
          g.circle(x, y, 2.5).fill({ color: ink, alpha: 0.6 });
        }
      }
      break;
    case 'desert':
      // No stroke pattern — desert is already visually distinct by fill
      // color + hosting the robber marker; no resource silhouette to imply.
      break;
  }
}

/** Builds one tile's base display object: side extrusion + top face + a11y stroke pattern. No token/robber — those live in the topper layer (see `buildTileTopper`) so they can render ABOVE the ambient mist while this base stays under it. */
function buildTileBase(descriptor: TileDescriptor): Container {
  const container = new Container();
  container.position.set(descriptor.position.x, descriptor.position.y);

  const flatPoints = pointsToFlat(CORNERS);
  const color = descriptor.fillColor;

  const side = new Graphics();
  drawExtrusion(side, color);
  container.addChild(side);

  const top = new Graphics();
  top.poly(flatPoints).fill(color);
  container.addChild(top);

  const pattern = new Graphics();
  drawPattern(pattern, descriptor.patternKind, color);
  const mask = new Graphics().poly(flatPoints).fill(0xffffff);
  pattern.mask = mask;
  container.addChild(mask);
  container.addChild(pattern);

  return container;
}

/**
 * Builds one tile's "topper" — the number-token disc + digit + probability
 * pips + robber marker — or `null` when the tile has neither (bare desert
 * with no robber). Toppers are mounted in a layer drawn ABOVE the ambient
 * mist overlay so these info-dense elements stay crisp (DESIGN.md §10).
 */
function buildTileTopper(descriptor: TileDescriptor): Container | null {
  if (descriptor.token === null && !descriptor.isRobber) return null;

  const container = new Container();
  container.position.set(descriptor.position.x, descriptor.position.y);

  if (descriptor.token !== null) {
    const disc = new Graphics();
    disc
      .circle(0, 0, HEX_SIZE * 0.28)
      .fill(CANVAS_COLORS.chartPaper)
      .stroke({ width: 1.5, color: CANVAS_COLORS.chartPaperInk });
    container.addChild(disc);

    const digitColor = descriptor.isHotNumber
      ? CANVAS_COLORS.hotNumber
      : CANVAS_COLORS.chartPaperInk;
    // Render at 2x and scale down for crispness (DESIGN.md §12).
    const label = new Text({
      text: String(descriptor.token),
      style: {
        fontFamily: 'monospace',
        fontSize: 36,
        fontWeight: 'bold',
        fill: digitColor,
      },
    });
    label.anchor.set(0.5);
    label.scale.set(0.5);
    label.position.set(0, -HEX_SIZE * 0.05);
    container.addChild(label);

    if (descriptor.pipCount !== null && descriptor.pipCount > 0) {
      const pipRadius = 1.6;
      const gap = 4.5;
      const totalWidth = (descriptor.pipCount - 1) * gap;
      const pips = new Graphics();
      for (let i = 0; i < descriptor.pipCount; i++) {
        const px = -totalWidth / 2 + i * gap;
        pips.circle(px, HEX_SIZE * 0.12, pipRadius).fill(digitColor);
      }
      container.addChild(pips);
    }
  }

  if (descriptor.isRobber) {
    const robber = new Graphics();
    // Neutral piece — no player color (the robber belongs to no flotilla).
    robber
      .circle(0, -HEX_SIZE * 0.18, HEX_SIZE * 0.2)
      .fill(CANVAS_COLORS.surface2)
      .stroke({ width: 2, color: CANVAS_COLORS.ink });
    container.addChild(robber);
  }

  return container;
}

/**
 * The per-flotilla non-color cue (DESIGN.md §2.2 a11y invariant: "color
 * NEVER without the flotilla emblem glyph"). 4 mutually-distinguishable
 * badge silhouettes — circle/triangle/square/diamond — stamped on every
 * piece (settlement, city, road) regardless of its flotilla color, so all 4
 * flotillas read apart under deutan/protan color vision. Full engraved
 * emblem art (DESIGN.md §5) can replace these later; a color-only piece must
 * never merge (S1.6.2 spec).
 */
function drawFlotillaBadge(g: Graphics, flotillaId: FlotillaId, radius: number): void {
  const badgeColor = CANVAS_COLORS.ink;
  switch (flotillaId) {
    case 'petrel':
      g.circle(0, 0, radius).fill(badgeColor);
      break;
    case 'orca':
      g.poly([0, -radius, radius, radius, -radius, radius]).fill(badgeColor);
      break;
    case 'walrus':
      g.rect(-radius, -radius, radius * 2, radius * 2).fill(badgeColor);
      break;
    case 'narwhal':
      g.poly([0, -radius, radius, 0, 0, radius, -radius, 0]).fill(badgeColor);
      break;
  }
}

/** A settlement: a small hut silhouette (pentagon: square base + peaked roof) — deliberately smaller and shape-distinct from a city (DESIGN.md a11y: shape, not just size). */
function buildSettlementPiece(descriptor: PieceDescriptor): Container {
  const container = new Container();
  container.position.set(descriptor.position.x, descriptor.position.y);

  const halfBase = HEX_SIZE * 0.16;
  const roofTop = HEX_SIZE * 0.16;
  const baseBottom = HEX_SIZE * 0.06;

  const hut = new Graphics();
  hut
    .poly([
      -halfBase,
      baseBottom,
      halfBase,
      baseBottom,
      halfBase,
      0,
      0,
      -roofTop,
      -halfBase,
      0,
    ])
    .fill(descriptor.color)
    .stroke({ width: 1.5, color: CANVAS_COLORS.ink });
  container.addChild(hut);

  const badge = new Graphics();
  drawFlotillaBadge(badge, descriptor.flotillaId, HEX_SIZE * 0.05);
  badge.position.set(0, -HEX_SIZE * 0.03);
  container.addChild(badge);

  return container;
}

/** A city: a taller, wider "keep" silhouette (base block + narrower tower) — clearly bigger AND a different shape from the settlement hut, never distinguished by size alone. */
function buildCityPiece(descriptor: PieceDescriptor): Container {
  const container = new Container();
  container.position.set(descriptor.position.x, descriptor.position.y);

  const halfBase = HEX_SIZE * 0.24;
  const baseBottom = HEX_SIZE * 0.08;
  const midY = -HEX_SIZE * 0.02;
  const halfTower = HEX_SIZE * 0.13;
  const topY = -HEX_SIZE * 0.28;

  const city = new Graphics();
  city
    .poly([
      -halfBase,
      baseBottom,
      halfBase,
      baseBottom,
      halfBase,
      midY,
      halfTower,
      midY,
      halfTower,
      topY,
      -halfTower,
      topY,
      -halfTower,
      midY,
      -halfBase,
      midY,
    ])
    .fill(descriptor.color)
    .stroke({ width: 1.5, color: CANVAS_COLORS.ink });
  container.addChild(city);

  const badge = new Graphics();
  drawFlotillaBadge(badge, descriptor.flotillaId, HEX_SIZE * 0.06);
  badge.position.set(0, topY + HEX_SIZE * 0.09);
  container.addChild(badge);

  return container;
}

/** A road: a flotilla-colored bar centered on the edge, oriented by its angle and inset so it reads as sitting between (not overlapping) the 2 vertex pieces. */
function buildRoadPiece(descriptor: RoadDescriptor): Container {
  const container = new Container();
  container.position.set(descriptor.mid.x, descriptor.mid.y);
  container.rotation = descriptor.angle;

  const dx = descriptor.b.x - descriptor.a.x;
  const dy = descriptor.b.y - descriptor.a.y;
  const fullLength = Math.sqrt(dx * dx + dy * dy);
  const length = fullLength * 0.6;
  const width = HEX_SIZE * 0.12;

  const bar = new Graphics();
  bar
    .roundRect(-length / 2, -width / 2, length, width, width / 2)
    .fill(descriptor.color)
    .stroke({ width: 1, color: CANVAS_COLORS.ink });
  container.addChild(bar);

  // Counter-rotate the badge so it stays upright regardless of the road's angle.
  const badgeHolder = new Container();
  badgeHolder.rotation = -descriptor.angle;
  const badge = new Graphics();
  drawFlotillaBadge(badge, descriptor.flotillaId, HEX_SIZE * 0.045);
  badgeHolder.addChild(badge);
  container.addChild(badgeHolder);

  return container;
}

/**
 * A port marker: a disc showing the rate as locale-independent digits
 * (`"3:1"`/`"2:1"`), sitting just beyond its coastal edge. For a 2:1
 * resource port, the disc carries the SAME §2.3 resource color + stroke
 * pattern as the matching tile kind (no new icon art, per spec) — ports
 * carry no flotilla color, they belong to no player.
 */
function buildPortMarker(descriptor: PortDescriptor): Container {
  const container = new Container();
  container.position.set(descriptor.markerPosition.x, descriptor.markerPosition.y);

  const radius = HEX_SIZE * 0.22;

  if (descriptor.resourceColor !== null && descriptor.patternKind !== null) {
    const patch = new Graphics();
    patch.circle(0, 0, radius).fill(descriptor.resourceColor);
    container.addChild(patch);

    const pattern = new Graphics();
    drawPattern(pattern, descriptor.patternKind, descriptor.resourceColor);
    const mask = new Graphics().circle(0, 0, radius).fill(0xffffff);
    pattern.mask = mask;
    container.addChild(mask);
    container.addChild(pattern);

    const ring = new Graphics();
    ring.circle(0, 0, radius).stroke({ width: 1.5, color: CANVAS_COLORS.ink });
    container.addChild(ring);
  } else {
    const disc = new Graphics();
    disc
      .circle(0, 0, radius)
      .fill(CANVAS_COLORS.chartPaper)
      .stroke({ width: 1.5, color: CANVAS_COLORS.chartPaperInk });
    container.addChild(disc);
  }

  const labelColor =
    descriptor.resourceColor !== null ? CANVAS_COLORS.ink : CANVAS_COLORS.chartPaperInk;
  const label = new Text({
    text: descriptor.rateLabel,
    style: {
      fontFamily: 'monospace',
      fontSize: 24,
      fontWeight: 'bold',
      fill: labelColor,
    },
  });
  label.anchor.set(0.5);
  label.scale.set(0.5);
  container.addChild(label);

  return container;
}

/** Sea backdrop, `seaRadius` px — S2.1.7b-06: derived per-match from the field extent (`seaRadiusForExtent`), not a fixed radius-2 constant, so the ring surrounds the 37-tile expanded board too. */
function buildSea(seaRadius: number): Graphics {
  const gradient = new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    colorStops: [
      { offset: 0, color: CANVAS_COLORS.surface },
      { offset: 1, color: CANVAS_COLORS.bgAbyss },
    ],
    textureSpace: 'local',
  });
  const sea = new Graphics();
  sea.circle(0, 0, seaRadius).fill(gradient);
  return sea;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Builds the full board scene into `mountEl` and wires pan/zoom + the
 * ambient mist pulse (paused under `prefers-reduced-motion`). Call
 * `destroy()` on unmount to leave no leaked Pixi app/ticker.
 */
export async function createBoardScene(
  mountEl: HTMLElement,
  topology: BoardTopology,
  descriptors: readonly TileDescriptor[],
  buildings: BuildingDescriptors,
  ports: readonly PortDescriptor[],
): Promise<BoardSceneHandle> {
  const app = new Application();
  await app.init({
    resizeTo: mountEl,
    backgroundColor: CANVAS_COLORS.bgAbyss,
    antialias: true,
    preference: 'webgpu',
  });
  mountEl.appendChild(app.canvas);

  // S2.1.7b-06: the field's actual pixel extent (tiles + port markers) for
  // THIS match's topology — read once here, not a hardcoded radius-2 size,
  // so both the sea backdrop and the auto-fit below scale to the 37-tile
  // expanded board exactly as they do to Classic's 19.
  const fieldExtent = computeFieldExtent(topology);
  const seaRadius = seaRadiusForExtent(fieldExtent);

  const world = new Container();
  app.stage.addChild(world);

  // S2.1.7b-06/S2.7.2: auto-fit — scales+centers `fieldExtent` to whatever
  // chart box is currently available (full width, or width minus the dock
  // reserve while it's shown). `dockVisible` starts `false`; the caller
  // (`GameTable`) applies the real current value immediately via
  // `setDockVisible` once this promise resolves. See `setDockVisible` below
  // for the resize/toggle recompute policy.
  let dockVisible = false;

  function recomputeFit(): void {
    const dockOffset = dockVisible ? TRADE_DOCK_RESERVE_PX : 0;
    const box = {
      x: dockOffset,
      y: 0,
      width: Math.max(app.screen.width - dockOffset, 1),
      height: Math.max(app.screen.height, 1),
    };
    const fit = fitFieldToBox(fieldExtent, box);
    world.scale.set(fit.scale);
    world.position.set(fit.x, fit.y);
  }

  recomputeFit();

  world.addChild(buildSea(seaRadius));

  // Render order (bottom to top): sea -> tile bases (fills + patterns +
  // extrusion) -> ambient mist -> toppers (number tokens + robber). This
  // keeps the info-dense toppers crisp/un-hazed while the tile field still
  // reads the atmospheric mist (DESIGN.md §10 contrast, S1.6.1a nit-1).
  const tilesLayer = new Container();
  const toppersLayer = new Container();
  for (const descriptor of descriptors) {
    tilesLayer.addChild(buildTileBase(descriptor));
    const topper = buildTileTopper(descriptor);
    if (topper !== null) toppersLayer.addChild(topper);
  }
  world.addChild(tilesLayer);

  // Ambient mist: a soft haze over the whole tile field. Built once; only
  // its alpha animates per tick (never rebuilt), and that animation itself
  // is skipped/paused whenever `prefers-reduced-motion: reduce` matches
  // (DESIGN.md §9 merge gate) — swapped for a static mid-alpha frame.
  const mist = new Graphics();
  mist.circle(0, 0, seaRadius * 0.7).fill({ color: CANVAS_COLORS.ink, alpha: 1 });
  mist.alpha = (MIST_MIN_ALPHA + MIST_MAX_ALPHA) / 2;
  world.addChild(mist);

  // Toppers layer drawn ABOVE the mist so tokens/robber stay crisp.
  world.addChild(toppersLayer);

  // Pieces (settlements/cities/roads) + ports: game-critical information,
  // so — same discipline as the toppers layer — they're built once here and
  // mounted ABOVE the mist, never rebuilt per frame (S1.6.2).
  const piecesLayer = new Container();
  for (const road of buildings.roads) piecesLayer.addChild(buildRoadPiece(road));
  for (const piece of buildings.pieces) {
    piecesLayer.addChild(
      piece.kind === 'city' ? buildCityPiece(piece) : buildSettlementPiece(piece),
    );
  }
  for (const port of ports) piecesLayer.addChild(buildPortMarker(port));
  world.addChild(piecesLayer);

  // S2.8.2: persistent legal-target layer — the setup-placement advisory hint
  // (`useSetupPlacement`), redrawn only when the caller's target SET changes
  // (never per-frame, unlike the hover highlight below). Sits BELOW the
  // S2.8.1 hover highlight so a hover ring is never occluded by a marker.
  // Empty by default, so it's invisible and inert unless a caller opts in.
  const legalLayer = new Graphics();
  world.addChild(legalLayer);

  // S2.8.1: hover-highlight overlay — above everything else, redrawn (never
  // rebuilt) per pointer move while a pick mode is active. Empty by default
  // (`pickMode: 'none'`), so it's invisible and inert unless a caller opts in.
  const highlightLayer = new Graphics();
  world.addChild(highlightLayer);

  const reducedMotionQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  let reducedMotion = prefersReducedMotion();

  let elapsedMs = 0;
  function onTick(deltaMS: number): void {
    if (reducedMotion) {
      mist.alpha = (MIST_MIN_ALPHA + MIST_MAX_ALPHA) / 2;
      return;
    }
    elapsedMs += deltaMS;
    const phase = (elapsedMs / MIST_PULSE_PERIOD_MS) * Math.PI * 2;
    mist.alpha =
      MIST_MIN_ALPHA + (MIST_MAX_ALPHA - MIST_MIN_ALPHA) * (0.5 + 0.5 * Math.sin(phase));
  }
  app.ticker.add((ticker) => onTick(ticker.deltaMS));

  function onReducedMotionChange(event: MediaQueryListEvent): void {
    reducedMotion = event.matches;
  }
  reducedMotionQuery?.addEventListener('change', onReducedMotionChange);

  // --- S2.8.1: pick mode + hover/click resolution. ---
  let pickMode: PickMode = 'none';
  let pickCallback: ((pick: Pick) => void) | null = null;

  /** Screen (client) coords -> world/board coords, reading `world.x/y/scale` LIVE at call time — correct under any pan/zoom, including mid-drag or after S2.7.2's auto-fit-zoom. */
  function toWorldPoint(e: PointerEvent): Point {
    const rect = app.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
      x: (screenX - world.x) / world.scale.x,
      y: (screenY - world.y) / world.scale.y,
    };
  }

  function resolvePick(worldPoint: Point): Pick | null {
    switch (pickMode) {
      case 'vertex': {
        const id = nearestVertex(worldPoint, topology, VERTEX_PICK_RADIUS_PX);
        return id === null ? null : { kind: 'vertex', id };
      }
      case 'edge': {
        const id = nearestEdge(worldPoint, topology, EDGE_PICK_RADIUS_PX);
        return id === null ? null : { kind: 'edge', id };
      }
      case 'tile': {
        const id = tileAt(worldPoint, topology);
        return id === null ? null : { kind: 'tile', id };
      }
      case 'none':
        return null;
    }
  }

  function drawHighlight(pick: Pick | null): void {
    highlightLayer.clear();
    if (pick === null) return;
    switch (pick.kind) {
      case 'vertex': {
        const p = vertexToPixel(pick.id);
        highlightLayer
          .circle(p.x, p.y, HEX_SIZE * 0.16)
          .stroke({ width: 3, color: CANVAS_COLORS.accent });
        break;
      }
      case 'edge': {
        const { a, b } = edgeToPixel(pick.id, topology);
        highlightLayer
          .moveTo(a.x, a.y)
          .lineTo(b.x, b.y)
          .stroke({ width: HEX_SIZE * 0.18, color: CANVAS_COLORS.accent, cap: 'round' });
        break;
      }
      case 'tile': {
        const center = axialToPixel(parseTileId(pick.id));
        const corners = hexCorners(HEX_SIZE).map((c) => ({
          x: c.x + center.x,
          y: c.y + center.y,
        }));
        highlightLayer
          .poly(pointsToFlat(corners))
          .stroke({ width: 3, color: CANVAS_COLORS.accent });
        break;
      }
    }
  }

  function setPickMode(mode: PickMode): void {
    if (pickMode === mode) return;
    pickMode = mode;
    highlightLayer.clear();
  }

  function onPick(callback: (pick: Pick) => void): void {
    pickCallback = callback;
  }

  /**
   * S2.8.2: draws each legal target as a filled marker in `CANVAS_COLORS.primary`
   * — shape + token distinct from the hover highlight's stroke-only
   * `CANVAS_COLORS.accent` ring/line (a11y §10: never hue-only), and subtle
   * enough not to fight it.
   */
  function drawLegalTargets(targets: LegalTargets | null): void {
    legalLayer.clear();
    if (targets === null) return;
    if (targets.kind === 'vertex') {
      for (const id of targets.ids) {
        const p = vertexToPixel(id);
        legalLayer
          .circle(p.x, p.y, HEX_SIZE * 0.13)
          .fill({ color: CANVAS_COLORS.primary, alpha: 0.85 })
          .stroke({ width: 1.5, color: CANVAS_COLORS.onPrimary, alpha: 0.6 });
      }
    } else {
      for (const id of targets.ids) {
        const { a, b } = edgeToPixel(id, topology);
        legalLayer
          .moveTo(a.x, a.y)
          .lineTo(b.x, b.y)
          .stroke({
            width: HEX_SIZE * 0.12,
            color: CANVAS_COLORS.primary,
            alpha: 0.7,
            cap: 'round',
          });
      }
    }
  }

  function setLegalTargets(targets: LegalTargets | null): void {
    drawLegalTargets(targets);
  }

  // --- Drag-pan + wheel-zoom on the world container (plain pointer events). ---
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  // S2.8.1: pointerdown origin, kept separate from `lastX/lastY` (which
  // mutate every drag tick) so pointerup can measure TOTAL movement since
  // press — a click, not a pan drag, per the movement threshold.
  let downX = 0;
  let downY = 0;

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragging) {
      world.x += e.clientX - lastX;
      world.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
    }
    if (pickMode !== 'none') drawHighlight(resolvePick(toWorldPoint(e)));
  }

  function onPointerUp(e: PointerEvent): void {
    dragging = false;
    if (pickMode === 'none') return;
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved >= CLICK_MOVE_THRESHOLD_PX) return; // a pan drag, not a click
    const pick = resolvePick(toWorldPoint(e));
    if (pick !== null) pickCallback?.(pick);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, world.scale.x * zoomFactor));

    const worldX = (pointerX - world.x) / world.scale.x;
    const worldY = (pointerY - world.y) / world.scale.y;
    world.scale.set(nextScale);
    world.x = pointerX - worldX * nextScale;
    world.y = pointerY - worldY * nextScale;
  }

  const canvas = app.canvas;
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // S2.1.7b-06/S2.7.2: recompute the fit on window resize. Reuses the
  // `resizeTo: mountEl` mechanism already wired at `app.init` above — Pixi's
  // ResizePlugin listens for the browser's `resize` event and calls
  // `renderer.resize()`, which emits this `'resize'` event — rather than
  // adding a second, redundant resize listener of our own.
  //
  // Recompute policy: RESET-to-fit on every recompute (resize AND dock
  // toggle), not "fit once on mount, then leave the user's pan/zoom alone".
  // The bug this whole story closes (S2.7.1 finding F1: the board overlaps
  // the dock at 1280px) must also stay fixed if a user resizes their window
  // DOWN to 1280px after mount — a fit-once policy would let F1 reappear on
  // live resize. Resetting is also the simpler of the two: no "has the user
  // interacted yet" state to track. Per S2.7.2's own notes this trades away
  // preserving an in-progress manual pan/zoom across a resize/toggle, which
  // is the same tradeoff the owner already accepted for the pre-fit 1280px
  // overlap — pan/zoom is the recovery mechanism, not the steady state.
  app.renderer.on('resize', recomputeFit);

  function setDockVisible(visible: boolean): void {
    if (visible === dockVisible) return;
    dockVisible = visible;
    recomputeFit();
  }

  let destroyed = false;
  return {
    app,
    setDockVisible,
    setPickMode,
    onPick,
    setLegalTargets,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      app.renderer.off('resize', recomputeFit);
      reducedMotionQuery?.removeEventListener('change', onReducedMotionChange);
      app.destroy(true, { children: true, texture: true, textureSource: true });
    },
  };
}
