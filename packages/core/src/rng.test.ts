import { describe, expect, it } from 'vitest';

import { deriveValue, rollDie, shuffle } from './rng.js';

const SEED = 'skervik-golden-seed-1';

describe('deriveValue', () => {
  it('matches fixed golden outputs for a known seed (regression guard)', () => {
    // Hard-coded so a future change to the algorithm is caught as a
    // regression (S0.5.3 acceptance criteria), not silently shipped.
    expect(deriveValue(SEED, 0)).toBe(0.62726592971012);
    expect(deriveValue(SEED, 1)).toBe(0.7036250336095691);
    expect(deriveValue(SEED, 2)).toBe(0.06819626875221729);
    expect(deriveValue(SEED, 3)).toBe(0.6768187638372183);
    expect(deriveValue(SEED, 4)).toBe(0.8770486207213253);
    expect(deriveValue(SEED, 5)).toBe(0.11778039508499205);
    expect(deriveValue(SEED, 6)).toBe(0.527071250602603);
  });

  it('returns a value in [0, 1) for arbitrary indices', () => {
    for (const index of [0, 1, 7, 42, 999, 1_000_000]) {
      const value = deriveValue(SEED, index);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('reproduces the same sequence on repeat calls (same seed -> same outputs)', () => {
    const first = [0, 1, 2, 3, 4].map((i) => deriveValue(SEED, i));
    const second = [0, 1, 2, 3, 4].map((i) => deriveValue(SEED, i));

    expect(second).toEqual(first);
  });

  it('is independent of call order: deriveValue(seed, 5) does not depend on 0..4 having been drawn', () => {
    const direct = deriveValue(SEED, 5);

    // Draw indices 0..4 first this time, then 5 — must be identical.
    for (let i = 0; i < 5; i++) {
      deriveValue(SEED, i);
    }
    const afterPriorDraws = deriveValue(SEED, 5);

    expect(afterPriorDraws).toBe(direct);
    expect(afterPriorDraws).toBe(0.11778039508499205);
  });

  it('produces different sequences for different seeds', () => {
    expect(deriveValue('skervik-golden-seed-2', 0)).toBe(0.8126852160785347);
    expect(deriveValue('skervik-golden-seed-2', 0)).not.toBe(deriveValue(SEED, 0));
  });
});

describe('rollDie', () => {
  it('matches fixed golden outputs for a known seed (regression guard)', () => {
    const rolls = Array.from({ length: 15 }, (_, i) => rollDie(SEED, i));

    expect(rolls).toEqual([4, 5, 1, 5, 6, 1, 4, 4, 1, 1, 3, 4, 3, 2, 3]);
  });

  it('always returns an integer in 1..6', () => {
    for (let i = 0; i < 1000; i++) {
      const value = rollDie(SEED, i);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  it('reproduces the same value for the same (seed, streamIndex) pair', () => {
    expect(rollDie(SEED, 12)).toBe(rollDie(SEED, 12));
  });
});

describe('shuffle', () => {
  it('matches a fixed golden permutation for a known seed (regression guard)', () => {
    const result = shuffle([1, 2, 3, 4, 5, 6, 7, 8], SEED, 10);

    expect(result).toEqual([1, 8, 6, 7, 2, 3, 5, 4]);
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3, 4, 5];
    const before = [...input];

    shuffle(input, SEED, 0);

    expect(input).toEqual(before);
  });

  it('is a permutation: same length and same elements as the input', () => {
    const input = ['a', 'b', 'c', 'd', 'e', 'f'];

    const result = shuffle(input, SEED, 3);

    expect(result).toHaveLength(input.length);
    expect([...result].sort()).toEqual([...input].sort());
  });

  it('reproduces the same permutation for the same (seed, streamIndex)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];

    expect(shuffle(input, SEED, 10)).toEqual(shuffle(input, SEED, 10));
  });
});
