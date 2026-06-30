---
spec: roadmap
status: in-progress
owner: Queen (main session)
horizon: zero → 1.0 public release
---

# Skervik — Master Roadmap (zero → releasable 1.0)

> **What this is.** The complete development plan from an empty repo to a
> production-ready 1.0 you can launch publicly and start onboarding players —
> not an alpha, not a beta, not an MVP. Large steps = **milestones (M0–M4)**
> and **epics (E)**; small steps = **stories (S)**, each a 0.5–3 day unit sized
> for one VULYK worker.
>
> **Source of truth for *what & why*:** `docs/catan-online-research-phase.md`
> (Phase 1) and `docs/catan-online-tech-spec-phase2.md` (Phase 2). This file is
> the *how & in what order*. When they disagree, the tech spec wins for
> engineering, the research doc wins for product intent.
>
> **How to read:** skim the Milestone Overview + Definition of Done first, then
> the milestone you're working on. Each story has an ID (`S<m>.<e>.<n>`), a
> tier `[T0–T4]`, and acceptance criteria. Stories are materialized into
> `docs/specs/<slug>/` per epic, **just-in-time** (via `/vulyk-plan`) right
> before they're built — M0 is already materialized in `docs/specs/m0-foundation/`.

---

## 0. Product pillars (never break these)

From Phase 1 — every story serves at least one; none may regress them:

1. **Trade is the heart**, not a feature — fast, error-proof, expressive UI.
2. **Provably fair RNG** — commit-reveal seed, recomputable from the event log.
3. **Catch-up over runaway-leader** — friendly robber, poverty tokens, final round, hidden VP (all profile-gated).
4. **No dead time** — parallel phases, turn timers, adaptive duration (**≤60 min hard cap**).
5. **No karmic bans** — reconnect + grace ≥120s + bot-fill; safe leave/rejoin.
6. **Own world** — original name/lore/art (legal independence from Catan IP).
7. **Accessible & honest** — colorblind-safe, i18n UA/RU/EN, OSS, no pay-to-win.

## 1. Architecture invariants (enforced by every worker)

These are **hard invariants** — see `docs/wiki/` and `docs/adr/`:

- **Authoritative server** — client renders & sends *intents*; only the server emits *events* that mutate state. (`docs/wiki/server-authority.md`)
- **Deterministic isomorphic core** — `@skervik/core` is `reduce(state, event) → state`, pure, zero runtime deps, identical on client & server. No wall-clock, no ambient randomness. (`docs/wiki/deterministic-core.md`, ADR-0003)
- **Event sourcing** — every action is an immutable event; replays/audit/recovery/async fall out of it for free.
- **Commit-reveal RNG** — `seedHash` shown before the match, `seed` revealed after; all randomness derives from `seed` + event-stream index. (`docs/wiki/fair-rng-commit-reveal.md`)
- **Profiles are config, not branches** — one engine, behavior configured by `RuleProfile`.

## 2. Package architecture (monorepo, pnpm workspaces) — ADR-0003

| Package | Role | Depends on |
|---|---|---|
| `@skervik/core` | Pure deterministic rule engine (state, events, intents, reduce/validate, PRNG, replay). **Zero runtime deps.** | — |
| `@skervik/protocol` | Shared WS/REST message types + runtime validation (zod). | core (types) |
| `@skervik/server` | Colyseus rooms (stateful) + Fastify REST (stateless). | core, protocol |
| `@skervik/client` | Pixi.js v8 (2.5D canvas) + React/Zustand HUD + Vite/PWA. | core, protocol |
| `@skervik/bots` | AI (heuristic → MCTS) in a worker; consumes core. | core |
| `infra/` | Docker/compose → k8s, Terraform (IaC). | — |
| `tools/` | CLIs: seed-verifier, replay-player, balance-sim. | core |

## 3. Milestone overview (large steps)

