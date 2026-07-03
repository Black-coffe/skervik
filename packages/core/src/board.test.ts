import { describe, expect, it } from 'vitest';

import { buildTopology, findEdge, findTile, findVertex, tileId } from './board.js';

describe('buildTopology', () => {
  const topology = buildTopology();

  it('yields exactly 19 tiles, 54 vertices, 72 edges (radius-2 board)', () => {
    expect(topology.tiles).toHaveLength(19);
    expect(topology.vertices).toHaveLength(54);
    expect(topology.edges).toHaveLength(72);
  });

  it('gives every tile a unique canonical id derived from its coord', () => {
    const ids = topology.tiles.map((tile) => tile.id);
    expect(new Set(ids).size).toBe(19);
    for (const tile of topology.tiles) {
      expect(tile.id).toBe(tileId(tile.coord));
    }
  });

  it('gives every tile exactly 6 vertex ids and 6 edge ids', () => {
    for (const tile of topology.tiles) {
      expect(tile.vertexIds).toHaveLength(6);
      expect(tile.edgeIds).toHaveLength(6);
    }
  });

  it('is pure and deterministic: recomputing twice gives deep-equal results', () => {
    const again = buildTopology();
    expect(again).toEqual(topology);
  });

  it('carries no functions or class instances anywhere in the structure (plain data, ADR-0003)', () => {
    const roundTripped = JSON.parse(JSON.stringify(topology)) as typeof topology;
    expect(roundTripped).toEqual(topology);
  });

  describe('vertex adjacency', () => {
    it('every tile in tiles is listed by every one of its own vertices as adjacent, or is off-board', () => {
      for (const tile of topology.tiles) {
        for (const vertexId of tile.vertexIds) {
          const vertex = findVertex(topology, vertexId);
          expect(vertex).toBeDefined();
          expect(vertex?.adjacentTileIds).toContain(tile.id);
        }
      }
    });

    it('interior/edge vertices have exactly 3 edges; extreme-corner vertices (1 on-board tile) have 2', () => {
      for (const vertex of topology.vertices) {
        expect(vertex.edgeIds.length).toBeGreaterThanOrEqual(2);
        expect(vertex.edgeIds.length).toBeLessThanOrEqual(3);
        expect(vertex.adjacentVertexIds).toHaveLength(vertex.edgeIds.length);
        // A vertex touching only 1 on-board tile has only 2 of its 3
        // conceptual edges enumerated (the edge between its 2 off-board
        // coords is never walked); every other vertex (2 or 3 on-board
        // tiles) has all 3.
        const expectedEdgeCount = vertex.adjacentTileIds.length === 1 ? 2 : 3;
        expect(vertex.edgeIds.length).toBe(expectedEdgeCount);
      }
    });

    it('adjacentTileIds is the on-board subset of tileCoords, never more than 3', () => {
      for (const vertex of topology.vertices) {
        expect(vertex.tileCoords).toHaveLength(3);
        expect(vertex.adjacentTileIds.length).toBeLessThanOrEqual(3);
        for (const tid of vertex.adjacentTileIds) {
          expect(findTile(topology, tid)).toBeDefined();
        }
      }
    });
  });

  describe('edge adjacency', () => {
    it('every edge has exactly 2 distinct endpoint vertices, each of which lists the edge back', () => {
      for (const edge of topology.edges) {
        expect(edge.vertexIds).toHaveLength(2);
        expect(edge.vertexIds[0]).not.toBe(edge.vertexIds[1]);
        for (const vertexId of edge.vertexIds) {
          const vertex = findVertex(topology, vertexId);
          expect(vertex).toBeDefined();
          expect(vertex?.edgeIds).toContain(edge.id);
        }
      }
    });

    it('every tile edge id resolves to a real edge that references the tile', () => {
      for (const tile of topology.tiles) {
        for (const edgeId of tile.edgeIds) {
          const edge = findEdge(topology, edgeId);
          expect(edge).toBeDefined();
          const [vA, vB] = edge?.vertexIds ?? [];
          const touchesTile = [vA, vB].some((vertexId) => {
            const vertex = vertexId ? findVertex(topology, vertexId) : undefined;
            return vertex?.adjacentTileIds.includes(tile.id) ?? false;
          });
          expect(touchesTile).toBe(true);
        }
      }
    });
  });

  describe('canonical ids', () => {
    it('vertex ids are order-independent of the 3 defining tile coords', () => {
      const vertex = topology.vertices.find((v) => v.tileCoords.length === 3);
      expect(vertex).toBeDefined();
      if (!vertex) throw new Error('expected at least one vertex');

      // Recompute the id from the same 3 coords shuffled into every rotation
      // — sorting inside id construction must make the result identical.
      const [a, b, c] = vertex.tileCoords;
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(c).toBeDefined();
      if (!a || !b || !c) throw new Error('expected 3 tile coords');
      const shuffled = [c, a, b].map(tileId).sort().join('|');
      expect(shuffled).toBe(vertex.id);
    });

    it('edge ids are order-independent of their 2 endpoint vertex ids', () => {
      const edge = topology.edges[0];
      expect(edge).toBeDefined();
      if (!edge) throw new Error('expected at least one edge');

      const [vA, vB] = edge.vertexIds;
      const reversed = [vB, vA].slice().sort().join('::');
      expect(reversed).toBe(edge.id);
    });

    it('tile, vertex, and edge ids are each globally unique', () => {
      expect(new Set(topology.tiles.map((t) => t.id)).size).toBe(topology.tiles.length);
      expect(new Set(topology.vertices.map((v) => v.id)).size).toBe(
        topology.vertices.length,
      );
      expect(new Set(topology.edges.map((e) => e.id)).size).toBe(topology.edges.length);
    });
  });

  describe('port slots', () => {
    it('defines exactly 9 fixed port slots, each on a real coastal edge', () => {
      expect(topology.portSlots).toHaveLength(9);
      const seenIndices = new Set<number>();
      for (const slot of topology.portSlots) {
        const edge = findEdge(topology, slot.edgeId);
        expect(edge).toBeDefined();

        // Coastal: exactly one of the edge's tile-facing sides has an
        // on-board tile — i.e. exactly 1 real tile in `tiles` references it.
        const incidentTiles = topology.tiles.filter((t) =>
          t.edgeIds.includes(slot.edgeId),
        );
        expect(incidentTiles).toHaveLength(1);

        expect(seenIndices.has(slot.index)).toBe(false);
        seenIndices.add(slot.index);
      }
      expect(seenIndices.size).toBe(9);
    });

    it('is deterministic across recomputation (same 9 edge ids in the same order)', () => {
      const again = buildTopology();
      expect(again.portSlots).toEqual(topology.portSlots);
    });
  });
});
