# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status: M0 CLOSED — next is M1 vertical slice (updated 2026-07-03)

Live pnpm monorepo at github.com/Black-coffe/skervik, CI green. **All M0 gates
are done**: E0.1 governance, E0.2 monorepo, E0.3 CI (incl. named core-determinism
gate), E0.5 deterministic engine contract (types, reduce/validate, seeded PRNG
wired into validate per fix-plan A1, event-log replay + golden test), and E0.4 —
Pixi.js v8 perf prototype **validated** (19-hex isometric board in
`packages/client/src/proto/`; benchmark `docs/specs/m0-foundation/S0.4.3-perf-results.md`;
ADR-0002 locked). Lore primer approved (`docs/wiki/lore-primer.md` — realism ≈1900,
no mysticism) and trilingual RU/UA/EN mandate locked (ADR-0008). `protocol/server/bots`
are still stubs; zero game rules exist yet — **that's M1** (start at E1.1 per
`docs/specs/roadmap/ROADMAP-2026-H2.md` August plan).

**Execution plan — when resuming work, start here (no other context needed):**

1. `docs/specs/m1-vertical-slice/plan.md` — **the active plan**: M1 execution
   playbook (epic order, tier routing, domain notes per epic,
   invariant checklists, first stories materialized).
2. `docs/specs/roadmap/ROADMAP-2026-H2.md` — holistic Jul–Dec 2026 plan (7 directions:
   product → M1 slice + closed alpha in Dec, art/brand, marketing, SMM/community,
   funding, infra, Claude Code process), anchored to master-roadmap epic IDs.
3. `docs/specs/roadmap/ROADMAP.md` — engineering master plan M0→1.0 (milestones/epics/stories).
4. `docs/specs/audit/FIX-PLAN-2026-07.md` — 2026-07 audit backlog, all done except
   owner-action items (B1 Discord, B2 Open Collective, B5 good-first-issues).

The two specs in `docs/` remain the source of truth for _what & why_:

- `docs/catan-online-research-phase.md` — Phase 1: product research & vision (player pains → feature answers).
- `docs/catan-online-tech-spec-phase2.md` — Phase 2: full technical spec (architecture, stack, data model, API, roadmap). **Read this before designing anything.**

Both docs are written in **Russian**; the user communicates in Russian. Code,
identifiers, and CLAUDE.md are in English by convention.

## What this is