| M | Theme | Outcome (gate to pass) | Target window |
|---|---|---|---|
| **M0** | Foundation & validation | CI green w/ determinism test; render-engine ADR locked; license+name decided; empty match renders locally | weeks 1–4 |
| **M1** | Vertical slice | 3–4 players finish a full **Classic** match online, deterministic, seed-verifiable, working trade UI | weeks 4–12 |
| **M2** | Mode platform & resilience | Multi-mode (Classic/Balanced/Blitz), adaptive duration, catch-up, reconnect+bot-fill, matchmaking/lobby, bots, accounts; 2–6 players | weeks 12–22 |
| **M3** | Competitive & social | Ranked (Glicko-2)/seasons/leagues, friends/guilds/chat/anti-toxicity, spectator/replay/analytics, 7–10p + team | weeks 22–32 |
| **M4** | Polish, a11y, content → **1.0** | Async, Deep profile, premium art/skins, colorblind+i18n, perf ≤NFR, PWA/stores, ops+legal+launch | weeks 32–44 |
| M5 | Scale (post-launch) | Horizontal shard, managed PG/Redis, k8s, autoscale — *only on CCU demand* | as needed |

> Windows are indicative effort ordering for a small core team (tech spec est.
> ~16–25 person-months to 1.0), **not calendar commitments**. Each milestone is a
> playable increment; never start a milestone until the prior gate is green.

## 4. Definition of Done — "releasable 1.0"

A checklist that distinguishes "real product" from MVP/beta. All must be true:

- [ ] **Feature-complete** per M0–M4 (all gates green).
- [ ] **NFRs met & load-tested** — action p95 ≤150ms regional; FMP ≤2.5s on 4G; reconnect ≥120s; one node sustains 200–2000 CCU (tech spec §1.2).
- [ ] **Fairness provable** — every finished match's seed recomputes its rolls from the public event log (`/matches/{id}/verify`).
- [ ] **Resilience** — crash-free reconnect, no state loss, bot-fill, graceful leave/rejoin; chaos-tested.
- [ ] **Security & anti-cheat** — server-authoritative validated; hidden info never sent; rate-limited; `/security-review` clean.
- [ ] **Accessibility** — colorblind-safe (not color-only), font scaling, keyboard nav, screen-reader menus.
- [ ] **i18n** — UA/RU/EN complete; architecture supports new locales.
- [ ] **Legal** — original brand/lore/art, IP review passed, ToS + Privacy, GDPR self-service delete/export, license (ADR-0001) applied.
- [ ] **Ops** — Prometheus/Grafana/Loki/OTel dashboards + alerts, automated backups, restore runbook, one-command reproducible deploy (IaC).
- [ ] **Community/launch** — docs site (rules + "run locally in 1 command"), Discord, CONTRIBUTING + good-first-issues, donations live (transparent), landing page.
- [ ] **Quality bar** — typecheck/lint/test green; core determinism test in CI; e2e for a full match per profile.

---

## 5. Detailed plan — milestones → epics → stories

> Legend: `[T0]` trivial · `[T1]` one module · `[T2]` feature in a module ·
> `[T3]` cross-cutting · `[T4]` architecture. `→` = hard dependency.

### M0 — Foundation & validation  *(materialized: `docs/specs/m0-foundation/`)*

**E0.1 — Governance & locked decisions**
- `S0.1.1` [T2] Decide & write **LICENSE** (ADR-0001; recommend AGPL-3.0). AC: LICENSE file + ADR accepted.
- `S0.1.2` [T2] Decide **project name/brand**; reserve domain + social/Discord/GitHub handles. AC: name in README; handles reserved.
- `S0.1.3` [T2] Decide **OAuth providers** (Google+Discord) & **donations provider** (Open Collective) — ADR-0005, ADR-0006. AC: ADRs accepted.
- `S0.1.4` [T1] Author CODE_OF_CONDUCT, CONTRIBUTING, SECURITY.md, issue/PR templates. AC: files present, linked from README.

