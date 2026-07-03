---
spec: m1-vertical-slice
status: ready-for-execution
owner: Queen (any top-model session — written for Opus 4.8, no Fable context needed)
date: 2026-07-03
base-commit: 2a95d6b (M0 closed)
---

# M1 — Vertical slice: execution plan (Queen playbook)

**Mission (M1 GATE):** a complete Classic match is playable online by 3–4 people —
fully deterministic, seed-verifiable (commit-reveal), with a working trade UI.
Scripted 3–4-client E2E finishes a match in CI. (ROADMAP.md M1; H2 plan Aug–Dec.)

## 0. How to run this plan (process — read first)

1. **The Queen writes NO code.** Specs, stories, docs, orchestration, acceptance —
   yes. Any file under `packages/**` — only via `worker-code` subagents (Sonnet
   default; Opus 4.8 for T3 stories). Even one-line fixes. (Constitution, owner
   directive 2026-07-03.)
2. **Story cycle:** materialize the next story file in this directory (format:
   copy any `docs/specs/m0-foundation/S0.5.x` file) → dispatch `worker-code` with
   the story + map slice → worker implements on a feature branch, verifies
   (`pnpm -r typecheck && lint && test && build`), commits (conventional commit,
   subject starts lowercase after type; body lines ≤100 chars — commitlint) →
   Queen reviews via `lead-review` for T3+ or accepts directly for T1–T2 →
   merge `chore(repo): merge <branch> (<story> accepted)` → update this plan's
   §6 status table + memory.
3. **One story = one branch = one worker dispatch.** Parallelize only stories
   with no shared files (budget posture BALANCED, ≤4 workers).
4. **Verification is the worker's job; acceptance is the Queen's.** A story is
   done when its acceptance criteria are checked, CI is green, and the §6 table
   is updated — not before.
5. **Windows note:** pre-commit runs prettier via lint-staged automatically;
   husky hooks call Git Bash by absolute path (see `memory/` learnings).

## 1. Hard invariants (check EVERY core story against these)

- **Determinism:** no `Math.random`/`Date`/ambient state in `packages/core`
  (ESLint guard enforces). Same event log → identical state, byte-for-byte.
- **Seed is NOT in `GameState`.** It is the 4th parameter of `validate()`
  (fix-plan A1, ADR-0003). `GameState` carries only the public `seedHash`.
- **Every random draw consumes an explicit `rngStreamIndex`** derived
  deterministically (see §3 "RNG stream discipline") and recorded in the
  emitted event — the event log must let anyone recompute every draw
  (`docs/wiki/fair-rng-commit-reveal.md`).
- **Pure data:** no classes, no `Map`/`Set` in state — plain serializable
  objects/arrays only (existing core convention).
- **Intents in, events out:** clients send `PlayerIntent`; only validated
  `GameEvent`s mutate state via `reduce`. The server is authoritative.
- **Rule profiles are config, not code branches** — where M1 hardcodes Classic
  values (VP=10, discard >7, etc.), put them in one `ClassicProfile` constant
  object so M2 can swap profiles without touching rule code.
- **Trilingual RU/UA/EN (ADR-0008)** and **a11y/i18n checklist** (ROADMAP E1.6
  note) bind ALL client UI code from the first line. Lore terms only via i18n
  keys from `docs/wiki/lore-primer.md` glossary; core/protocol identifiers stay
  mechanical (`settlement`, `robber`, `desert`).

## 2. Epic order (anchored to H2 monthly plan)

| # | Epic | Stories (tiers in ROADMAP.md) | Target |
|---|---|---|---|
| 1 | **E1.1 board & setup** | S1.1.1 model/graph · S1.1.2 fair generation · S1.1.3 snake placement | Aug |
| 2 | **E1.2 economy & turns** | S1.2.1 production · S1.2.2 build rules · S1.2.3 dev cards · S1.2.4 turn FSM | Aug |
| 3 | **E1.3 robber, trade, victory** | S1.3.1 robber/7 · S1.3.2 p2p trade · S1.3.3 bank/port trade · S1.3.4 awards+victory | Sep |
| 4 | **E1.4 server room** | S1.4.1 Colyseus room · S1.4.2 intent pipeline · S1.4.3 commit-reveal · S1.4.4 log persist | Sep–Oct |
| 5 | **E1.5 protocol** | S1.5.1 zod message types · S1.5.2 handshake/versioning | Oct |
| 6 | **E1.6 client** | S1.6.1 board render · S1.6.2 pieces · S1.6.3 HUD · S1.6.4 **Trade UI** · S1.6.5 WS client · S1.6.6 i18n framework + 3 locales | Nov |
| 7 | **E1.7 E2E + alpha** | S1.7.1 guest auth/rooms · S1.7.2 CI E2E full match · S1.7.3 seed reveal + verify endpoint | Dec |

