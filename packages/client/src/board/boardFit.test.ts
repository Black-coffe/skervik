import { describe, expect, it } from 'vitest';

import {
  computeFieldExtent,
  fitFieldToBox,
  MAX_FIT_SCALE,
  seaRadiusForExtent,
} from './boardFit.js';
import { topologyForProfile } from './matchTopology.js';

// S2.7.1's dock geometry, mirrored (BoardScene.ts): 372px width + 16px left +
// 20px gutter.
const TRADE_DOCK_RESERVE_PX = 372 + 16 + 20;

describe('computeFieldExtent', () => {
  it('produces a finite, positive-area bounding box for both Classic and expanded', () => {
    for (const profileId of ['classic', 'expanded'] as const) {
      const extent = computeFieldExtent(topologyForProfile(profileId));
      expect(Number.isFinite(extent.minX)).toBe(true);
      expect(Number.isFinite(extent.maxX)).toBe(true);
      expect(Number.isFinite(extent.minY)).toBe(true);
      expect(Number.isFinite(extent.maxY)).toBe(true);
      expect(extent.maxX).toBeGreaterThan(extent.minX);
      expect(extent.maxY).toBeGreaterThan(extent.minY);
    }
  });

  it('the expanded (37-tile) field extent is strictly larger than Classic (19-tile) in both axes', () => {
    const classic = computeFieldExtent(topologyForProfile('classic'));
    const expanded = computeFieldExtent(topologyForProfile('expanded'));
    expect(expanded.maxX - expanded.minX).toBeGreaterThan(classic.maxX - classic.minX);
    expect(expanded.maxY - expanded.minY).toBeGreaterThan(classic.maxY - classic.minY);
  });
});