**E0.2 — Monorepo & tooling skeleton**
- `S0.2.1` [T2] Init pnpm workspace + 5 package skeletons + root `tsconfig` (base/strict). AC: `pnpm i` clean; all packages resolve; `@skervik/*` import works.
- `S0.2.2` [T1] ESLint (flat) + Prettier + editorconfig, shared config. AC: `pnpm -r lint` runs clean on skeleton.
- `S0.2.3` [T1] Vitest wired per package; one passing smoke test each. AC: `pnpm -r test` green.
- `S0.2.4` [T1] Build pipeline: tsup/tsc for libs, Vite for client; path aliases. AC: `pnpm -r build` green.
- `S0.2.5` [T1] Pre-commit (lint-staged) + conventional-commit lint. AC: bad commit msg rejected locally.

**E0.3 — CI/CD foundation**
- `S0.3.1` [T2] GitHub Actions: install→typecheck→lint→test on PR. AC: CI green on a trivial PR.
- `S0.3.2` [T2] **Core determinism test in CI** (replay golden fixture → byte-identical state). AC: CI fails if core becomes non-deterministic. *(→ S0.5.4)*
- `S0.3.3` [T1] Client preview deploy (Cloudflare Pages) on PR. AC: PR posts a preview URL.
- `S0.3.4` [T0] Dependabot/Renovate + CodeQL. AC: configs merged, first scan runs.

**E0.4 — Render prototype gate (Pixi vs Three)**
- `S0.4.1` [T2] Pixi.js v8 2.5D hex-board prototype (static 19-tile board, isometric). AC: renders on desktop + mid mobile.
- `S0.4.2` [T2] *(optional)* Three.js comparison prototype, same scene. AC: comparable scene renders.
- `S0.4.3` [T2] Perf harness (FPS, mem, bundle, FMP) + **engine decision ADR-0002**. AC: ADR accepted; engine locked.

**E0.5 — Core engine contract skeleton**
- `S0.5.1` [T2] Define `GameState`, `GameEvent`, `PlayerIntent`, `RejectReason` types in `@skervik/core`. AC: types compile; exported.
- `S0.5.2` [T2] `reduce()` + `validate()` signatures + no-op impl + determinism test scaffold. AC: signatures match ADR-0003; scaffold runs.
- `S0.5.3` [T2] Seeded PRNG (pcg/xoshiro) + stream-index derivation; unit tests for reproducibility. AC: same seed+index → same sequence, cross-run.
- `S0.5.4` [T2] Event-log format (ndjson) + `replay(events)` util + golden fixture. AC: replay reproduces state; fixture feeds S0.3.2.

**M0 GATE:** CI green incl. determinism test · ADR-0001/0002/0003 accepted · name decided · `pnpm dev` renders an empty board.

---

### M1 — Vertical slice (playable Classic online)

**E1.1 — Core: board & setup**
- `S1.1.1` [T2] Hex board model: tiles, number tokens, ports; vertex/edge adjacency graph.
- `S1.1.2` [T2] Constraint-aware **fair board generation** from seed (no adjacent red 6/8, etc.).
- `S1.1.3` [T2] Initial placement (snake-draft 2 settlements + roads) with legality rules.

**E1.2 — Core: economy & turn loop**
- `S1.2.1` [T2] Resource production on roll (tile/number payout, robber blocks).
- `S1.2.2` [T2] Build actions road/settlement/city + cost & adjacency/distance rules.
- `S1.2.3` [T2] Dev cards: deck, buy, play (knight, road-building, year-of-plenty, monopoly, VP).
- `S1.2.4` [T2] Turn FSM: roll→produce→trade→build→end; turn order, phase guards.

**E1.3 — Core: robber, trade, victory**
- `S1.3.1` [T2] On 7: move robber + steal; discard for >7 hands.
- `S1.3.2` [T2] Player↔player trade domain logic (offer/counter/accept, atomic swap).
- `S1.3.3` [T1] Bank/port trade (4:1, 3:1, 2:1).
- `S1.3.4` [T2] Longest road, largest army, VP tally, victory detection.

