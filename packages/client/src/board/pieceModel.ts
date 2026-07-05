// Pure `GameState.buildings` / `board.portContents` -> render-descriptor
// mapping (S1.6.2), mirroring `boardModel.ts`'s discipline: THIS module makes
// every color/pattern/position decision; `BoardScene.ts` only paints the
// descriptors it returns. Vertex/edge pixel math itself lives in
// `hexGeometry.ts` (kept Pixi-free there too).

import type {
  BoardState,
  BoardTopology,
  BuildingsState,
  EdgeId,
  PlayerId,
  PortContent,
  VertexId,
} from '@skervik/core';

import type { FlotillaId } from '../theme/flotillaColors.js';
import { flotillaForPlayer } from '../theme/flotillaColors.js';
import { fillColorForKind, type PatternKind, patternKindForKind } from './boardModel.js';
import { edgeToPixel, HEX_SIZE, type Point, vertexToPixel } from './hexGeometry.js';

/** A settlement or a city sit on the same vertex geometry; shape is decided in `BoardScene.ts` (SHAPE, not color, distinguishes the two — DESIGN.md a11y invariant). */
export type PieceKind = 'settlement' | 'city';

export interface PieceDescriptor {
  readonly vertexId: VertexId;
  readonly kind: PieceKind;
  readonly position: Point;
  readonly flotillaId: FlotillaId;
  readonly color: number;
}

export interface RoadDescriptor {
  readonly edgeId: EdgeId;
  readonly a: Point;
  readonly b: Point;
  readonly mid: Point;
  readonly angle: number;
  readonly flotillaId: FlotillaId;
  readonly color: number;
}

export interface BuildingDescriptors {
  readonly pieces: readonly PieceDescriptor[];
  readonly roads: readonly RoadDescriptor[];
}

/** How far a port marker sits beyond its coastal edge's midpoint, radially outward from the board center. */
const PORT_MARKER_OFFSET = HEX_SIZE * 0.55;

export interface PortDescriptor {
  readonly index: number;
  readonly edgeId: EdgeId;
  readonly markerPosition: Point;
  /** Locale-independent digits — `"3:1"` generic or `"2:1"` resource (DESIGN.md §3 canvas-digits exception). */
  readonly rateLabel: string;
  /** §2.3 resource color for a 2:1 port, `null` for a neutral 3:1 generic port. */
  readonly resourceColor: number | null;
  /** §2.3 stroke pattern paired with `resourceColor` — same a11y discipline as tiles, never hue-only. `null` for generic ports. */
  readonly patternKind: PatternKind | null;
}

/**
 * Builds one descriptor per placed settlement/city (from `buildings.settlements`
 * / `buildings.cities`) and one per placed road (from `buildings.roads`),
 * each resolved to its owner's flotilla color via `flotillaForPlayer`.
 * `seatOrder` should be `GameState.playerOrder ?? GameState.players.map(p => p.id)`.
 * A building whose owner isn't found in `seatOrder` is skipped (defensive —
 * should not happen for a well-formed `GameState`).
 */
export function buildBuildingDescriptors(
  topology: BoardTopology,
  buildings: BuildingsState | undefined,
  seatOrder: readonly PlayerId[],
): BuildingDescriptors {
  if (!buildings) return { pieces: [], roads: [] };

  const pieces: PieceDescriptor[] = [];

  for (const [vertexId, playerId] of Object.entries(buildings.settlements)) {
    const flotilla = flotillaForPlayer(playerId, seatOrder);
    if (!flotilla) continue;
    pieces.push({
      vertexId,
      kind: 'settlement',
      position: vertexToPixel(vertexId),
      flotillaId: flotilla.id,
      color: flotilla.color,
    });
  }

  for (const [vertexId, playerId] of Object.entries(buildings.cities ?? {})) {
    const flotilla = flotillaForPlayer(playerId, seatOrder);
    if (!flotilla) continue;
    pieces.push({
      vertexId,
      kind: 'city',
      position: vertexToPixel(vertexId),
      flotillaId: flotilla.id,
      color: flotilla.color,
    });
  }

  const roads: RoadDescriptor[] = [];
  for (const [edgeId, playerId] of Object.entries(buildings.roads)) {
    const flotilla = flotillaForPlayer(playerId, seatOrder);
    if (!flotilla) continue;
    const geometry = edgeToPixel(edgeId, topology);
    roads.push({
      edgeId,
      a: geometry.a,
      b: geometry.b,
      mid: geometry.mid,
      angle: geometry.angle,
      flotillaId: flotilla.id,
      color: flotilla.color,
    });
  }

  return { pieces, roads };
}

function rateLabelFor(content: PortContent): string {
  return `${content.rate}:1`;
}

/**
 * Builds one descriptor per `topology.portSlots` entry, paired with
 * `board.portContents[i]`. Returns an empty array when `board` is absent
 * (pre-`board.generated` state, mirroring `buildTileDescriptors`'s "no
 * crash, nothing to render yet" contract).
 */
export function buildPortDescriptors(
  topology: BoardTopology,
  board: BoardState | undefined,
): readonly PortDescriptor[] {
  if (!board) return [];

  return topology.portSlots.map((slot): PortDescriptor => {
    const content = board.portContents[slot.index];
    const { mid } = edgeToPixel(slot.edgeId, topology);
    const magnitude = Math.sqrt(mid.x * mid.x + mid.y * mid.y);
    // Radial direction from the board center (world origin) through the
    // edge midpoint — coastal edges are always far from center, but guard
    // the degenerate (0,0) case defensively rather than dividing by zero.
    const outward: Point =
      magnitude > 0 ? { x: mid.x / magnitude, y: mid.y / magnitude } : { x: 0, y: 1 };
    const markerPosition: Point = {
      x: mid.x + outward.x * PORT_MARKER_OFFSET,
      y: mid.y + outward.y * PORT_MARKER_OFFSET,
    };

    if (!content || content.kind === 'generic') {
      return {
        index: slot.index,
        edgeId: slot.edgeId,
        markerPosition,
        rateLabel: content ? rateLabelFor(content) : '3:1',
        resourceColor: null,
        patternKind: null,
      };
    }

    return {
      index: slot.index,
      edgeId: slot.edgeId,
      markerPosition,
      rateLabel: rateLabelFor(content),
      resourceColor: fillColorForKind(content.resource),
      patternKind: patternKindForKind(content.resource),
    };
  });
}
