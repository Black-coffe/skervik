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
**i18n MECHANISM decided — ADR-0010 (2026-07-05): a custom typed layer over the
platform `Intl` APIs** (typed `TranslationKey` catalogue → 3 locale records so a
missing key FAILS THE BUILD = compile-time ADR-0008 enforcement; plurals via
`Intl.PluralRules`, formatting via `Intl.*`; zero runtime dep; migratable to
i18next later at call-site level). S1.6.1/S1.6.2 = canvas-only, ZERO strings;
first string consumer is S1.6.3 (HUD) — sequence S1.6.6's framework portion
before, or materialize the `t()` contract at, S1.6.3. No HUD/Trade string merges
mono-lingual or untyped.
Trade UI (S1.6.4, T3 — consider Opus worker + `lead-review`): offer builder
with explicit confirm step, counter-offers, impossible-offer prevention —
this is the product's heart; misclick-proof beats pretty.
**Design constitution (owner-commissioned, 2026-07-03): every E1.6 story MUST
cite and follow root `PRODUCT.md` + `DESIGN.md`** (tokens, layout zoning, trade
UI rules §7, fairness dashboards §8, a11y/i18n merge gates §10, component
inventory §11); reference mockup `docs/design/mockups/game-table.html`
(same layout/tokens rendered — open in a browser). Deviations from DESIGN.md
need owner sign-off, not worker judgment.

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
| S1.1.2 fair board generation from seed | ✅ done — merged `ae67382` (event-sourced `board.generated`, RNG band 1M+, no-adjacent-red; lead-review MERGE WITH NITS; 58/58 tests). **Deferred nit → S1.2.1:** revisit 1M headroom when `eventIndex*K+slot` scheme lands |
| S1.1.3 snake-draft initial placement | ✅ done — merged `1a6e51b` (placeSettlement/placeRoad, distance+detached-road legality, 2nd-settlement payout, setup→main FSM; lead-review MERGE WITH NITS; 69 tests). **✅ E1.1 CLOSED.** Deferred nit → S1.2.4: make snake seating-order coupling explicit |
| S1.2.1 resource production on roll (+ gameplay RNG scheme `eventIndex*K+slot`, K=8, headroom guard) | ✅ done — merged `4d5ddc9` (RNG scheme fixed: K=8, slots 0/1 dice, 2-7 reserved, headroom guard vs 1M band; DiceRolled single-die→dieA/dieB/total conscious re-golden; bank exhaustion all-or-nothing; 7→S1.3.1 seam; lead-review MERGE, re-golden recomputed authentic; 80 tests). **Deferred nit → S1.4.4:** wire-replay must map `RESOURCES_PRODUCED` (log/engine production divergence) |
| S1.2.2 build actions road/settlement/city | ✅ done — merged `66a76ea` (`CLASSIC_BUILD_PROFILE` costs+supply 15/5/4, shared distance rule, one-hop own-network road legality, city upgrade +1 VP, on-the-fly supply count; closed S1.2.1 city-payout seam; lead-review MERGE WITH NITS; 96 tests). **Known deferral → S1.3.4:** enemy-settlement-blocks-road (build-legality cut lands with longest-road enemy-break) |
| S1.2.3 dev cards deck/buy/play (knight play deferred to S1.3.1) | ✅ done — merged `dcfb86c` (25-card deck, reserved RNG band `1_010_000+` disjoint w/ margin 2684, buy/road-building/year-of-plenty/monopoly, knight→S1.3.1, interim turn.ended reset; lead-review MERGE WITH NITS, deck order re-derived from seed authentic; 121 tests). **Follow-up test nits → S1.2.4:** road-building MALFORMED_INTENT + incremental-drop cases untested |
| S1.2.4 turn FSM roll→produce→main→end + guards | ✅ done — merged `4f36dd7` (explicit `GamePhase` union incl. `roll`/`robber` seam, unified phase-guard layer, explicit `playerOrder` seat array removing S1.1.3 coupling, consolidated per-turn reset; golden re-goldened + hand-traced authentic; lead-review MERGE; 131 tests). **✅ E1.2 CLOSED (economy & turn loop complete).** |
| S1.3.1 robber/7: discard, relocate, steal (+ knight play from S1.2.3) | ✅ done — merged `d284ead` (order-indep discard sub-FSM, PRNG steal slot 2 recorded explicitly, shared `resolveRobberMove` for 7 & knight, pre-roll knight returns to `roll` bug caught, match-long `knightsPlayed` counter; lead-review MERGE, seed swap independently recomputed legit; 154 tests). **Nit → S1.3.4 profile:** discard threshold `>7`/`floor(half)` still inline |
| S1.3.2 p2p trade: offer/counter/accept, atomic swap | ✅ done — merged `9ca2614` (atomic swap in one reduce step + conservation asserted, propose/accept/reject/counter(depth 1)/cancel, stale-proposer re-check at accept, non-current-player response carve-out main-phase-gated, turn.ended implicit close; lead-review MERGE WITH NITS; 182 tests). Hygiene nit: `subtractResources` leaves `{res:0}` keys (harmless, deterministic — same in live & replay) |
| S1.3.3 bank/port trade 4:1/3:1/2:1 (T1) | ✅ done — merged `c9e0aa5` (rate resolution 2:1 matching-port/3:1 generic/4:1 base, port ownership via edge endpoints, different-resource edge + same-resource net handled, `CLASSIC_BANK_TRADE_PROFILE`, conservation; T1 accepted directly w/ Queen independent verification; 195 tests) |
| S1.3.4 longest road, largest army, VP tally, victory | ✅ done — merged `86a544d` (Opus worker+review; longest-road backtracking DFS — trail/edge-once/opponent-break, crux independently verified on cycle+Y graphs; largest army; derived VP tally incl. hidden cards; victory on own turn → `game.ended`/`finished`/freeze; shared `vertexHasOpponentBuilding` closes the S1.2.2 enemy-cut; `CLASSIC_VICTORY_PROFILE` + `CLASSIC_ROBBER_PROFILE` folds discard nit; 206 tests). **✅ E1.3 CLOSED — full M1 rules engine complete.** Follow-up nits: (1) DFS cycle/Y regression tests ✅ landed `091f009` (worker-test, regression-bite verified — 210 tests); (2) `player.victoryPoints` is a non-authoritative duplicate (win uses `computeVictoryPoints`) → note for E1.6 client display |
| S1.4.1 Colyseus room shell | ✅ done — merged `ec2a79f` (under ADR-0009; authoritative plain `GameState` + private `#seed` — seed-secrecy verified NO-leak by lead-review — + `seedHash` publish + minimal `@colyseus/schema` public projection seedHash/phase/currentPlayer/seats + join/leave/seat + one-shot `state.snapshot`; `colyseus@0.17.10`+`@colyseus/schema@4.0.27`, ESM/Node-22 spike CLEAN; protocol WS envelope type-only; no core edits; 221 tests). Nits: (1) extract+unit-test `sha256Hex` vector → fold into S1.4.3 seed lifecycle; (2) client-side schema-delta assert (minor); (3) `onLeave` seat-reclaim / `seatIndex=seats.length` churn → M2 reconnect TODO |
| S1.4.2 intent pipeline | ✅ done — merged `381d72d` (T3 Opus+review; authoritative `validate`→`reduce`-fold→`GameEventSink` seam→broadcast `event.batch`; sender identity bound to Colyseus seat `sessionId` — spoof/unseated rejected, review verified NO client can mutate another player's state; private reject; seed absent from all outbound traffic (64-hex wire assertion); zero core edits; 227 tests). **NIT-1 (latent, MUST fix in S1.4.4b):** state commits before persist confirmed + reduce/append outside try-catch → a durable sink reject would diverge the log + crash the node; reorder to persist-local→commit→broadcast + wrap async path. NIT-2 narrow the broad `validate` catch; NIT-3 add server `NOT_YOUR_TURN` test |
| S1.4.3 commit-reveal (reveal + `sha256Hex`) | ✅ done — merged `d86e9d3` (T3 Opus+review; seed revealed to `MatchMetadataStore` seam ONLY on/after `game.ended`, once — reveal boundary verified airtight (no pre-end leak / no skip / no double); `sha256Hex` extracted + FIPS-180-4 vector test folds S1.4.1 nit; seed stays server-secret; zero core edits; 21 server tests). Nit: `index.ts` re-export not in story Files (idiomatic) |
| S1.4.4a core log-format (bare-GameEvent + re-golden) | ✅ done — merged `46b8dbe` (Opus + independent-recompute review; retired `EventLogLine`/`toGameEvent`/`parseEventLog`/`replayLog`, added `parseGameEventLog`; determinism fixture re-goldened — new `golden.state.json` replay-regenerated + verified deep-equal to old modulo key order, `reduce`/`validate` untouched; **S1.2.1 `RESOURCES_PRODUCED` nit CLOSED**; A2 gate unchanged 5/5; 211 core tests) |
| S1.4.4b server FsEventSink (durable log write) | ✅ done — merged `fdf381f` (Opus + **2-round** lead-review). `FsEventSink`→`matches/{id}/events.ndjson` (round-trip via `parseGameEventLog`+`replay`); S1.4.2 NIT-1 fixed RIGHT: persist-local→commit→broadcast in a crash-safe try/catch **+ per-room `#queue` serializing the intent pipeline** — closes a TOCTOU double-spend/log-divergence race the naive reorder introduced (Colyseus doesn't serialize async handlers), **caught by adversarial review**, concurrency test independently verified fail-without/pass-with; matchId path-safety; core-throw string-pin; NIT-2/3. 37 server tests. **✅ E1.4 CLOSED** |
| **✅ E1.4 server room COMPLETE** | room shell + authoritative validate→reduce→broadcast pipeline (seat-bound identity) + provably-fair commit-reveal + durable bare-`GameEvent` event log. **M1 core+server foundation done** (E1.1–E1.4). NEXT: E1.5 protocol/zod → E1.6 client (binding `DESIGN.md`) → E1.7 E2E+alpha |
| S1.5.1 protocol zod schemas + server inbound validation | ✅ done — merged `2a95827` (Opus worker, isolated worktree). zod `^4.1.13` = protocol's first runtime dep; envelope `{v,type,payload}` + inbound `ClientMessageSchema` + outbound `ServerMessageSchema`. **Drift-pin realized as `z.discriminatedUnion` + compile-time exhaustiveness pins** (NOT `z.ZodType<T>` — fought zod v4 inference across 17-variant `PlayerIntent` incl. nested 4-variant `card` union + 25-variant `GameEvent`); pin PROVEN — a temp core-variant add failed the protocol build at `messages.ts:582/593`, reverted to core zero-diff. Server inbound swaps ad-hoc guard → `ClientMessageSchema.safeParse` (private `MALFORMED_INTENT`, no throw); **`#queue`/persist-before-commit pipeline (S1.4.4b) byte-for-byte untouched**. Outbound-payload-parses test added. protocol 22 tests, server 38 (net +1); core stays zero-dep. **Merge gotcha (→ memory):** post-merge verify first FAILED — main worktree needed `pnpm install` (zod) + `pnpm -r build` (fresh core dist, else drift-pin fires falsely) before green; generalizes the rebuild-core-before-server-test lesson |
| S1.5.2 handshake/versioning | ✅ done — merged `4f5affc` (Opus worker). Version-gate at Colyseus `onAuth(client, options, ctx)` (runs before seating): `ConnectOptionsSchema.safeParse` + `isCompatibleProtocolVersion` (exact-match `PROTOCOL_VERSION`, `unknown` self-guarding param so missing/non-string ⇒ incompatible; M2 loosens the one helper) → on fail throws `ServerError(4001, JSON.stringify(error.version msg))`, machine code `PROTOCOL_VERSION_MISMATCH` survives transport (client E1.6 `JSON.parse`+validates under `ServerMessageSchema`, renders "update required"); `clientVersion`=presented-or-null. `error.version` added to outbound `ServerMessageSchema`; S1.5.1 drift-pins intact; existing `state.snapshot` serves "room.state" (no dup). All 29 pre-existing joins now pass `CONNECT_OPTS`. protocol 31 tests, server 42 (3 join-outcomes: correct joins+snapshot / wrong / missing-malformed each rejected, `seats.length===0`). `#queue`/persist pipeline + `#seed` secrecy + inbound `safeParse` untouched; core zero-diff. **T1 accepted directly** (Queen re-ran 5/5 green + server ×3). **Infra note:** first 2 dispatches failed — `isolation:worktree` spawned from a STALE base (`3f35f92`, all leftover `worktree-agent-*` branches pinned there); fixed by deleting those branches + physical dirs, then ran in shared worktree. **Deferred nit (flaky, → follow-up):** S1.5.1's "real event.batch/state.snapshot payloads parse" test races a 50ms `nextTick` (failed 1/~4 for the worker; passed 3/3 for the Queen) — harden its timing. |
| **✅ E1.5 protocol CLOSED** | zod runtime contract at the trust boundary (S1.5.1) + protocol version negotiation on join (S1.5.2). Server validates inbound shape (`ClientMessageSchema.safeParse`) AND client protocol version (`onAuth`) before core `validate`. **M1 core+server+protocol done (E1.1–E1.5).** NEXT: **E1.6 client** (binding `PRODUCT.md`/`DESIGN.md`; Trade UI = product heart; i18n RU/UA/EN + 3 locales; display VP via `computeVictoryPoints` not `player.victoryPoints`) → **E1.7** E2E + alpha. |
| S1.6.1 board render + client foundation | 🔨 materialized + dispatched (2026-07-05, `5032236`) — tile layer from `GameState.board` (§2 design tokens as CSS vars + frozen canvas hex + flotilla palette; chart-paper tokens w/ probability pips, 6/8 hot; robber; sea; pan/zoom; mist reduced-motion pause), proto quarantined→deleted, pure hex-math tested. Scope split: ports + vertex/edge geometry + placement highlights → S1.6.2. Zero i18n strings (canvas digits only). **Infra:** `isolation:worktree` stale-based TWICE from `3f35f92` (harness slot pinned to stale base) → falling back to shared-worktree dispatch. |
| S1.6.2–S1.6.6 | not materialized. i18n mechanism = ADR-0010 (custom typed layer + `Intl`); binds S1.6.3 (HUD, first string consumer) onward |
| S1.7.1–S1.7.3 | not materialized |
