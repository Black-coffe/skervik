# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status: M0 foundation — engine core real, no gameplay yet (updated 2026-07-02)

Live pnpm monorepo at github.com/Black-coffe/skervik, CI green. M0 is almost
closed: E0.1 governance, E0.2 monorepo, E0.3 CI, E0.5 deterministic engine
contract (types, reduce/validate, seeded PRNG, event-log replay + golden
determinism test) are done. **E0.4 (Pixi.js perf prototype) is the last open M0
gate.** 4 of 5 packages (`protocol/server/client/bots`) are stubs; zero game
rules exist yet (that's M1). Known flagship gap: the seeded PRNG is built but
not wired into `validate.ts` (dice use a placeholder formula) — FIX-PLAN item A1.

**Execution plan — when resuming work, start here (no other context needed):**

1. `docs/specs/audit/FIX-PLAN-2026-07.md` — remediation backlog from the 2026-07-02
   audit (A1–A5 technical, B1–B7 product). Execute per its §5 executor instructions,
   recommended order in §6.
2. `docs/specs/roadmap/ROADMAP-2026-H2.md` — holistic Jul–Dec 2026 plan (7 directions:
   product → M1 slice + closed alpha in Dec, art/brand, marketing, SMM/community,
   funding, infra, Claude Code process), anchored to master-roadmap epic IDs.
3. `docs/specs/roadmap/ROADMAP.md` — engineering master plan M0→1.0 (milestones/epics/stories).

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

| Decision           | Value                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal/monetization | **Open-source, non-commercial**, donation-funded. No pay-to-win, no ads. License: **AGPL-3.0** (locked, ADR-0001). Donations: Open Collective (ADR-0006).     |
| Setting            | **A — archipelago of explorers** (sea trade, islands).                                                                                                        |
| Rendering          | **2.5D isometric** — Pixi.js v8 primary, Three.js only if a perf prototype demands 3D depth.                                                                  |
| Scope at launch    | **Multi-mode platform from day one** — modes are config, not separate builds; complexity is absorbed by onboarding, not by cutting features.                  |
| Scale (1M CCU)     | A **marketing ceiling, not a day-1 requirement.** Start cheap ($20–80/mo, one VPS). Architecture stays scalable but **do not over-engineer** for scale early. |

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
): { ok: true; events: GameEvent[] } | { ok: false; reason: RejectReason };
```

- **Intent** = player's wish (from client) → **validated** server-side → only the resulting **Events** mutate state.
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

- **M0** — prototype & gate decisions: Pixi vs Three.js perf prototype, monorepo skeleton, CI, core determinism test. _(This is the next concrete work.)_
- **M1** — vertical slice: `@skervik/core` base rules + Colyseus server + WS protocol + 2.5D client + trade UI + commit-reveal RNG → 3–4 players play a Classic match online.
- **M2** — rule profiles + adaptive duration + catch-up + reconnect/grace/bot-fill + matchmaking/lobby/Redis presence + heuristic bots.
- **M3** — ranked (Glicko-2)/seasons, social, spectator/replays/post-match analytics, 7–10 player modes.
- **M4** — async mode, Deep profile, themes/skins, a11y (colorblind modes), i18n (UA/RU/EN), PWA wrappers → 1.0.
- **M5** — horizontal scale (only on demand).

## Things to get right (recurring product intent, so code serves it)

- **Trade UI is the heart of the product**, not a feature — fast, error-proof, expressive (competitors lose users to misclicks here).
- **No "karmic bans" for disconnects** — reconnect with ≥120s grace + bot-fill; safe leave/rejoin.
- **Accessibility from the start** — resources must be distinguishable by more than color (colorblind modes); i18n (UA/RU/EN) baked in, not retrofitted.

## Orchestration: VULYK hive

This project is set up with the **VULYK** multi-agent orchestration framework
(from github.com/Black-coffe/vulyk). The main session acts as the **Queen**
(planner/dispatcher/integrator) and delegates to tiered subagents. Key entry
points: `/vulyk-bootstrap` (one-time setup interview + codebase map),
`/vulyk-plan` → `/vulyk-build` → `/vulyk-review` (work pipeline), `/vulyk-status`,
`/vulyk-map`, `/vulyk-gc`, `/vulyk-evolve`. Memory lives in `memory/` (index:
`memory/memory.md`); decisions in `docs/adr/`, plans/stories in `docs/specs/`,
domain notes in `docs/wiki/`. The full constitution (laws, complexity routing,
token economy, memory protocol) is imported below.

@CLAUDE.vulyk.md

## Project profile (VULYK bootstrap)

- **Project:** Skervik — OSS online "explore-trade-settle" game (Catan-inspired, independent). One sentence: see `docs/specs/roadmap/ROADMAP.md`.
- **Status:** M0 foundation (repo live, CI green; E0.4 = last open gate). Master plan: `docs/specs/roadmap/ROADMAP.md` · H2-2026 plan: `docs/specs/roadmap/ROADMAP-2026-H2.md` · fix backlog: `docs/specs/audit/FIX-PLAN-2026-07.md`. Current milestone: **M0 → M1** (`docs/specs/m0-foundation/`).
- **Stack (planned, ADR-0002/0003/0004):** TypeScript monorepo (pnpm workspaces) — `@skervik/core` (pure deterministic engine), `@skervik/protocol` (zod), `@skervik/server` (Colyseus + Fastify), `@skervik/client` (Pixi.js v8 + React/Zustand + Vite), `@skervik/bots`. Node 22.
- **Verification (real, all green as of 2026-07-02):** build `pnpm -r build` · test `pnpm -r test` (core determinism: `pnpm --filter @skervik/core test`) · lint `pnpm -r lint` · typecheck `pnpm -r typecheck`.
- **Hard invariants (never regress):** deterministic isomorphic core (no wall-clock / no ambient RNG); authoritative server; commit-reveal RNG; event sourcing; rule profiles as config not branches. See `docs/wiki/`.
- **No-go zones (once they exist):** generated output (`dist/`,`build/`), lockfiles, migration history, vendored art assets.
- **Budget posture:** BALANCED (cap ~4 parallel workers). `TOP_MODEL = claude-opus-4-8` (per constitution).
- **Branch/commit:** conventional commits; agents may stage + commit to feature branches; human merges. Docs in RU; code/identifiers in EN.
- **Test reality:** Vitest 4 is the runner; 41 tests green (36 real in core, 5 stub smoke-tests) — keep `worker-test`.
