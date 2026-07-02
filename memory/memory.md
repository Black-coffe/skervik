# Hive memory index

<!-- Pointer index: <= 60 lines, always loaded. Pointers are hints - verify against code before acting.
     Maintained by drone-docs (pointers) and librarian (hygiene). Humans welcome too. -->

## ▶ Resume here (next session)
- **NEXT ACTION: execute `docs/specs/audit/FIX-PLAN-2026-07.md`** (audit 2026-07-02 @ 2d70e48).
  Follow its §5 executor rules (one item = one branch/commit, scope-locked, CI green);
  recommended order §6: A3 → A4 → A5 → B1 → B2 → **A1 (wire rollDie into validate.ts —
  flagship fair-RNG is disconnected)** → A2 → B7 → B3 → B6 → B5 (B4 blocked on E0.4).
- Then **E0.4** (Pixi 2.5D perf prototype — the LAST open M0 gate, validates ADR-0002): `/vulyk-plan E0.4`.
- Then **M1** per `docs/specs/roadmap/ROADMAP-2026-H2.md` (month-by-month: Aug board+economy
  E1.1/E1.2 → Sep robber/trade/victory E1.3 → Oct server+commit-reveal E1.4/E1.5 → Nov client
  E1.6 → Dec M1 gate + closed alpha + M2 start).

## Project
- **Skervik** — OSS online "explore-trade-settle" game (Catan-inspired, independent). Domain skervik.com (reg 2026-06-30, exp 2028).
- Repo LIVE: github.com/Black-coffe/skervik (public, AGPL-3.0, CI green).
- Monorepo: pnpm 10.29.1, Node 22, TS, scope `@skervik/*`. Windows dev — see global memory `vulyk-windows-hooks`.

## Active plan
- Master roadmap: `docs/specs/roadmap/ROADMAP.md` (zero → 1.0) · **H2-2026 plan:
  `docs/specs/roadmap/ROADMAP-2026-H2.md`** (Jul–Dec, 7 directions: product/art/marketing/
  SMM/funding/infra/process, KPIs, risks) · **fix backlog: `docs/specs/audit/FIX-PLAN-2026-07.md`**.
- M0: **E0.1 ✅ · E0.2 ✅ · E0.3 ✅ (CI) · E0.5 ✅ (core contract) · E0.4 ⏳ LAST GATE**.
- Why/what: `docs/catan-online-research-phase.md` · `docs/catan-online-tech-spec-phase2.md`.

## Codebase map (core is real; other 4 packages are stubs — NO game rules yet)
- `packages/core` `@skervik/core` — REAL engine infra, **zero runtime deps** (CI-guarded):
  types (GameState/GameEvent/PlayerIntent), pure reduce/validate, seeded PRNG (mulberry32
  counter-mode, `rng.ts`), ndjson replay + golden determinism fixture. 36 tests.
  **Known gap:** `validate.ts:64` dice = placeholder formula, NOT `rollDie` (FIX-PLAN A1).
  Game rules (resources/build/trade/robber/VP) = 0%, scheduled M1.
- `packages/{protocol,server,client,bots}` — stubs (version const + smoke test); real work:
  protocol S1.5.1, server E1.4, client E0.4/E1.6, bots E2.4.
- Tooling: ESLint flat (+ADR-0003 core guard), Prettier, Vitest 4, tsup(libs)+Vite(client), husky+commitlint.

## Decisions (docs/adr/) — all accepted
- 0001 AGPL-3.0 · 0002 Pixi.js v8 (E0.4 validates) · 0003 deterministic isomorphic core · 0004 Node+Colyseus+Fastify · 0005 Google+Discord+guest · 0006 Open Collective · 0007 name=Skervik.

## Wiki (docs/wiki/) — hard invariants, enforce in every core change
- `deterministic-core.md` · `fair-rng-commit-reveal.md` · `server-authority.md`.

## Verification (REAL — all green as of 2026-07-02, verified by audit)
- `pnpm -r typecheck` · `pnpm -r lint` · `pnpm -r test` · `pnpm -r build` (core: `pnpm --filter @skervik/core test`).

## No-go zones
- generated output (`dist/`,`build/`), lockfile (auto), vendored VULYK (`.claude/`,`templates/`,`bootstrap/`,`AGENTS.md`,`CLAUDE.vulyk.md`), migrations (later).

## Learnings
- Consolidated: memory/learnings/CONSOLIDATED.md (run /vulyk-gc to refresh).
