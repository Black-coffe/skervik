# ADR-0002: Client render engine (2.5D)

- Status: accepted — **validated by the E0.4 benchmark, 2026-07-03; engine locked**
- Date: 2026-06-30 (locked by owner) · validated 2026-07-03
- Spec: docs/specs/roadmap (E0.4)

## Context
The board is 2.5D isometric (locked input). Mobile/low-end web is a priority
audience. We need "premium, not childish" visuals at a low hardware cost. Two
mature WebGL/WebGPU libraries fit: Pixi.js and Three.js.

## Options
1. **Pixi.js v8** — 2D/2.5D-first, lighter, faster on mobile, WebGPU backend in v8. Less natural for true 3D depth.
2. **Three.js** — full 3D; richer depth/lighting; heavier, more GPU/CPU, larger bundle on mobile.

## Decision
**Pixi.js v8** (locked). Deciding factor: tabletop isometry needs sprite/atlas
performance and small bundles on mobile far more than true 3D lighting; v8's WebGPU
path gives headroom. The E0.4 perf prototype is a **validation checkpoint, not a
blocker**: we proceed on Pixi.js v8; only if the prototype shows it cannot meet the
mobile/FMP budget (or 3D depth becomes a product requirement) do we revisit per below.

## Consequences
- Easier: smaller bundles, better low-end FPS, simpler 2.5D pipeline.
- Harder: dramatic 3D effects require faux-depth (layering/shaders) rather than real 3D.
- Debt: art must be authored as 2.5D sprite atlases.

## Invariants created
- Rendering is a pure projection of `GameState`; the canvas never holds authoritative state.
- Bundle-size and FMP budgets (tech spec §1.2) are CI-enforced.

## Validation (E0.4, 2026-07-03)

The 19-hex isometric prototype (`packages/client/src/proto/`, commit `5f99a34`)
passed every budget with margin — LCP 1137 ms on Fast 4G + 4× CPU (budget 2500),
100 avg / 98 1%-low FPS on desktop at both 19 and 133 tiles (WebGPU), worst-case
CPU frame cost 2.9 ms at 4× throttle with a ×7 scene (16.7 ms budget), main
bundle 150 KB gzip. Full numbers & methodology:
`docs/specs/m0-foundation/S0.4.3-perf-results.md`. The Three.js comparison
(S0.4.2) was not triggered. Accepted residual: one real-device Android
spot-check during first alpha.

## Revisit when
- A real-device check contradicts the E0.4 emulated benchmark (FMP >2.5s / mobile FPS clearly below 60), or 3D depth becomes a product requirement.
