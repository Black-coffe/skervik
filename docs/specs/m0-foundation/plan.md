---
spec: m0-foundation
status: todo
tier: 4
milestone: M0
related: docs/specs/roadmap/ROADMAP.md
---

# M0 — Foundation & validation (detailed plan)

Goal: turn an empty repo into a validated foundation — a TypeScript monorepo with
CI (including the core determinism test), the deterministic engine contract, a
render-engine decision backed by a perf prototype, and the locked governance
decisions. **No gameplay yet** — M0 ends when the gate is green.

## Build order (dependency graph)

```
E0.1 governance ─┐                         (parallel, no code deps)
E0.2 monorepo ───┼─▶ E0.3 CI ─┐
E0.5 core   ─────┘            ├─▶ S0.3.2 determinism test (needs S0.5.4 fixture)
E0.4 render prototype ────────┘  (gates ADR-0002 before M1)
```
Start at **E0.2** (unblocks everything). E0.1 can run in parallel. E0.5 right
after the skeleton. E0.3 once packages + first tests exist. E0.4 anytime; its ADR
must be accepted before M1.

## Stories (small steps)

### E0.1 — Governance & locked decisions
| ID | Status | Tier | Goal | Acceptance |
|---|---|---|---|---|
| S0.1.1 | ✅ done | T2 | Decide license | ADR-0001 accepted; `LICENSE` (AGPL-3.0 full text) present |
| S0.1.2 | 🚧 partial | T2 | Project name/brand + reserve handles | `README.md` created with codename "Archipelago"; **final name + domain/handles still pending (owner)** |
| S0.1.3 | ✅ done | T2 | OAuth + donations providers | ADR-0005 + ADR-0006 accepted |
| S0.1.4 | ✅ done | T1 | Community docs | `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md` present + linked from `README.md` |

### E0.2 — Monorepo & tooling skeleton  *(story files materialized in this folder)*
| ID | Tier | Goal | Acceptance |
|---|---|---|---|
| S0.2.1 | T2 | pnpm workspace + 5 package skeletons + root tsconfig | `pnpm i` clean; `@arch/*` resolve |
| S0.2.2 | T1 | ESLint flat + Prettier + editorconfig | `pnpm -r lint` clean |
| S0.2.3 | T1 | Vitest per package + smoke tests | `pnpm -r test` green |
| S0.2.4 | T1 | Build (tsup/tsc libs, Vite client) + aliases | `pnpm -r build` green; `pnpm --filter @arch/client dev` serves |
| S0.2.5 | T1 | Pre-commit (lint-staged) + commit-msg lint | bad commit rejected locally |

### E0.3 — CI/CD foundation
| ID | Tier | Goal | Acceptance |
|---|---|---|---|
| S0.3.1 | T2 | GH Actions: install→typecheck→lint→test | CI green on trivial PR |
| S0.3.2 | T2 | Core determinism test in CI (golden replay) | CI red if core nondeterministic (needs S0.5.4) |
| S0.3.3 | T1 | Client preview deploy (Cloudflare Pages) | PR posts preview URL |
| S0.3.4 | T0 | Dependabot/Renovate + CodeQL | configs merged; first scan runs |
| S0.3.5 | T1 | **CI guard: `@arch/core` has no runtime `dependencies`** (enforces 2nd half of ADR-0003) — *from E0.2 review* | CI red if core gains a runtime dep |
| S0.3.6 | T0 | `prettier --check` in CI — *from E0.2 review* | CI red on any unformatted file |

> **E0.2 review follow-up (nit #3):** add a type-only cross-package import of `@arch/core`
> from a sibling (in a smoke test) to prove the workspace+alias wiring end-to-end — fold into E0.5 S0.5.1.

### E0.4 — Render prototype gate (Pixi vs Three)
| ID | Tier | Goal | Acceptance |
|---|---|---|---|
| S0.4.1 | T2 | Pixi.js v8 static 2.5D 19-tile board | renders desktop + mid mobile |
| S0.4.2 | T2 | *(optional)* Three.js comparison | same scene renders |
| S0.4.3 | T2 | Perf harness + ADR-0002 decision | ADR accepted; engine locked |

### E0.5 — Core engine contract skeleton
| ID | Tier | Goal | Acceptance |
|---|---|---|---|
| S0.5.1 | T2 | `GameState`/`GameEvent`/`PlayerIntent`/`RejectReason` types | compile + exported |
| S0.5.2 | T2 | `reduce`/`validate` signatures + no-op + determinism scaffold | matches ADR-0003 |
| S0.5.3 | T2 | Seeded PRNG + stream-index derivation + tests | same seed+index → same sequence |
| S0.5.4 | T2 | Event-log ndjson format + `replay()` + golden fixture | replay reproduces state; feeds S0.3.2 |

## Exit gate (M0 → M1)
- [ ] `pnpm i && pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm -r build` all green locally and in CI.
- [ ] Core determinism (golden-replay) test passing in CI.
- [ ] ADR-0001 (license), ADR-0002 (engine), ADR-0003 (core) accepted; LICENSE applied.
- [ ] Project name decided; README + community docs present.
- [ ] `pnpm --filter @arch/client dev` renders an empty 2.5D board.

## How to build this
`/vulyk-build` on the E0.2 story files here first; then `/vulyk-plan m0-foundation`
to materialize E0.3/E0.4/E0.5 story files (or build directly from the tables above —
they carry files + acceptance). Review each with `/vulyk-review` before merge.