describe('fitFieldToBox', () => {
  // S2.7.2 AC1 / F1: at 1280px chart width with the dock shown, the fitted
  // field (tiles + port markers) must fit inside `chartWidth − dockReserve`
  // x `chartHeight` with no overlap — the case that was UNFIXABLE at a fixed
  // scale=1 (S2.7.1 finding F1).
  it('AC1: Classic fits inside the 1280px chart box beside the dock, no overlap', () => {
    const extent = computeFieldExtent(topologyForProfile('classic'));
    const chartWidth = 1280 - 280 - 320; // GameScreen.css grid columns
    const chartHeight = 760;
    const box = {
      x: TRADE_DOCK_RESERVE_PX,
      y: 0,
      width: chartWidth - TRADE_DOCK_RESERVE_PX,
      height: chartHeight,
    };
    const fit = fitFieldToBox(extent, box);

    // Recompute the fitted field's own bounding box from the fit result and
    // assert it sits fully inside `box` — the direct statement of "no
    // overlap with the dock".
    const left = fit.x + extent.minX * fit.scale;
    const right = fit.x + extent.maxX * fit.scale;
    const top = fit.y + extent.minY * fit.scale;
    const bottom = fit.y + extent.maxY * fit.scale;

    expect(left).toBeGreaterThanOrEqual(box.x - 1e-6);
    expect(right).toBeLessThanOrEqual(box.x + box.width + 1e-6);
    expect(top).toBeGreaterThanOrEqual(box.y - 1e-6);
    expect(bottom).toBeLessThanOrEqual(box.y + box.height + 1e-6);
  });

  // The case that motivated folding S2.7.2 into S2.1.7b: the expanded
  // 37-tile board must ALSO fit at 1280px beside the dock, not just Classic.
  it('the expanded 37-tile field also fits inside the 1280px chart box beside the dock', () => {
    const extent = computeFieldExtent(topologyForProfile('expanded'));
    const chartWidth = 1280 - 280 - 320;
    const chartHeight = 760;
    const box = {
      x: TRADE_DOCK_RESERVE_PX,
      y: 0,
      width: chartWidth - TRADE_DOCK_RESERVE_PX,
      height: chartHeight,
    };
    const fit = fitFieldToBox(extent, box);

    const left = fit.x + extent.minX * fit.scale;
    const right = fit.x + extent.maxX * fit.scale;
    const top = fit.y + extent.minY * fit.scale;
    const bottom = fit.y + extent.maxY * fit.scale;

    expect(left).toBeGreaterThanOrEqual(box.x - 1e-6);
    expect(right).toBeLessThanOrEqual(box.x + box.width + 1e-6);
    expect(top).toBeGreaterThanOrEqual(box.y - 1e-6);
    expect(bottom).toBeLessThanOrEqual(box.y + box.height + 1e-6);
  });

  it('centers the field in the box (no dock): fit result places the extent center at the box center', () => {
    const extent = computeFieldExtent(topologyForProfile('classic'));
    const box = { x: 0, y: 0, width: 1000, height: 800 };
    const fit = fitFieldToBox(extent, box);
    const centerX = (extent.minX + extent.maxX) / 2;
    const centerY = (extent.minY + extent.maxY) / 2;
    expect(fit.x + centerX * fit.scale).toBeCloseTo(box.width / 2, 5);
    expect(fit.y + centerY * fit.scale).toBeCloseTo(box.height / 2, 5);
  });

  it('offsets the box origin correctly when the box does not start at (0, 0) — e.g. beside the dock', () => {
    const extent = computeFieldExtent(topologyForProfile('classic'));
    const boxAtOrigin = { x: 0, y: 0, width: 900, height: 800 };
    const boxShifted = { x: 300, y: 0, width: 900, height: 800 };
    const fitAtOrigin = fitFieldToBox(extent, boxAtOrigin);
    const fitShifted = fitFieldToBox(extent, boxShifted);
    expect(fitShifted.scale).toBe(fitAtOrigin.scale);
    expect(fitShifted.x).toBeCloseTo(fitAtOrigin.x + 300, 5);
    expect(fitShifted.y).toBeCloseTo(fitAtOrigin.y, 5);
  });

  // S2.7.2 AC3: wide screens (>=1920) must not blow the board up
  // disproportionately — a max-scale cap keeps it sane.
  it('AC3: caps scale at MAX_FIT_SCALE for a very large box (>=1920px-class viewport)', () => {
    const extent = computeFieldExtent(topologyForProfile('classic'));
    const box = { x: 0, y: 0, width: 4000, height: 3000 };
    const fit = fitFieldToBox(extent, box);
    expect(fit.scale).toBe(MAX_FIT_SCALE);
  });

  it('a custom maxScale option overrides the default cap', () => {
    const extent = computeFieldExtent(topologyForProfile('classic'));
    const box = { x: 0, y: 0, width: 4000, height: 3000 };
    const fit = fitFieldToBox(extent, box, { maxScale: 0.5 });
    expect(fit.scale).toBe(0.5);
  });

  it('below the cap, scale is the largest value that still fits both axes (the binding axis wins)', () => {
    const extent = computeFieldExtent(topologyForProfile('classic'));
    const fieldWidth = extent.maxX - extent.minX;
    const fieldHeight = extent.maxY - extent.minY;
    // A box much narrower (relative to the field) than it is tall — width binds.
    const box = { x: 0, y: 0, width: fieldWidth, height: fieldHeight * 10 };
    const fit = fitFieldToBox(extent, box);
    expect(fit.scale).toBeCloseTo(1, 5);
  });
});

describe('seaRadiusForExtent', () => {
  it('grows for the expanded (37-tile) field vs Classic (19-tile) — the sea ring surrounds the bigger board too', () => {
    const classicRadius = seaRadiusForExtent(
      computeFieldExtent(topologyForProfile('classic')),
    );
    const expandedRadius = seaRadiusForExtent(
      computeFieldExtent(topologyForProfile('expanded')),
    );
    expect(expandedRadius).toBeGreaterThan(classicRadius);
  });

  it('is always larger than half the field bounding box diagonal (covers every corner)', () => {
    const extent = computeFieldExtent(topologyForProfile('classic'));
    const halfDiagonal = Math.hypot(
      (extent.maxX - extent.minX) / 2,
      (extent.maxY - extent.minY) / 2,
    );
    expect(seaRadiusForExtent(extent)).toBeGreaterThan(halfDiagonal);
  });
});
