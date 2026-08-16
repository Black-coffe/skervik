// The 6 flotilla (player) identities — DESIGN.md §2.2, copied verbatim.
// Color NEVER appears without the flotilla emblem glyph (a11y invariant:
// symbol + color) — actual glyph rendering is S1.6.2, this module only
// carries the stable color + emblem id so later stories share one mapping.
// Seats 4-5 (moray/manta) were added in S2.1.7b-05 for the 5-6 player
// `expanded` board (plan D6) — seats 0-3 are byte-unchanged.

import type { PlayerId } from '@skervik/core';

export type FlotillaId = 'petrel' | 'orca' | 'walrus' | 'narwhal' | 'moray' | 'manta';

export interface Flotilla {
  readonly id: FlotillaId;
  /** Frozen sRGB hex, verbatim from DESIGN.md §2.2. */
  readonly color: number;
  /** Stable emblem glyph id (§2.2) — the actual glyph asset/render is S1.6.2+. */
  readonly emblem: string;
}

/** Fixed seating order — same order every match, never reordered (mirrors `GameState.playerOrder`'s stability rule). */
export const FLOTILLAS: readonly Flotilla[] = [
  { id: 'petrel', color: 0x4682cc, emblem: 'petrel-silhouette' },
  { id: 'orca', color: 0xeeeeee, emblem: 'orca-fin' },
  { id: 'walrus', color: 0xc26030, emblem: 'walrus-tusks' },
  { id: 'narwhal', color: 0x60ccc5, emblem: 'narwhal-horn' },
  { id: 'moray', color: 0x4f9257, emblem: 'moray-silhouette' },
  { id: 'manta', color: 0xa1548f, emblem: 'manta-silhouette' },
];

/**
 * Deterministic seat-index -> flotilla mapping (0..{@link FLOTILLAS}.length-1,
 * the max `expanded` player count as of S2.1.7b) — same seat always gets the
 * same flotilla identity for the length of a match.
 */
export function flotillaForSeat(seatIndex: number): Flotilla {
  const flotilla = FLOTILLAS[seatIndex % FLOTILLAS.length];
  if (!flotilla) throw new Error(`No flotilla for seat index ${seatIndex}`);
  return flotilla;
}

/**
 * Maps a `PlayerId` to its flotilla via its position in the fixed seating
 * order (`GameState.playerOrder`, falling back to `players` array order).
 * Returns `undefined` for a player not present in `seatOrder`.
 */
export function flotillaForPlayer(
  playerId: PlayerId,
  seatOrder: readonly PlayerId[],
): Flotilla | undefined {
  const seatIndex = seatOrder.indexOf(playerId);
  return seatIndex === -1 ? undefined : flotillaForSeat(seatIndex);
}