**Skervik** — an online competitive
"explore — trade — settle" game, mechanically inspired by Catan but built as an
**independent product**: own name, lore, art, setting. The core loop players love
(trading/negotiation, modular board, the robber's drama) is sacred and only gets
amplified; the chronic pains (swingy dice RNG, runaway-leader/kingmaking, dead
time) are explicitly designed out.

### 🔴 Legal constraint (non-negotiable, applies to all art/text/naming)

Game _mechanics_ are not copyrightable, but the **CATAN brand, art, component
trade dress, and specific texts are**. Never name anything "Catan", never copy its
art or wording. All naming/lore/art must be original (setting A: "archipelago of
explorers"). This is why the product exists as its own world.

## Fixed decisions (locked inputs — do not relitigate without the user)

| Decision           | Value                                                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal/monetization | **Open-source, non-commercial**, donation-funded. No pay-to-win, no ads. License: **AGPL-3.0** (locked, ADR-0001). Donations: Open Collective (ADR-0006).                                                                                                                               |
| Setting            | **A — archipelago of explorers** (sea trade, islands). Tone locked 2026-07-03: realism ≈1900 (steam+sail), one Verne-style anomaly (the Mist), **no mysticism** — see `docs/wiki/lore-primer.md`.                                                                                       |
| Languages          | **Trilingual RU / UA / EN from the first playable build** (ADR-0008). Every user-facing string ships in all three locales; every new user-facing term is authored in 3 languages at creation (lore-primer glossary pattern). Engineering docs keep repo conventions (RU docs, EN code). |
| Rendering          | **2.5D isometric** — Pixi.js v8 primary, Three.js only if a perf prototype demands 3D depth.                                                                                                                                                                                            |
| Scope at launch    | **Multi-mode platform from day one** — modes are config, not separate builds; complexity is absorbed by onboarding, not by cutting features.                                                                                                                                            |
| Scale (1M CCU)     | A **marketing ceiling, not a day-1 requirement.** Start cheap ($20–80/mo, one VPS). Architecture stays scalable but **do not over-engineer** for scale early.                                                                                                                           |

## Planned architecture (the big picture)

Five principles drive every design choice — preserve them in any code you write:

1. **Authoritative server** — the server is the single source of truth (anti-cheat, fairness). The client only renders and sends _intents_; it never decides outcomes.
2. **Deterministic isomorphic rule core** — the engine is a pure function `reduce(state, event) → newState`, runnable identically on server (authority) and client (prediction/animation). This is the foundation for replays, prediction, and fairness verification. **Determinism is a hard invariant** — no wall-clock, no ambient randomness in the core; all randomness flows from the seeded PRNG below.
3. **Stateful game rooms, sticky-by-room** — a match lives in one node's memory; all players of a match route to that node (no cross-node match sync). Periphery (auth, lobby, matchmaking, presence) is **stateless** and scales horizontally.
4. **Event sourcing** — every action is an immutable event in a log. This gives replays, RNG-fairness audit, crash recovery, async mode, and analytics for free.
5. **Provably fair RNG (commit-reveal)** — at match start the server generates a crypto `seed`, shows players `seedHash = SHA256(seed)` (commit); all randomness derives deterministically from `seed` + event stream index; after the match the `seed` is revealed so anyone can recompute every roll from the event log. This directly answers the competitor's biggest reputational failure (perceived rigged dice).

### Core engine contract (from spec §4.1)

```typescript
function reduce(state: GameState, event: GameEvent): GameState; // pure, deterministic
function validate(
  state: GameState,
  intent: PlayerIntent,
  playerId: PlayerId,
  seed: Seed, // server-secret PRNG seed; NOT stored in GameState (commit-reveal)
): { ok: true; events: GameEvent[] } | { ok: false; reason: RejectReason };
```

- **Intent** = player's wish (from client) → **validated** server-side → only the resulting **Events** mutate state.
- **`seed` is a `validate` parameter, never a `GameState` field.** Random events (dice) are drawn as `rollDie(seed, state.eventIndex)`. `GameState` carries only the public `seedHash`; the raw `seed` stays a server secret and is passed in, so a client (which serializes `GameState`) can't predict future rolls — this is what makes commit-reveal fair RNG actually fair (FIX-PLAN-2026-07 A1).
- **Rule Profiles are config objects, not code branches** (`classic | balanced | blitz | deep`): randomness mode (`dice | balanced_deck`), catch-up toggles (friendlyRobber, robinHood, finalRound, hiddenVP, catchUpEvents), VP threshold, board size, turn timers, parallel phases. The "multi-mode platform" is one engine configured differently.
- **Adaptive duration**: 60 min is a **hard ceiling** for synchronous online play. Lobby computes the profile (VP threshold, board size, timers, parallelism) from player count × mode to fit the target window; if a config risks exceeding 60 min, the engine lowers VP / tightens timers and warns in the lobby.

## Planned stack & repo layout (from spec §3, §10)

Monorepo via **pnpm workspaces**:

- `packages/core` (`@skervik/core`) — pure-TS rule engine, **zero runtime deps** (reused on client & server; this is what must stay deterministic & isomorphic).
- `packages/protocol` — shared WS/REST message types.
- `packages/server` — Node.js + **Colyseus** (stateful rooms, state-sync, reconnect, matchmaker) + **Fastify** (REST/OpenAPI 3.1).
- `packages/client` — **Pixi.js v8** (2.5D canvas) + **React** (menus/lobby/HUD, kept separate from the game canvas) + **Zustand** (UI state) + **Vite** (build, PWA).
- `infra/` — Docker / docker-compose (start) → Kubernetes (scale), Terraform.

Data: **PostgreSQL** (users, ratings, match metadata, seeds) · **Redis** (presence, matchmaking queues, pub/sub, sticky-routing) · **S3-compatible** object storage (event logs `matches/{id}/events.ndjson`, replays, assets) · **Cloudflare** CDN/WS-proxy. Observability: Prometheus + Grafana + Loki + OpenTelemetry.

Transport: **WSS** for realtime (turn-based → no UDP needed), **HTTPS/REST** for the rest. Serialization **JSON** at start (contributor-friendly) → MessagePack later if traffic demands.

## Tooling (planned — none exists yet)

When scaffolding M0, CI (GitHub Actions) must run: lint, typecheck, **core determinism tests** (replay an event log → identical state), e2e, build. There are no build/test/lint commands to run today; create them with the monorepo skeleton.

## Roadmap anchor (spec §11)

- **M0** — ✅ done (2026-07-03): monorepo, CI, core determinism contract, Pixi perf prototype (ADR-0002 validated).
- **M1** — vertical slice: `@skervik/core` base rules + Colyseus server + WS protocol + 2.5D client + trade UI + commit-reveal RNG → 3–4 players play a Classic match online. _(This is the next concrete work.)_
- **M2** — rule profiles + adaptive duration + catch-up + reconnect/grace/bot-fill + matchmaking/lobby/Redis presence + heuristic bots.
- **M3** — ranked (Glicko-2)/seasons, social, spectator/replays/post-match analytics, 7–10 player modes.
- **M4** — async mode, Deep profile, themes/skins, a11y (colorblind modes), locale QA (RU/UA/EN locales themselves live from M1, ADR-0008), PWA wrappers → 1.0.
- **M5** — horizontal scale (only on demand).

## Things to get right (recurring product intent, so code serves it)

- **Trade UI is the heart of the product**, not a feature — fast, error-proof, expressive (competitors lose users to misclicks here).
- **No "karmic bans" for disconnects** — reconnect with ≥120s grace + bot-fill; safe leave/rejoin.
- **Accessibility from the start** — resources must be distinguishable by more than color (colorblind modes); i18n (RU/UA/EN) baked in, not retrofitted: framework + all three locales ship with M1 (`S1.6.6`, ADR-0008), and no user-facing string ever exists in fewer than three languages.

## UI/UX design constitution (binding for all client UI work)

Root **`PRODUCT.md`** (strategic design context) and **`DESIGN.md`** (visual &
interaction constitution: OKLCH tokens + frozen canvas hex, typography,
game-screen zoning, trade-UI rules, fairness dashboards, motion, a11y/i18n
merge gates, component inventory) are **binding** for every UI diff and UI
story. Reference mockup: `docs/design/mockups/game-table.html`. Authored by
owner-commissioned design pass 2026-07-03; deviations need owner sign-off.

## Orchestration: VULYK thin (since 2026-11-24)

The old **VULYK** hive (0.55.0-dev.3: Queen, tiered workers, councils, `/vulyk-*`
commands, hooks, `scripts/cycle.sh`) was removed; work goes through the VULYK thin
plugin (`vulyk@vulyk-thin`, block at the end of this file). Decisions in `docs/adr/`,
plans/stories in `docs/specs/`, domain notes in `docs/wiki/`. `memory/` is a read-only
archive (index: `memory/memory.md`; module maps in `memory/map/` were last updated in
July 2026 — verify against code).

**Project amendment (owner directive 2026-07-10, kept through the move).** `packages/core`,
`packages/protocol` and anything determinism-bearing (the seed/event contract, RNG, `validate`)
are changed only by the `builder` agent through `/vulyk:go`, at any size: this session never
hand-edits them, and "small obvious fixes skip it" does not apply to them.

## Project profile

- **Project:** Skervik — OSS online "explore-trade-settle" game (Catan-inspired, independent). One sentence: see `docs/specs/roadmap/ROADMAP.md`.
- **Status:** M0 foundation (repo live, CI green; E0.4 = last open gate). Master plan: `docs/specs/roadmap/ROADMAP.md` · H2-2026 plan: `docs/specs/roadmap/ROADMAP-2026-H2.md` · fix backlog: `docs/specs/audit/FIX-PLAN-2026-07.md`. Current milestone: **M0 → M1** (`docs/specs/m0-foundation/`).
- **Stack (planned, ADR-0002/0003/0004):** TypeScript monorepo (pnpm workspaces) — `@skervik/core` (pure deterministic engine), `@skervik/protocol` (zod), `@skervik/server` (Colyseus + Fastify), `@skervik/client` (Pixi.js v8 + React/Zustand + Vite), `@skervik/bots`. Node 22.
- **Verification (real, all green as of 2026-07-02):** build `pnpm -r build` · test `pnpm -r test` (core determinism: `pnpm --filter @skervik/core test`) · lint `pnpm -r lint` · typecheck `pnpm -r typecheck`.
- **Hard invariants (never regress):** deterministic isomorphic core (no wall-clock / no ambient RNG); authoritative server; commit-reveal RNG; event sourcing; rule profiles as config not branches. See `docs/wiki/`.
- **No-go zones (once they exist):** generated output (`dist/`,`build/`), lockfiles, migration history, vendored art assets.
- **Branch/commit:** conventional commits; agents may stage + commit to feature branches; human merges. Docs in RU; code/identifiers in EN.
- **Test reality:** Vitest 4 is the runner; 41 tests green (36 real in core, 5 stub smoke-tests).

## Commands

Quiet variants only: everything these print is resent on every subsequent turn.
(`-s` silences pnpm's own banner noise.)

| Purpose                  | Command                               |
| ------------------------ | ------------------------------------- |
| Single package tests     | `pnpm -s --filter <pkg> test`         |
| Full suite               | `pnpm -s -r test`                     |
| Core determinism gate    | `pnpm -s --filter @skervik/core test` |
| Core has no runtime deps | `pnpm -s check:core-deps`             |
| Lint                     | `pnpm -s -r lint`                     |
| Typecheck                | `pnpm -s typecheck`                   |
| Build                    | `pnpm -s -r build`                    |

## Secrets

Name a secret by its env var (`STRIPE_KEY`), never by value. A secret that reaches git is rotated, not deleted.

## Where things live

Specs, stories, study reports: `docs/specs/<milestone>/` · decisions: `docs/adr/` · domain notes: `docs/wiki/`
· path rules: `.claude/rules/` · module maps (archive, verify against code): `memory/map/`.

## Compact instructions

Keep: the deliverable and goal, the spec slug and each story's state, decisions with reasons and rejected
options, walls hit, open questions to the owner. Drop file contents, diffs, command output: they are on disk.

<!-- vulyk:begin -->

## VULYK

- Work goes through `/vulyk:go`: brief with the owner's words, plan, one approval, build, review by
  another model family, local merge. Small obvious fixes skip it.
- Specs: `docs/specs` (each spec in `<folder>/<slug>/`; `brief.md` keeps the owner's words verbatim and is
  the contract). A project that keeps specs elsewhere writes its folder here.
- Publishing (push, tag, release, deploy) only on the owner's explicit word, each step named.
- Never discard uncommitted work: no `git reset --hard`, `git checkout -- .`, `git clean -f` or
  `git stash drop` on changes that are not committed elsewhere. Ask.
- When the owner corrects your work and says why, record the lesson as a rule: a line in
  `.claude/rules/lessons.md` (at most 60 lines; merge or drop old lines to stay under), or a
  `.claude/rules/<topic>.md` with `paths:` when it applies to certain files. No new hooks or scripts for it:
  a check the project wants goes into its own tests.

<!-- vulyk:end -->