First batch is materialized: `S1.1.1`–`S1.1.3` story files sit next to this plan.
Materialize the rest just-in-time from ROADMAP.md lines + §3 notes below.

## 3. Domain notes per epic (so no story needs re-research)

**RNG stream discipline (cross-cutting, decide in S1.2.1 and never change):**
one event may need several draws (e.g. robber steal = victim pick). Scheme:
`streamIndex = state.eventIndex * K + slot` with a fixed `K` (e.g. 8) and
documented slot map per event type (slot 0 = dice die A, 1 = die B, 2 = steal
pick, 3 = shuffle base, …), OR record the consumed indices in the event payload.
Pick one, write it into a `docs/wiki/rng-stream-map.md` note, and keep the
golden replay test asserting it. Board generation (S1.1.2) consumes a reserved
low range (e.g. indices 0..N before eventIndex counting starts) — document it.

**E1.1:** board = radius-2 hex, 19 tiles / **54 vertices / 72 edges** (test these
counts). Canonical IDs: vertex = sorted triple of adjacent hex axial coords,
edge = sorted pair — string keys, stable across runs. Classic mix: 4 forest /
3 clay / 4 meadow / 4 field / 3 ridge / 1 desert (mechanical names; lore skins
live in the client). Tokens 2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12; desert
none, robber starts there. Fair-gen constraint: no two red tokens (6/8) on
adjacent tiles; deterministic bounded reshuffle (attempt counter advances the
stream index — reproducible). Ports: classic 9 (4×3:1, 5×2:1 one per resource)
on fixed coastal slots, assignment shuffled from seed. Snake draft: place order
1..N then N..1; settlement #2 pays adjacent tile resources; distance rule (no
settlement adjacent to any settlement); road must touch the just-placed
settlement.

**E1.2:** production: roll total → every tile with that token pays adjacent
settlements 1 / cities 2, unless robber sits on it; bank exhaustion rule —
if bank can't pay everyone for a resource, nobody gets it (classic). Build
costs (Classic): road=1 timber 1 clay · settlement=1 timber 1 clay 1 fleece
1 barley · city=3 iron 2 barley · dev card=1 fleece 1 barley 1 iron
(mechanical resource ids: `timber/clay/fleece/barley/iron` — already implied
by lore glossary EN column). Roads: must connect to own network; settlements:
distance rule + on own road; city upgrades own settlement. Dev deck: 14 knight,
2 each road-building/year-of-plenty/monopoly, 5 VP; shuffled from seed at game
start; bought card unplayable same turn (except VP counting); one dev card play
per turn. Turn FSM: `roll → (resolve 7) → main (trade+build interleaved) → end`;
phase guards in `validate`.

**E1.3:** on 7: every player with >7 cards discards floor(half) (their own
choice via intent), then mover relocates robber + steals 1 random card from one
adjacent victim (random pick = PRNG stream slot). Trade: offer(give,get) →
counter/accept/reject; **atomic swap in one event** — no partial states; only
current player initiates with others. Bank 4:1 always; port rates from owned
vertex ports. Longest road: longest simple path in own road subgraph (DFS,
settlements of others break it), ≥5, ties keep holder. Largest army ≥3 knights,
ties keep holder. VP: settlement 1, city 2, awards 2, VP cards hidden until win.
Victory: checked on the acting player's turn (incl. hidden VP) at threshold
`profile.vpToWin` (Classic 10) → `game.ended` event freezes state.

