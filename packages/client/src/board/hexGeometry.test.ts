import { buildTopology, findTile } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import {
  axialToPixel,
  edgeToPixel,
  EXTRUDE_DEPTH,
  HEX_SIZE,
  hexCorners,
  parseTileId,
  parseVertexId,
  tokenPipCount,
  vertexToPixel,
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

  it('parseVertexId splits a VertexId into its 3 defining AxialCoords', () => {
    expect(parseVertexId('0,0|1,0|1,-1')).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 1, r: -1 },
    ]);
  });

  it('parseVertexId throws on a malformed id', () => {
    expect(() => parseVertexId('0,0|1,0')).toThrow(/Malformed VertexId/);
  });

  it('vertexToPixel maps all 54 real board vertices to 54 distinct pixel positions', () => {
    const topology = buildTopology();
    expect(topology.vertices).toHaveLength(54);
    const points = topology.vertices.map((v) => vertexToPixel(v.id));
    const keys = new Set(points.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`));
    expect(keys.size).toBe(54);
  });

  it('vertexToPixel: an interior vertex sits at pre-flatten distance HEX_SIZE from each of its 3 adjacent tile centers', () => {
    const topology = buildTopology();
    const interior = topology.vertices.find((v) => v.adjacentTileIds.length === 3);
    expect(interior).toBeDefined();
    if (!interior) throw new Error('expected an interior vertex');

    const point = vertexToPixel(interior.id);
    for (const tileId of interior.adjacentTileIds) {
      const tile = findTile(topology, tileId);
      expect(tile).toBeDefined();
      if (!tile) throw new Error('expected tile');
      const center = axialToPixel(tile.coord);
      const dx = point.x - center.x;
      // Undo the y-flatten before measuring distance — pre-flatten, every
      // vertex sits exactly HEX_SIZE (the circumradius) from each of its
      // on-board tile centers.
      const dy = (point.y - center.y) / Y_SCALE;
      const distance = Math.sqrt(dx * dx + dy * dy);
      expect(distance).toBeCloseTo(HEX_SIZE, 5);
    }
  });

  it("edgeToPixel: mid is the mean of a/b, and a/b are the edge vertices' own pixels", () => {
    const topology = buildTopology();
    const edge = topology.edges[0];
    expect(edge).toBeDefined();
    if (!edge) throw new Error('expected an edge');

    const geometry = edgeToPixel(edge.id, topology);
    expect(geometry.a).toEqual(vertexToPixel(edge.vertexIds[0]));
    expect(geometry.b).toEqual(vertexToPixel(edge.vertexIds[1]));
    expect(geometry.mid.x).toBeCloseTo((geometry.a.x + geometry.b.x) / 2, 9);
    expect(geometry.mid.y).toBeCloseTo((geometry.a.y + geometry.b.y) / 2, 9);
  });

  it('edgeToPixel throws on an unknown EdgeId', () => {
    const topology = buildTopology();
    expect(() => edgeToPixel('nope::nope', topology)).toThrow(/Unknown EdgeId/);
  });

  it("a road's endpoints match its edge's two vertex pixels, for every real board edge", () => {
    const topology = buildTopology();
    expect(topology.edges).toHaveLength(72);
    for (const edge of topology.edges) {
      const geometry = edgeToPixel(edge.id, topology);
      expect(geometry.a).toEqual(vertexToPixel(edge.vertexIds[0]));
      expect(geometry.b).toEqual(vertexToPixel(edge.vertexIds[1]));
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
