import { buildTopology } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import {
  axialToPixel,
  edgeToPixel,
  parseTileId,
  type Point,
  vertexToPixel,
} from './hexGeometry.js';
import { nearestEdge, nearestVertex, tileAt } from './picking.js';

const topology = buildTopology();
/** Comfortably inside real vertex/edge spacing (HEX_SIZE=46) but small enough that "just beyond" tests never accidentally land near a neighbor. */
const MAX_DIST = 10;
const OPEN_SEA: readonly [number, number] = [10_000, 10_000];

describe('nearestVertex', () => {
  it('resolves a point exactly on a known vertex to that vertex', () => {
    const vertex = topology.vertices[0];
    expect(vertex).toBeDefined();
    if (!vertex) throw new Error('expected a vertex');
    const point = vertexToPixel(vertex.id);
    expect(nearestVertex(point, topology, MAX_DIST)).toBe(vertex.id);
  });

  it('returns null for a point in open sea', () => {
    const [x, y] = OPEN_SEA;
    expect(nearestVertex({ x, y }, topology, MAX_DIST)).toBeNull();
  });

  it('returns null just beyond maxDistPx of every vertex', () => {
    const vertex = topology.vertices[0];
    expect(vertex).toBeDefined();
    if (!vertex) throw new Error('expected a vertex');
    const point = vertexToPixel(vertex.id);
    const justBeyond = { x: point.x + MAX_DIST + 1, y: point.y };
    expect(nearestVertex(justBeyond, topology, MAX_DIST)).toBeNull();
  });

  it('picks the closer of two adjacent vertices, not whichever appears first in the topology array', () => {
    const edge = topology.edges[0];
    expect(edge).toBeDefined();
    if (!edge) throw new Error('expected an edge');
    const [vA, vB] = edge.vertexIds;
    const a = vertexToPixel(vA);
    const b = vertexToPixel(vB);
    // 90% of the way from a to b — much closer to b than to a (or to any
    // other vertex on the board, since edges are the shortest vertex spacing).
    const nearB: Point = { x: a.x + (b.x - a.x) * 0.9, y: a.y + (b.y - a.y) * 0.9 };
    expect(nearestVertex(nearB, topology, MAX_DIST)).toBe(vB);
  });
});

describe('nearestEdge', () => {
  it('resolves a point at an edge midpoint to that edge', () => {
    const edge = topology.edges[0];
    expect(edge).toBeDefined();
    if (!edge) throw new Error('expected an edge');
    const { mid } = edgeToPixel(edge.id, topology);
    expect(nearestEdge(mid, topology, MAX_DIST)).toBe(edge.id);
  });

  it('resolves a point partway along an edge (not just its midpoint) via point-to-segment distance', () => {
    const edge = topology.edges[0];
    expect(edge).toBeDefined();
    if (!edge) throw new Error('expected an edge');
    const { a, b } = edgeToPixel(edge.id, topology);
    const quarter = { x: a.x + (b.x - a.x) * 0.25, y: a.y + (b.y - a.y) * 0.25 };
    expect(nearestEdge(quarter, topology, MAX_DIST)).toBe(edge.id);
  });

  it('returns null for a point in open sea', () => {
    const [x, y] = OPEN_SEA;
    expect(nearestEdge({ x, y }, topology, MAX_DIST)).toBeNull();
  });

  it('returns null just beyond maxDistPx of every edge', () => {
    const edge = topology.edges[0];
    expect(edge).toBeDefined();
    if (!edge) throw new Error('expected an edge');
    const { mid, angle } = edgeToPixel(edge.id, topology);
    // Offset perpendicular to the edge so the point moves away from the
    // whole segment, not just its midpoint.
    const perpendicular = angle + Math.PI / 2;
    const justBeyond = {
      x: mid.x + Math.cos(perpendicular) * (MAX_DIST + 1),
      y: mid.y + Math.sin(perpendicular) * (MAX_DIST + 1),
    };
    expect(nearestEdge(justBeyond, topology, MAX_DIST)).toBeNull();
  });
});

describe('tileAt', () => {
  it('resolves a tile center to that tile', () => {
    const tile = topology.tiles[0];
    expect(tile).toBeDefined();
    if (!tile) throw new Error('expected a tile');
    const center = axialToPixel(parseTileId(tile.id));
    expect(tileAt(center, topology)).toBe(tile.id);
  });

  it('resolves a point near a tile edge but still inside its hex', () => {
    const tile = topology.tiles[0];
    expect(tile).toBeDefined();
    if (!tile) throw new Error('expected a tile');
    const center = axialToPixel(parseTileId(tile.id));
    const nearCorner = { x: center.x + 5, y: center.y };
    expect(tileAt(nearCorner, topology)).toBe(tile.id);
  });

  it('returns null for a point in open sea beyond the board', () => {
    const [x, y] = OPEN_SEA;
    expect(tileAt({ x, y }, topology)).toBeNull();
  });

  it('resolves every real board tile at its own center (no gaps, no overlaps)', () => {
    for (const tile of topology.tiles) {
      const center = axialToPixel(parseTileId(tile.id));
      expect(tileAt(center, topology)).toBe(tile.id);
    }
  });
});
