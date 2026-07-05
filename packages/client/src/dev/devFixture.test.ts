import { describe, expect, it } from 'vitest';

import { devFixtureState } from './devFixture.js';

describe('devFixtureState', () => {
  it('reaches board.generated: a real 19-tile board with all 9 port contents', () => {
    expect(devFixtureState.board).toBeDefined();
    expect(devFixtureState.board?.portContents).toHaveLength(9);
  });

  it('places 8 settlements/roads across all 4 flotillas via the real setup snake draft', () => {
    const settlements = devFixtureState.buildings?.settlements ?? {};
    const roads = devFixtureState.buildings?.roads ?? {};
    // 7 settlements remain (one was upgraded to a city below) + 1 city = 8 placements total.
    expect(Object.keys(settlements)).toHaveLength(7);
    expect(Object.keys(roads)).toHaveLength(8);

    const owners = new Set([
      ...Object.values(settlements),
      ...Object.values(devFixtureState.buildings?.cities ?? {}),
    ]);
    expect(owners.size).toBe(4);
  });

  it('upgrades exactly one settlement to a city, owned by player-1', () => {
    const cities = devFixtureState.buildings?.cities ?? {};
    expect(Object.keys(cities)).toHaveLength(1);
    expect(Object.values(cities)).toEqual(['player-1']);
  });
});
