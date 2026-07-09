// S2.2.5 diagnostics — sanity checks for the statistical helpers against
// known reference values, so the McNemar p-value / Wilson CI in the story
// file's diagnostics can be trusted without re-deriving them by hand.
import { describe, expect, it } from 'vitest';

import { chiSquarePValue1df, normalCdf, wilsonInterval } from './metrics.js';

describe('normalCdf', () => {
  it('is 0.5 at z=0', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });

  it('matches the standard 1.96 / 0.975 two-sided-95% reference point', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });

  it('is antisymmetric around 0.5', () => {
    expect(normalCdf(-1.5) + normalCdf(1.5)).toBeCloseTo(1, 6);
  });
});

describe('chiSquarePValue1df', () => {
  it('is 1 at chiSquare=0 (no evidence against the null)', () => {
    expect(chiSquarePValue1df(0)).toBe(1);
  });

  it('matches the standard p=0.05 <-> chiSquare=3.841 threshold (1 df)', () => {
    expect(chiSquarePValue1df(3.841)).toBeCloseTo(0.05, 2);
  });

  it('matches the standard p=0.01 <-> chiSquare=6.635 threshold (1 df)', () => {
    expect(chiSquarePValue1df(6.635)).toBeCloseTo(0.01, 2);
  });
});

describe('wilsonInterval', () => {
  it('centers on the point estimate at p=0.5 and stays symmetric', () => {
    const ci = wilsonInterval(50, 100);
    expect(ci.point).toBeCloseTo(0.5, 6);
    expect(ci.high - ci.point).toBeCloseTo(ci.point - ci.low, 6);
  });

  it('stays within [0,1] even at the extremes', () => {
    const ci = wilsonInterval(0, 100);
    expect(ci.low).toBeGreaterThanOrEqual(0);
    expect(ci.high).toBeLessThanOrEqual(1);
    const ciFull = wilsonInterval(100, 100);
    expect(ciFull.low).toBeGreaterThanOrEqual(0);
    expect(ciFull.high).toBeLessThanOrEqual(1);
  });

  it('n=0 is a degenerate zero-width interval at 0, not a division-by-zero crash', () => {
    expect(wilsonInterval(0, 0)).toEqual({ point: 0, low: 0, high: 0 });
  });
});