**E1.4 — Server: authoritative room**
- `S1.4.1` [T2] Colyseus room: state schema, join/leave, seat assignment.
- `S1.4.2` [T3] Intent→`validate`(core)→emit events→broadcast `event.batch`; reject invalid.
- `S1.4.3` [T3] **Commit-reveal RNG**: `seedHash` at start, `seed` reveal at end; wire PRNG.
- `S1.4.4` [T2] Event-log persistence (ndjson; local FS for M1).

**E1.5 — Protocol**
- `S1.5.1` [T2] Message types (intents + events) in `@skervik/protocol` with zod validation.
- `S1.5.2` [T1] Handshake + versioning (`auth.connect`, `room.state`).

**E1.6 — Client: render & interaction**
- `S1.6.1` [T2] 2.5D board render (tiles/numbers/ports) from state.
- `S1.6.2` [T2] Piece render (settlement/city/road) + placement (legal-spot highlight, assist toggle).
- `S1.6.3` [T2] HUD: resources, dev cards, turn, dice, VP.
- `S1.6.4` [T3] **Trade UI** (the heart): offer builder, counter, confirm step — anti-misclick.
- `S1.6.5` [T3] WS client: connect, send intents, apply `event.batch` via core `reduce`; client prediction for safe actions + reconciliation.

**E1.7 — Single-room E2E**
- `S1.7.1` [T2] Guest auth (`POST /auth/guest`); create/join room by code.
- `S1.7.2` [T3] E2E: scripted 3–4 clients finish a Classic match (CI e2e).
- `S1.7.3` [T2] Post-match seed reveal + `GET /matches/{id}/verify` recompute.

**M1 GATE:** a complete Classic game is playable online by 3–4 people, fully deterministic, seed-verifiable, with a working trade UI.

---

### M2 — Mode platform & resilience

**E2.1 — Rule Profiles engine**
- `S2.1.1` [T2] `RuleProfile` type + loader; Classic/Balanced/Blitz presets.
- `S2.1.2` [T2] **Balanced Deck** randomness (number deck instead of dice).
- `S2.1.3` [T2] Adaptive-duration calculator (players×mode→VP/board/timers/parallel) + lobby warning.
- `S2.1.4` [T2] Turn timers (soft/hard) server-enforced + anti-AFK.
- `S2.1.5` [T3] Parallel phases (simultaneous trade & discard).
- `S2.1.6` [T2] **2-player mode** (phantom player / limited trade / trimmed board).

