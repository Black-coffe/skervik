# Hive memory index

<!-- Pointer index: <= 60 lines, always loaded. Pointers are hints - verify against code before acting.
     Maintained by drone-docs (pointers) and librarian (hygiene). Humans welcome too. -->

## ▶ Resume here (next session)
- **NEXT ACTION: build E0.5 (core engine).** 4 stories materialized & approved in
  `docs/specs/m0-foundation/S0.5.1..S0.5.4`. Build **sequentially** (all touch `packages/core/src` + `index.ts`):
  S0.5.1 types → S0.5.2 reduce/validate → S0.5.3 seeded PRNG → S0.5.4 event-log + replay + golden fixture.
  Then full verify + `lead-review` + commit. Run: `/vulyk-build` on E0.5 (Queen dispatches worker-code per story).
- After E0.5: **E0.3** (CI — first create GitHub repo `Black-coffe/skervik`, then GH Actions) · **E0.4** (Pixi 2.5D prototype, validates ADR-0002).

## Project
- **Skervik** — OSS online "explore-trade-settle" game (Catan-inspired, independent). Domain skervik.com (reg 2026-06-30, exp 2028).
- Monorepo: pnpm 10.29.1, Node 22, TS, scope `@skervik/*`. Windows dev — see global memory `vulyk-windows-hooks`.

## Active plan
- Roadmap: `docs/specs/roadmap/ROADMAP.md` (zero → 1.0). Milestone **M0**, detail `docs/specs/m0-foundation/plan.md`.
- M0: **E0.1 ✅** (governance+name) · **E0.2 ✅** (monorepo) · E0.3 ⏳ · E0.4 ⏳ · **E0.5 ⏳ NEXT**.
- Why/what: `docs/catan-online-research-phase.md` · `docs/catan-online-tech-spec-phase2.md`.

## Codebase map (skeleton only — NO game logic yet)
- `packages/core` `@skervik/core` — pure engine, **zero runtime deps** (only a version placeholder).
- `packages/{protocol,server,client,bots}` — `@skervik/*` skeletons; client = Vite+React+PWA placeholder page.
- Tooling: ESLint flat (+ADR-0003 core guard), Prettier, Vitest 4, tsup(libs)+Vite(client), husky+commitlint.

## Decisions (docs/adr/) — all accepted
- 0001 AGPL-3.0 · 0002 Pixi.js v8 (E0.4 validates) · 0003 deterministic isomorphic core · 0004 Node+Colyseus+Fastify · 0005 Google+Discord+guest · 0006 Open Collective · 0007 name=Skervik.

## Wiki (docs/wiki/) — hard invariants, enforce in every core change
- `deterministic-core.md` · `fair-rng-commit-reveal.md` · `server-authority.md`.

## Verification (REAL — all green as of 2026-06-30)
- `pnpm -r typecheck` · `pnpm -r lint` · `pnpm -r test` · `pnpm -r build` (core: `pnpm --filter @skervik/core test`).

## No-go zones
- generated output (`dist/`,`build/`), lockfile (auto), vendored VULYK (`.claude/`,`templates/`,`bootstrap/`,`AGENTS.md`,`CLAUDE.vulyk.md`), migrations (later).

## Learnings
- Consolidated: memory/learnings/CONSOLIDATED.md (run /vulyk-gc to refresh).
