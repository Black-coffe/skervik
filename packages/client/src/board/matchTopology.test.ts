import { describe, expect, it } from 'vitest';

import { topologyForProfile } from './matchTopology.js';

describe('topologyForProfile', () => {
  it("resolves 'classic' to the 19-tile / 54-vertex / 72-edge radius-2 board", () => {
    const topology = topologyForProfile('classic');
    expect(topology.tiles).toHaveLength(19);
    expect(topology.vertices).toHaveLength(54);
    expect(topology.edges).toHaveLength(72);
  });

  it("resolves 'expanded' to the 37-tile / 96-vertex / 132-edge radius-3 board", () => {
    const topology = topologyForProfile('expanded');
    expect(topology.tiles).toHaveLength(37);
    expect(topology.vertices).toHaveLength(96);
    expect(topology.edges).toHaveLength(132);
  });

  // ADR-0013 Invariant 2 — one source of truth: this wraps core's memo, it
  // never keeps a client-side cache of its own. Same profile in ⇒ the SAME
  // object out (deep-equal is not enough; object identity proves no copy).
  it('is referentially stable across calls for the same profile (the core memo, not a copy)', () => {
    expect(topologyForProfile('classic')).toBe(topologyForProfile('classic'));
    expect(topologyForProfile('expanded')).toBe(topologyForProfile('expanded'));
  });

  it('classic and expanded resolve to distinct topologies', () => {
    expect(topologyForProfile('classic')).not.toBe(topologyForProfile('expanded'));
  });
});
