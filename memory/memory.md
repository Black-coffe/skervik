# Hive memory index

<!-- Pointer index: <= 60 lines, always loaded. Pointers are hints - verify against code before acting.
     Maintained by drone-docs (pointers) and librarian (hygiene). Humans welcome too. -->

## Project
- Archipelago — OSS online "explore-trade-settle" game (Catan-inspired, legally independent).
- Status: GREENFIELD (no code yet). Plan-first. Docs are source of truth.

## Active plan
- Master roadmap: `docs/specs/roadmap/ROADMAP.md` (zero → 1.0).
- Current milestone: **M0 — foundation**, materialized in `docs/specs/m0-foundation/`.
- Product/why: `docs/catan-online-research-phase.md`; engineering/what: `docs/catan-online-tech-spec-phase2.md`.

## Codebase map
- (no modules yet) Planned packages (ADR-0003): `@arch/core` (pure engine), `@arch/protocol`, `@arch/server`, `@arch/client`, `@arch/bots`; `infra/`, `tools/`.

## Decisions (docs/adr/) — all accepted
- 0001 license = **AGPL-3.0** · 0002 engine = **Pixi.js v8** (E0.4 validates) · 0003 deterministic isomorphic core · 0004 realtime = **Node+Colyseus+Fastify** · 0005 auth = **Google+Discord+guest** · 0006 donations = **Open Collective**.
- Only open product decision: **project name/brand** (codename "Archipelago", scope `@arch/*`).

## Wiki domains (docs/wiki/)
- `deterministic-core.md` — purity/determinism invariants of @arch/core.
- `fair-rng-commit-reveal.md` — provable-fairness RNG protocol.
- `server-authority.md` — authoritative-server / anti-cheat invariant.

## Verification (PLANNED — real after M0 E0.2; treat as targets until then)
- build: `pnpm -r build`
- test: `pnpm -r test`   (core determinism: `pnpm --filter @arch/core test`)
- lint: `pnpm -r lint`   ·   typecheck: `pnpm -r typecheck`

## No-go zones (once they exist)
- generated output (`dist/`, `build/`), lockfiles (auto), migration history, vendored art assets.

## Unmapped territory
- everything (greenfield) — map each package as it is scaffolded.

## Learnings
- Consolidated: memory/learnings/CONSOLIDATED.md (run /vulyk-gc to refresh)
