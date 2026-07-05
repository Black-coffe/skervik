// Pure `GameState.board` -> render-descriptor mapping. The single place
// `TileKind -> §2 color + stroke-pattern` and `token -> pips / hot-number`
// decisions live — `BoardScene.ts` just paints these descriptors, it makes
// no resource/color/pip decisions itself.

import type { BoardState, BoardTopology, TileId, TileKind } from '@skervik/core';

import { CANVAS_COLORS, DESERT_COLOR, RESOURCE_COLORS } from '../theme/canvasColors.js';
import { axialToPixel, type Point, tokenPipCount } from './hexGeometry.js';

/** Per-kind stroke pattern id — the a11y second cue so resources are never hue-only (DESIGN.md §2.3, §12). */
export type PatternKind = 'timber' | 'clay' | 'fleece' | 'barley' | 'iron' | 'desert';

export interface TileDescriptor {
  readonly tileId: TileId;
  readonly position: Point;
  readonly kind: TileKind;
  readonly isDesert: boolean;
  readonly isRobber: boolean;
  readonly token: number | null;
  readonly pipCount: number | null;
  /** `true` for the 6/8 "tide mark" tokens — render in `--hot-number`. */
  readonly isHotNumber: boolean;
  readonly fillColor: number;
  readonly patternKind: PatternKind;
}

const PATTERN_BY_KIND: Readonly<Record<TileKind, PatternKind>> = {
  timber: 'timber',
  clay: 'clay',
  fleece: 'fleece',
  barley: 'barley',
  iron: 'iron',
  desert: 'desert',
};

function fillColorForKind(kind: TileKind): number {
  if (kind === 'desert') return DESERT_COLOR;
  return RESOURCE_COLORS[kind] ?? CANVAS_COLORS.chartPaper;
}

/** `PatternKind` for a `TileKind`, falling back to `'desert'` (no pattern) for any kind outside the known Classic resource set. */
function patternKindForKind(kind: TileKind): PatternKind {
  return PATTERN_BY_KIND[kind] ?? 'desert';
}

/**
 * Builds one render descriptor per topology tile. When `board` is absent
 * (pre-`board.generated` state) this returns an EMPTY array — the spec's
 * "render the sea + nothing else, no crash" for a state that hasn't reached
 * `board.generated` yet; callers must not assume 19 descriptors.
 */
export function buildTileDescriptors(
  topology: BoardTopology,
  board: BoardState | undefined,
): readonly TileDescriptor[] {
  if (!board) return [];
  return topology.tiles.map((tile): TileDescriptor => {
    const kind: TileKind = board.tileKinds[tile.id] ?? 'desert';
    const isDesert = kind === 'desert';
    const token = isDesert ? null : (board.tileTokens[tile.id] ?? null);
    const isHotNumber = token === 6 || token === 8;
    return {
      tileId: tile.id,
      position: axialToPixel(tile.coord),
      kind,
      isDesert,
      isRobber: board.robberTileId === tile.id,
      token,
      pipCount: token === null ? null : tokenPipCount(token),
      isHotNumber,
      fillColor: fillColorForKind(kind),
      patternKind: patternKindForKind(kind),
    };
  });
}
