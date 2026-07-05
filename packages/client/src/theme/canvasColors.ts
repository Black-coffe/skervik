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

/** §2.3 Resource colors — data palette, keyed by `TileKind` (now includes a dedicated `desert` entry, DESIGN.md §2.3 2026-07-05 update). */
export const RESOURCE_COLORS: Readonly<Record<TileKind, number>> = {
  timber: 0x428252,
  clay: 0xb16246,
  fleece: 0xd6d1c3,
  barley: 0xc0aa54,
  iron: 0x737b86,
  desert: 0x9e8f7f,
};

/**
 * Desert (the misty sandbank) — dedicated `--res-desert` token, DESIGN.md
 * §2.3: a barren grey-dun, ~0.20 darker than `--res-fleece`/`--chart-paper`
 * so a desert tile never reads as a pale-cream resource or a chart-paper
 * number disc (added 2026-07-05, S1.6.1 follow-up nit).
 */
export const DESERT_COLOR = 0x9e8f7f;
