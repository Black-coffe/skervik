# Hive memory index

<!-- Pointer index: <= 60 lines, always loaded. Pointers are hints - verify against code before acting.
     Maintained by drone-docs (pointers) and librarian (hygiene). Humans welcome too. -->

## ▶ Resume here (next session)
- **NEXT ACTION: execute `docs/specs/m1-vertical-slice/plan.md`** (the M1 Queen playbook: epic order, domain notes, invariants; stories S1.1.1–S1.1.3 are materialized next to it, ready to dispatch to worker-code). **The Queen writes NO code — specs/orchestration only; all code via worker-code subagents (owner directive 2026-07-03, see CLAUDE.vulyk.md).**
- Fix-plan `docs/specs/audit/FIX-PLAN-2026-07.md`: everything done except owner-action items B1 (Discord), B2 (Open Collective), B5 (good-first-issues).
- Month map (H2 roadmap §2): Aug E1.1/E1.2 → Sep E1.3+E1.4 start → Oct E1.4/E1.5 → Nov E1.6 client → Dec E1.7 M1-gate + closed alpha.

## Project
- **Skervik** — OSS online "explore-trade-settle" game (Catan-inspired, independent). Domain skervik.com (reg 2026-06-30, exp 2028).
- Repo LIVE: github.com/Black-coffe/skervik (public, AGPL-3.0, CI green).
- Monorepo: pnpm 10.29.1, Node 22, TS, scope `@skervik/*`. Windows dev — see global memory `vulyk-windows-hooks`.

## Active plan
- Master roadmap: `docs/specs/roadmap/ROADMAP.md` (zero → 1.0) · **H2-2026 plan:
  `docs/specs/roadmap/ROADMAP-2026-H2.md`** (Jul–Dec, 7 directions: product/art/marketing/
  SMM/funding/infra/process, KPIs, risks) · **fix backlog: `docs/specs/audit/FIX-PLAN-2026-07.md`** · **M1 plan: `docs/specs/m1-vertical-slice/plan.md`**.
- M0 ✅ CLOSED 2026-07-03 (all gates incl. E0.4 Pixi prototype — benchmark `docs/specs/m0-foundation/S0.4.3-perf-results.md`, ADR-0002 validated/locked). Now: **M1 vertical slice — `docs/specs/m1-vertical-slice/plan.md`**.
- Why/what: `docs/catan-online-research-phase.md` · `docs/catan-online-tech-spec-phase2.md`.

## Codebase map (core is real; other 4 packages are stubs — NO game rules yet)
- **Map slice: `memory/map/core.md`** (last-verified 2026-07-03, taken mid-S1.2.1 — full file/type/test inventory + 10 gotchas; re-verify after S1.2.x merges).
- `packages/core` `@skervik/core` — REAL engine infra, **zero runtime deps** (CI-guarded):
  types (GameState/GameEvent/PlayerIntent), pure reduce/validate, seeded PRNG (mulberry32
  counter-mode, `rng.ts`, rollDie wired as validate.ts 4th param), ndjson replay + golden determinism fixture. 36 tests.
  Game rules (resources/build/trade/robber/VP) = 0%, scheduled M1.
- `packages/protocol` stub (type defs next S1.5.1); `packages/server` stub (real E1.4); `packages/client` E0.4 perf prototype real (Pixi.js v8, 19-hex isometric, pixi.js dep live) + product client E1.6 TBD; `packages/bots` stub (real E2.4).
- Tooling: ESLint flat (+ADR-0003 core guard), Prettier, Vitest 4, tsup(libs)+Vite(client), husky+commitlint.

## Decisions (docs/adr/) — all accepted
- 0001 AGPL-3.0 · 0002 Pixi.js v8 (validated by E0.4 2026-07-03, locked) · 0003 deterministic isomorphic core · 0004 Node+Colyseus+Fastify · 0005 Google+Discord+guest · 0006 Open Collective · 0007 name=Skervik · 0008 trilingual RU/UA/EN from first playable build (locales ship in M1 S1.6.6; every user-facing term authored in 3 languages).

## Wiki (docs/wiki/) — hard invariants, enforce in every core change
- `deterministic-core.md` · `fair-rng-commit-reveal.md` · `server-authority.md` · `lore-primer.md` (approved setting: realism ≈1900, steam+sail, NO mysticism; trilingual glossary = source of all user-facing names) · `ip-tradedress-checklist.md` (run on first concept art).

## Design constitution (docs/design/) — binding for all client UI work (owner-approved Queen exception 2026-07-03)
- `PRODUCT.md` (strategic context: register/users/brand personality «weathered · precise · fair»; 6 design principles; legal red lines incl. CATAN trade dress; a11y & inclusion).
- `DESIGN.md` (visual & interaction constitution: mood formula «chart-room at dusk ≈1900»; §1 two-surface model; §2 OKLCH tokens + frozen sRGB hex (flotilla/resource palettes §2.2–2.3); §3 typography (Inter/PT Serif/JetBrains Mono, full RU+UA, self-hosted OFL); §4 space/shape/depth; §5 iconography; §6 game-screen layout; §7 trade-UI rules; §8 fairness/realtime dashboards; §9 motion; §10 a11y+i18n merge gates; §11 component inventory; §12 E0.4 proto verdict; §13 slop test).
- Reference: `docs/design/mockups/game-table.html` (self-contained browser mockup).
- **BINDING REQUIREMENT:** every S1.6.x story must cite DESIGN.md sections; deviations require owner sign-off (not worker judgment). See M1 plan E1.6 node.

## Verification (REAL — all green as of 2026-07-03, all gates validated incl. CI named "Core determinism gate")
- `pnpm -r typecheck` · `pnpm -r lint` · `pnpm -r test` · `pnpm -r build` (core: `pnpm --filter @skervik/core test`).

## No-go zones
- generated output (`dist/`,`build/`), lockfile (auto), vendored VULYK (`.claude/`,`templates/`,`bootstrap/`,`AGENTS.md`,`CLAUDE.vulyk.md`), migrations (later).

## Learnings
- Consolidated: memory/learnings/CONSOLIDATED.md (run /vulyk-gc to refresh).