**E1.4:** Colyseus room holds the authoritative `GameState` + secret `seed`
(NEVER serialized to clients — pass to `validate` as the 4th arg). On create:
generate crypto seed, publish `seedHash` in room metadata/state. Pipeline:
client intent → `validate(state, intent, playerId, seed)` → ok? append events
to ndjson log (S1.4.4, local FS `matches/{id}/events.ndjson`) + `reduce` each →
broadcast `event.batch`; reject with `RejectReason` to sender only. On game
end: append `seed.reveal` record. Colyseus schema mirrors public state only.

**E1.5:** zod schemas in `@skervik/protocol` for every intent/event + envelope
`{v: 1, type, payload}`; server validates shape with zod BEFORE core `validate`;
version mismatch → explicit `error.version` message. Protocol package gains its
real zod dependency here (S1.5.1) — update the honest `package.json` description.

**E1.6:** render from `GameState` only (the E0.4 `packages/client/src/proto/`
scene is a perf harness, NOT the product renderer — reuse its hex-math/tile
patterns as reference, but S1.6.1 renders from state, and the proto dir is
deleted or quarantined by the story that supersedes it). B7+ADR-0008 checklist
binds every story: i18n keys only (S1.6.6 ships RU/UA/EN files + switcher),
never color-only, layouts tolerate RU/UA text expansion, no text in art assets.
Trade UI (S1.6.4, T3 — consider Opus worker + `lead-review`): offer builder
with explicit confirm step, counter-offers, impossible-offer prevention —
this is the product's heart; misclick-proof beats pretty.

**E1.7:** guest auth `POST /auth/guest` (Fastify), room create/join by code;
CI E2E: 3–4 scripted clients (plain WS, no UI) play scripted-but-legal moves to
victory — asserts determinism server-side and event-log replay equality;
`GET /matches/{id}/verify`: recompute rolls from log + revealed seed, compare
`seedHash`. This closes the M1 gate and the year's headline feature («Честный
жребий» — the Sealed Lot).

## 4. Cross-cutting risks the Queen must watch

- **Stream-index drift** between server draws and replay verification — the
  golden replay test must cover every random event type as it's added.
- **State shape churn:** E1.1–E1.3 will extend `GameState`/`GameEvent` unions
  repeatedly; keep events append-only compatible (never repurpose a type name)
  or re-golden fixtures consciously each time (document in story notes).
- **Scope creep into M2:** no rule profiles beyond the `ClassicProfile` constant,
  no reconnect/grace, no matchmaking, no bots — M2.
- **Client i18n debt:** reject any UI diff with hardcoded strings or <3 locales.
- **Real-device check** (accepted E0.4 residual): one mid-range Android
  spot-check when E1.6 first renders — earlier than alpha if convenient.

## 5. References

- Engine contract & conventions: `docs/wiki/deterministic-core.md`,
  `docs/wiki/fair-rng-commit-reveal.md`, `docs/wiki/server-authority.md`,
  ADR-0003/0004; existing core code layout: `packages/core/src/*` (types,
  reduce, validate, rng, replay — 36 tests to keep green).
- Rules of record for naming: `docs/wiki/lore-primer.md` (RU/EN/UA glossary).
- Master story list & tiers: `docs/specs/roadmap/ROADMAP.md` (M1 section).
- Monthly targets & "how we know": `docs/specs/roadmap/ROADMAP-2026-H2.md` §2.

## 6. Status table (Queen updates after every merge)

| Story | Status |
|---|---|
| S1.1.1 hex board model & graph | ✅ done — merged `c4cfc1a` (19/54/72 counts, adjacency graph, 9 port slots; 51/51 core tests) |
| S1.1.2 fair board generation from seed | ⏳ materialized, ready to dispatch (after S1.1.1) |
| S1.1.3 snake-draft initial placement | ⏳ materialized, ready to dispatch (after S1.1.1–.2) |
| S1.2.1–S1.2.4 | not materialized |
| S1.3.1–S1.3.4 | not materialized |
| S1.4.1–S1.4.4 | not materialized |
| S1.5.1–S1.5.2 | not materialized |
| S1.6.1–S1.6.6 | not materialized |
| S1.7.1–S1.7.3 | not materialized |