**E2.2 — Catch-up mechanics** (all profile-gated)
- `S2.2.1` [T1] Friendly robber (can't rob ≤2 VP).
- `S2.2.2` [T2] Robin Hood / poverty tokens.
- `S2.2.3` [T2] Final round (Splendor-style) + hidden VP until trigger.
- `S2.2.4` [T2] Catch-up event tiles (some 7s → boosts).

**E2.3 — Resilience: reconnect & bot-fill**
- `S2.3.1` [T2] Session/reconnect tokens; grace window ≥120s.
- `S2.3.2` [T2] `room.state` full resync on reconnect.
- `S2.3.3` [T3] Bot-fill on disconnect; safe leave/rejoin; **no karmic bans**.

**E2.4 — Bots (AI)**
- `S2.4.1` [T2] Bot worker harness (separate process) consuming core.
- `S2.4.2` [T3] Heuristic bot v1 (build/trade/robber) × 3 difficulties.
- `S2.4.3` [T2] Single-player vs bots; bot-fill integration.

**E2.5 — Lobby, matchmaking, presence**
- `S2.5.1` [T3] Redis: presence, queues, pub/sub, sticky room routing.
- `S2.5.2` [T2] Matchmaking queue by mode; room preview before join.
- `S2.5.3` [T2] Private rooms by code/link; one-click guest invite (no signup).
- `S2.5.4` [T2] Lobby UI: settings + map preview, ready-up.

**E2.6 — Persistence & accounts**
- `S2.6.1` [T2] PostgreSQL schema + migrations (users, matches, match_players).
- `S2.6.2` [T3] OAuth (Google/Discord) + guest upgrade; JWT + refresh.
- `S2.6.3` [T2] Match metadata persist + event-log to S3-compatible storage.
- `S2.6.4` [T2] Self-service account delete/export (GDPR).

**M2 GATE:** multi-mode platform, 2–6 players, single + multiplayer, robust reconnect/bot-fill, matchmaking + accounts.

---

### M3 — Competitive & social

**E3.1 — Ranked & matchmaking quality**
- `S3.1.1` [T2] Glicko-2 rating + `player_ratings` storage.
- `S3.1.2` [T2] Seasons + leagues + leaderboards (`GET /leaderboard/{mode}`).
- `S3.1.3` [T3] Skill-based matchmaking + anti-smurf signals.

**E3.2 — Social**
- `S3.2.1` [T2] Friends + presence-aware invites.
- `S3.2.2` [T2] Guilds/clubs + private tournaments.
- `S3.2.3` [T2] In-game chat + emoji reactions.
- `S3.2.4` [T2] Anti-toxicity: reports, mutes, emoji-only mode, rate limits.

**E3.3 — Spectator & replay**
- `S3.3.1` [T3] Spectator mode (cross-node via Redis pub/sub).
- `S3.3.2` [T2] Replay player from event-log with scrubbing.
- `S3.3.3` [T2] Public seed-verification UI (data-driven RNG trust).

**E3.4 — Post-match analytics**
- `S3.4.1` [T2] Stats pipeline (spot efficiency, tempo loss, roll distribution).
- `S3.4.2` [T2] Player stats page (`GET /stats/{userId}`).

**E3.5 — Large & team modes**
- `S3.5.1` [T2] 5–6p tuning (large board + parallel build).
- `S3.5.2` [T3] 7–10p Blitz logic + team mode (2 teams).

**M3 GATE:** full competitive + social platform; spectate, replay, analyze; 7–10p works.

---

### M4 — Polish, accessibility, content → **1.0**

**E4.1 — Async mode** — `S4.1.1` play-by-turn engine over event-sourcing · `S4.1.2` turn notifications (push/email) · `S4.1.3` async lobby/UX.
**E4.2 — Deep profile** — `S4.2.1` commodities · `S4.2.2` knights · `S4.2.3` development tracks (cities&knights-like layer).
**E4.3 — Art & customization** — `S4.3.1` premium 2.5D art pass · `S4.3.2` themes/board skins · `S4.3.3` avatars/emotes (**cosmetic only, no p2w**).
**E4.4 — Accessibility & i18n** — `S4.4.1` colorblind palettes + non-color resource cues · `S4.4.2` font scaling + keyboard nav + screen-reader menus · `S4.4.3` i18n framework + UA/RU/EN strings.
**E4.5 — Performance & hardening** — `S4.5.1` progressive asset loading + bundle budget · `S4.5.2` load test to NFR + p95 tuning · `S4.5.3` chaos/reconnect soak.
**E4.6 — PWA & platform** — `S4.6.1` installable PWA + portrait mobile · `S4.6.2` store wrappers (optional).
**E4.7 — Launch readiness** — `S4.7.1` observability (Prom/Grafana/Loki/OTel) + alerts · `S4.7.2` backups + restore runbook + IaC one-command deploy · `S4.7.3` **legal/IP review** + ToS/Privacy · `S4.7.4` donations live + transparency page · `S4.7.5` docs site + Discord + good-first-issues · `S4.7.6` `/security-review` + final DoD audit · `S4.7.7` landing page + launch comms.

**1.0 GATE = the Definition of Done (§4).** When green → public launch, begin onboarding.

---

### M5 — Scale (post-launch, demand-driven)
`S5.1` horizontal realtime sharding (sticky-by-room) · `S5.2` managed Postgres (replicas/partition) + Redis cluster · `S5.3` k8s + autoscale · `S5.4` *optional* realtime layer on Elixir/Go if Node hits connection ceiling · `S5.5` multi-region edge. Each is a deferred "door" (tech spec §8.2) — do not pre-build.

---

## 6. Cross-cutting workstreams (continuous, every milestone)

| Stream | Practice |
|---|---|
| Determinism & fairness | Golden-replay tests in CI from M0; every randomness source flows through the seeded PRNG. |
| Security & anti-cheat | Server-authoritative validation; hidden info never serialized to clients; rate-limits; `/security-review` per milestone. |
| Observability | Structured logs + metrics from M1; dashboards/alerts hardened by M4. |
| Docs & ADRs | Every architectural fork → ADR; load-bearing invariants → `docs/wiki/`; update via `drone-docs` after merges. |
| Playtesting & balance | From M2: balance-sim tool + human playtests; finalize adaptive-duration numbers (tech spec §14.5). |
| Performance budget | Bundle/FMP/p95 budgets tracked in CI from M0; enforced at M4. |

## 7. Decisions

**Locked (2026-06-30)** — see `docs/adr/`:

1. ✅ **Project name/brand = Skervik** (ADR-0007). Domain skervik.com registered 2026-06-30, exp 2028.
2. ✅ **License = AGPL-3.0** (ADR-0001). Network copyleft protects the hosted OSS service from closed forks.
3. ✅ **Render engine = Pixi.js v8** (ADR-0002). Lighter/faster 2.5D on mobile; the E0.4 prototype is a validation checkpoint, not a blocker.
4. ✅ **Auth = guest + Google + Discord** (ADR-0005). Discord matches the audience and is our community hub.
5. ✅ **Donations = Open Collective** (ADR-0006). Public ledger = verifiable transparency.
6. ✅ Already locked at spec time: deterministic isomorphic core (ADR-0003), realtime = Node+Colyseus+Fastify (ADR-0004).

**Still open — owner's call:**

_(none at this time)_

**Resolved:**

- ✅ **Project name/brand = Skervik** (skervik.com, registered 2026-06-30, exp 2028; ADR-0007 accepted). Scope `@skervik/*` rename is a separate open item.

## 8. Risk register (top — full list in tech spec §13)

| Risk | Mitigation in this plan |
|---|---|
| Catan IP claim | Original name/lore/art (S0.1.2); legal review gate (S4.7.3) before launch. |
| 2.5D engine fails on mobile | M0 prototype gate (E0.4) before committing; Pixi as lightweight hedge. |
| Node connection ceiling | sticky-by-room isolates risk; Elixir/Go "door" deferred to M5. |
| RNG paranoia (Colonist's failure) | commit-reveal (S1.4.3) + public verify UI (S3.3.3) + roll analytics (S3.4.1). |
| OSS maintainer burnout | ADRs + good-first-issues + docs site (E4.7); VULYK reduces toil. |
| Empty lobbies at launch | bots + async give a full game with no humans (M2/M4). |

## 9. VULYK execution playbook

- **Tier examples here:** rename a label = T0 · add a port-trade ratio = T1 · build the trade UI (S1.6.4) = T3 · the core engine contract (E0.5/ADR-0003) = T4.
- **Per epic:** `/vulyk-plan <epic>` → materialize stories in `docs/specs/<slug>/` → review/approve → `/vulyk-build` → `/vulyk-review` → merge → `drone-docs` refresh + `/vulyk-status`.
- **Just-in-time:** only the current + next epic get full story files; this roadmap is the backlog. Re-plan a milestone when its gate is the next target.
- **Memory:** `memory/memory.md` indexes the live map, ADRs, wiki, and verification commands. `/vulyk-gc` weekly; `/vulyk-evolve` to evolve the config.

---

*Next concrete action: confirm §7 decisions, then run `/vulyk-build` on the
materialized M0 stories in `docs/specs/m0-foundation/` (start with E0.2 →
E0.5; E0.4 prototype gates the engine choice).*
