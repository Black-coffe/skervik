import type { BoardState, RuleProfileId } from '@skervik/core';
import { generateBoard, loadRuleProfile } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { CANVAS_COLORS, DESERT_COLOR, RESOURCE_COLORS } from '../theme/canvasColors.js';
import { buildTileDescriptors } from './boardModel.js';
import { topologyForProfile } from './matchTopology.js';

const topology = topologyForProfile('classic');
const SEED = 'boardmodel-test-seed';

function realBoard(): BoardState {
  const layout = generateBoard(SEED, topology);
  return {
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: layout.robberTileId,
  };
}

describe('buildTileDescriptors', () => {
  it('returns an empty array when board is absent (no crash, sea-only render)', () => {
    expect(buildTileDescriptors(topology, undefined)).toEqual([]);
  });

  // S2.1.7b-03: parameterized over both shipping board sizes — Classic
  // (radius 2) and the expanded 5–6 player board (radius 3) — proving
  // `buildTileDescriptors` is genuinely topology-driven, not hardcoded to 19.
  it.each([
    { profileId: 'classic' as RuleProfileId, tiles: 19, vertices: 54, edges: 72 },
    { profileId: 'expanded' as RuleProfileId, tiles: 37, vertices: 96, edges: 132 },
  ])(
    'returns exactly $tiles descriptors, one per topology tile, for $profileId ($vertices vertices / $edges edges)',
    ({ profileId, tiles, vertices, edges }) => {
      const topo = topologyForProfile(profileId);
      expect(topo.tiles.length).toBe(tiles);
      expect(topo.vertices.length).toBe(vertices);
      expect(topo.edges.length).toBe(edges);

      const layout = generateBoard(SEED, topo, loadRuleProfile(profileId).board);
      const board: BoardState = {
        tileKinds: layout.tileKinds,
        tileTokens: layout.tileTokens,
        portContents: layout.portContents,
        robberTileId: layout.robberTileId,
      };
      const descriptors = buildTileDescriptors(topo, board);
      expect(descriptors).toHaveLength(tiles);
      expect(new Set(descriptors.map((d) => d.tileId)).size).toBe(tiles);
    },
  );

  it('maps each resource kind to its §2.3 canvas color', () => {
    const board = realBoard();
    const descriptors = buildTileDescriptors(topology, board);
    for (const d of descriptors) {
      if (d.isDesert) {
        expect(d.fillColor).toBe(DESERT_COLOR);
        expect(d.fillColor).toBe(0x9e8f7f);
      } else {
        expect(d.fillColor).toBe(RESOURCE_COLORS[d.kind as keyof typeof RESOURCE_COLORS]);
      }
    }
  });

  it('desert tile has no token/pips and is never a hot number', () => {
    const board = realBoard();
    const descriptors = buildTileDescriptors(topology, board);
    const desert = descriptors.find((d) => d.isDesert);
    expect(desert).toBeDefined();
    expect(desert?.token).toBeNull();
    expect(desert?.pipCount).toBeNull();
    expect(desert?.isHotNumber).toBe(false);
  });

  it('sets isRobber true on exactly the board.robberTileId tile', () => {
    const board = realBoard();
    const descriptors = buildTileDescriptors(topology, board);
    const robberTiles = descriptors.filter((d) => d.isRobber);
    expect(robberTiles).toHaveLength(1);
    expect(robberTiles[0]?.tileId).toBe(board.robberTileId);
  });

  it('flags exactly the 6/8 tokens as hot numbers, in --hot-number', () => {
    const board = realBoard();
    const descriptors = buildTileDescriptors(topology, board);
    for (const d of descriptors) {
      if (d.token === 6 || d.token === 8) {
        expect(d.isHotNumber).toBe(true);
      } else {
        expect(d.isHotNumber).toBe(false);
      }
    }
    expect(CANVAS_COLORS.hotNumber).toBe(0xc53637);
  });

  it('non-desert tokens get the correct probability pip count', () => {
    const board = realBoard();
    const descriptors = buildTileDescriptors(topology, board);
    const expectedPips: Record<number, number> = {
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
    for (const d of descriptors) {
      if (d.token === null) continue;
      expect(d.pipCount).toBe(expectedPips[d.token]);
    }
  });
});
