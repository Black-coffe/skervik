import type { BoardState } from '@skervik/core';
import { buildTopology, generateBoard } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { CANVAS_COLORS, DESERT_COLOR, RESOURCE_COLORS } from '../theme/canvasColors.js';
import { buildTileDescriptors } from './boardModel.js';

const topology = buildTopology();
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

  it('returns exactly 19 descriptors, one per topology tile, for a generated board', () => {
    const descriptors = buildTileDescriptors(topology, realBoard());
    expect(descriptors).toHaveLength(19);
    expect(new Set(descriptors.map((d) => d.tileId)).size).toBe(19);
  });

  it('maps each resource kind to its §2.3 canvas color', () => {
    const board = realBoard();
    const descriptors = buildTileDescriptors(topology, board);
    for (const d of descriptors) {
      if (d.isDesert) {
        expect(d.fillColor).toBe(DESERT_COLOR);
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
