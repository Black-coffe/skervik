import type { BoardState, BuildingsState } from '@skervik/core';
import { buildTopology, generateBoard } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { FLOTILLAS } from '../theme/flotillaColors.js';
import { buildBuildingDescriptors, buildPortDescriptors } from './pieceModel.js';

const topology = buildTopology();
const SEED = 'piecemodel-test-seed';
const seatOrder = ['player-1', 'player-2', 'player-3', 'player-4'];

function realBoard(): BoardState {
  const layout = generateBoard(SEED, topology);
  return {
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: layout.robberTileId,
  };
}

describe('buildBuildingDescriptors', () => {
  it('returns empty arrays when buildings is absent (no crash)', () => {
    expect(buildBuildingDescriptors(topology, undefined, seatOrder)).toEqual({
      pieces: [],
      roads: [],
    });
  });

  it("maps settlements/cities/roads to descriptors in each owner's flotilla color", () => {
    const settlementVertex = topology.vertices[0]?.id as string;
    const cityVertex = topology.vertices[5]?.id as string;
    const roadEdge = topology.edges[0]?.id as string;

    const buildings: BuildingsState = {
      settlements: { [settlementVertex]: 'player-2' },
      cities: { [cityVertex]: 'player-1' },
      roads: { [roadEdge]: 'player-3' },
    };

    const { pieces, roads } = buildBuildingDescriptors(topology, buildings, seatOrder);

    const settlement = pieces.find((p) => p.vertexId === settlementVertex);
    expect(settlement).toMatchObject({
      kind: 'settlement',
      flotillaId: FLOTILLAS[1]?.id,
      color: FLOTILLAS[1]?.color,
    });

    const city = pieces.find((p) => p.vertexId === cityVertex);
    expect(city).toMatchObject({
      kind: 'city',
      flotillaId: FLOTILLAS[0]?.id,
      color: FLOTILLAS[0]?.color,
    });

    expect(roads).toHaveLength(1);
    expect(roads[0]).toMatchObject({
      edgeId: roadEdge,
      flotillaId: FLOTILLAS[2]?.id,
      color: FLOTILLAS[2]?.color,
    });
  });

  it('skips a building whose owner is not present in seatOrder (defensive)', () => {
    const vertexId = topology.vertices[0]?.id as string;
    const buildings: BuildingsState = {
      settlements: { [vertexId]: 'ghost-player' },
      roads: {},
    };

    const { pieces } = buildBuildingDescriptors(topology, buildings, seatOrder);
    expect(pieces).toHaveLength(0);
  });

  it('every 4-flotilla mapping is distinguishable: 4 distinct colors for 4 distinct owners', () => {
    const vertices = topology.vertices.slice(0, 4).map((v) => v.id);
    const settlements: Record<string, string> = {};
    seatOrder.forEach((playerId, i) => {
      settlements[vertices[i] as string] = playerId;
    });
    const buildings: BuildingsState = { settlements, roads: {} };

    const { pieces } = buildBuildingDescriptors(topology, buildings, seatOrder);
    expect(pieces).toHaveLength(4);
    const colors = new Set(pieces.map((p) => p.color));
    const flotillaIds = new Set(pieces.map((p) => p.flotillaId));
    expect(colors.size).toBe(4);
    expect(flotillaIds.size).toBe(4);
  });
});

describe('buildPortDescriptors', () => {
  it('returns an empty array when board is absent (no crash)', () => {
    expect(buildPortDescriptors(topology, undefined)).toEqual([]);
  });

  it('returns exactly 9 port descriptors, one per topology.portSlots entry', () => {
    const descriptors = buildPortDescriptors(topology, realBoard());
    expect(descriptors).toHaveLength(9);
    expect(new Set(descriptors.map((d) => d.index)).size).toBe(9);
  });

  it('rate labels are locale-independent digits matching each portContent', () => {
    const board = realBoard();
    const descriptors = buildPortDescriptors(topology, board);
    descriptors.forEach((d, i) => {
      const content = board.portContents[i];
      expect(d.rateLabel).toBe(content?.kind === 'resource' ? '2:1' : '3:1');
    });
  });

  it('a 2:1 resource port carries the existing §2.3 resource color + pattern; a 3:1 generic port is neutral', () => {
    const board = realBoard();
    const descriptors = buildPortDescriptors(topology, board);
    descriptors.forEach((d, i) => {
      const content = board.portContents[i];
      if (content?.kind === 'resource') {
        expect(d.resourceColor).not.toBeNull();
        expect(d.patternKind).not.toBeNull();
      } else {
        expect(d.resourceColor).toBeNull();
        expect(d.patternKind).toBeNull();
      }
    });
  });

  it('marker positions are distinct across the 9 ports (spread around the coast)', () => {
    const descriptors = buildPortDescriptors(topology, realBoard());
    const keys = new Set(
      descriptors.map(
        (d) => `${d.markerPosition.x.toFixed(3)},${d.markerPosition.y.toFixed(3)}`,
      ),
    );
    expect(keys.size).toBe(9);
  });
});
