import { buildTopology } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import {
  axialToPixel,
  EXTRUDE_DEPTH,
  HEX_SIZE,
  hexCorners,
  parseTileId,
  tokenPipCount,
  Y_SCALE,
} from './hexGeometry.js';

describe('hexGeometry', () => {
  it('locks the E0.4-validated geometry constants', () => {
    expect(HEX_SIZE).toBe(46);
    expect(Y_SCALE).toBe(0.6);
    expect(EXTRUDE_DEPTH).toBe(16);
  });

  it('parseTileId is the exact inverse of core tileId()', () => {
    expect(parseTileId('0,0')).toEqual({ q: 0, r: 0 });
    expect(parseTileId('-2,1')).toEqual({ q: -2, r: 1 });
  });

  it('axialToPixel is deterministic (same coord -> identical point every call)', () => {
    const coord = { q: 1, r: -2 };
    const first = axialToPixel(coord);
    const second = axialToPixel(coord);
    expect(second).toEqual(first);
  });

  it('maps all 19 real board tiles to 19 distinct pixel positions', () => {
    const topology = buildTopology();
    const points = topology.tiles.map((tile) => axialToPixel(tile.coord));
    expect(points).toHaveLength(19);
    const keys = new Set(points.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(19);
  });

  it('hexCorners returns 6 corners at the requested radius', () => {
    const corners = hexCorners(HEX_SIZE);
    expect(corners).toHaveLength(6);
    for (const corner of corners) {
      // y is flattened by Y_SCALE, x is not — distance check against x only.
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(HEX_SIZE + 1e-9);
    }
  });

  it('tokenPipCount follows 6 - |7 - token| for every Classic token', () => {
    const expected: Record<number, number> = {
      2: 1,
      3: 2,
      4: 3,
      5: 4,
      6: 5,
      8: 5,
      9: 4,
      10: 3,
      11: 2,
      12: 1,
    };
    for (const [token, pips] of Object.entries(expected)) {
      expect(tokenPipCount(Number(token))).toBe(pips);
    }
  });
});
