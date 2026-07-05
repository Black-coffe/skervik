// Frozen sRGB hex equivalents of `tokens.css` (DESIGN.md §2), as numeric
// literals — the Pixi canvas needs numbers, not CSS strings. Copied
// VERBATIM from the §2 tables; do not eyeball-convert OKLCH yourself (the
// two files are generated from the same source and must stay in sync).

import type { TileKind } from '@skervik/core';

/** §2.1 Environment & instruments. */
export const CANVAS_COLORS = {
  bgAbyss: 0x040c12,
  surface: 0x0d181e,
  surface2: 0x152127,
  line: 0x29353c,
  ink: 0xe5e8eb,
  muted: 0x96a0a7,
  primary: 0xf2af48,
  onPrimary: 0x091319,
  accent: 0x56b6bb,
  danger: 0xe24947,
  success: 0x63b376,
  chartPaper: 0xe1d6c2,
  chartPaperInk: 0x392a1e,
  hotNumber: 0xc53637,
} as const;

/** §2.3 Resource colors — data palette, keyed by `TileKind` ('desert' has no fill token of its own; the board layer draws it distinctly). */
export const RESOURCE_COLORS: Readonly<Record<Exclude<TileKind, 'desert'>, number>> = {
  timber: 0x428252,
  clay: 0xb16246,
  fleece: 0xd6d1c3,
  barley: 0xc0aa54,
  iron: 0x737b86,
};

/**
 * Desert has no dedicated token in DESIGN.md §2.3 (only the 5 resources are
 * listed there) — rather than invent an un-locked hex, the desert tile
 * reuses the existing `--chart-paper` token verbatim: it already reads as
 * arid/sandy parchment and is visually distinct from every §2.3 resource
 * fill. Canvas-only use, so it does not violate the "never a DOM panel bg"
 * restriction on that token.
 */
export const DESERT_COLOR = CANVAS_COLORS.chartPaper;
