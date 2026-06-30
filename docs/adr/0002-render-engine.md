# ADR-0002: Client render engine (2.5D)

- Status: accepted (default engine; E0.4 prototype is a validation gate that may trigger a revisit)
- Date: 2026-06-30 (locked by owner)
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

## Revisit when
- E0.4 benchmark shows Pixi can't hit FMP ≤2.5s / acceptable mobile FPS, or 3D depth becomes a product requirement.
