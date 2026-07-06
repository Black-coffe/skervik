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
| S1.6.1 board render + client foundation | ✅ done — merged `d4e0640` (Sonnet worker + lead-review **MERGE WITH NITS**; all 8 acceptance criteria met, review independently reran 299 tests green). Tile layer from `GameState.board`: §2 design tokens (`theme/tokens.css` OKLCH + `canvasColors.ts` frozen hex + `flotillaColors.ts` palette — all 24 literals verified verbatim vs DESIGN.md §2/§2.2/§2.3), chart-paper token discs w/ probability pips (`6-|7-n|`), 6/8 in `--hot-number`, robber marker, radial sea, pan/zoom, ambient mist w/ **real `prefers-reduced-motion` pause** (§9 gate wired). Pure tested `hexGeometry`/`boardModel` (built-once Container, only mist alpha per tick — deterministic). Dev fixture = REAL core gen (`reduce` on `match.started`+`board.generated`, payload from `generateBoard(seed, buildTopology())`). `src/proto/` DELETED. Scope split honored: ports + vertex/edge geometry + placement highlights → S1.6.2. Zero i18n strings. **Follow-up nits (non-blocking):** (1) **OWNER EYEBALL** — board-wide mist (`ink` @ α0.08–0.22) veils number tokens incl. 6/8 red → contrast cost on densest elements; fix = draw mist beneath `tilesLayer` or cap α (fold into S1.6.2/S1.6.3). (2) **OWNER + DESIGN.md** — desert reuses `--chart-paper` (§2.3 has no desert color; sits adjacent to fleece, separated only by stroke pattern) → consider adding `--res-desert` token. (3) robustness — `boardModel` silent `?? desert`/`?? chartPaper` fallbacks would render a *partial* board as phantom-desert instead of throwing (low risk, gen fills all 19); louder failure optional. **Infra lesson:** `isolation:worktree` stale-based TWICE from `3f35f92` (harness slot pinned to stale base) → shared-worktree dispatch works. **Note:** worker's Impl-notes said "302 tests"/`TileKind = string\|'desert'` — both wrong (299 tests; `TileKind = ResourceType\|'desert'` closed union, so kind→color/pattern totality is compiler-enforced). |
| S1.6.1a board-render nits (mist + desert) | ✅ done — merged `58a38f3` (Sonnet worker, T1, Queen-accepted direct w/ independent client verify 14/14). Nit-1: split `buildTileVisual`→`buildTileBase`+`buildTileTopper`, render order `sea→tiles→mist→toppers` so number tokens/pips/6-8-red + robber stay crisp ABOVE the ambient haze (§9 reduced-motion pause + 6000ms period intact, mist still built-once). Nit-2: `--res-desert oklch(0.66 0.03 70)/#9e8f7f` added to DESIGN.md §2.3 (`117ec56`, OKLCH↔sRGB generated via Ottosson transform, matched existing anchors exactly) + wired into `canvasColors`/`tokens.css`/`boardModel`. Nit-3 (loud-fail on partial board) still deferred. |
| S1.6.2 pieces (settlements/cities/roads/ports) | ✅ done — merged `a1682f2` (Sonnet worker + lead-review **MERGE WITH NITS**; review confirmed every load-bearing check + reran client 33 / `-r` all green). Vertex/edge layer above the mist: pure `hexGeometry` gained `parseVertexId`/`vertexToPixel` (=centroid of 3 defining tile-coords = exact shared corner, coastal-safe, verified at pre-flatten dist `HEX_SIZE`)/`edgeToPixel`; new pure `pieceModel.ts` → `PieceDescriptor`/`RoadDescriptor`/`PortDescriptor`. Settlements (pentagon hut) / cities (keep+tower) / roads (inset bar) shape-distinct + flotilla-colored; **a11y §2.2 cue = 4 color-independent badges** (petrel○/orca▽/walrus□/narwhal◇, `--ink`) on every piece. 9 ports on coastal edges, rate digits 3:1/2:1 + 2:1 resource cue via existing §2.3 color+pattern. `piecesLayer` built-once above mist; **BoardScene S1.6.1 code byte-identical (0 deleted lines)** = no regression. Dev fixture: real S1.1.3 snake draft (4 flotillas, validate→reduce) + 1 city via direct `CityBuiltEvent`→`reduce` (spec fallback; legit — vertex had p1's settlement). client 33 tests. **Follow-up nits (non-blocking):** (1) badge radius ~2–2.8px at 1× — square vs diamond weakest pair; bump size / redraw narwhal as lozenge (later stories copy this pattern — address before/with polish). (2) **→ S1.6.3 PREREQ:** dev-fixture city subtracts iron3/barley2 w/o prior income → p1 resources may go negative; if S1.6.3 HUD reuses `devFixtureState` it'll show negatives — grant cost or add income first. (3) `pieceModel.test.ts:104` port-rate test indexes desc+expectation by same `i` → structurally blind to a pairing shift (non-risk; pairing is index-identity). |
| S1.6.6a i18n framework (pulled ahead of S1.6.3) | ✅ done — merged `8bcf31e` (Sonnet + lead-review MERGE WITH NITS; reviewer reproduced the gate; client 44 tests). ADR-0010 realized: custom typed layer over `Intl`, ZERO runtime deps. **Build-time trilingual gate PROVEN** — `Messages = Record<TranslationKey, MessageValue>` per locale (ru/uk/en) so a missing/typo/extra key fails `tsc` (TS2741/TS2353), not runtime. `translate()` + `useTranslation`/`I18nProvider` + `LocaleSwitcher`, plurals via `Intl.PluralRules` (RU/UK 1/2/5/11/21 correct incl. 11-vs-21 trap), `formatNumber`/`formatDateTime`, `localStorage`+SSR-guarded, default `ru`. `tsconfig` +`types:["vite/client"]` (for `import.meta.env.DEV`; footgun checked — not triggered). **Nits → folded into S1.6.3:** (1) LocaleSwitcher roving-tabindex+arrow keys; (2) its hardcoded `aria-label="Language/Мова/Язык"` → a `t()` key; (3) route plural `{count}` through `formatNumber`. |
| S1.6.3 HUD (Instruments layer) | ✅ done — merged `baa6c66` (Sonnet worker, T3, ~5 resume cycles; lead-review **DO NOT MERGE → fixed → re-verified green**). First DOM/"Instruments" surface: §6 grid layout framing the canvas (top bar / players rail / bottom deck / log placeholder), `zustand@5` store (fixture `GameState` + dev `myPlayerId=playerOrder[0]`), all 8 §11 primitives w/ states (Button/Pill/PlayerCard/Panel/PhaseIndicator/TimerDisplay/SeedChip/EmptyState). **CRUX verified NO hidden-VP leak:** pure `renown.ts` derives PUBLIC renown (settlements+cities×2+awards from exported `CLASSIC_VICTORY_PROFILE`); own hidden VP gated to `myPlayerId` only; opponents show hand SIZE + `publicDevCardCount` only. i18n 7→44 keys ×ru/uk/en (build-gated). **lead-review BLOCKER (fixed):** bottom-deck resource pills were hue-only → added `resourceGlyphs.tsx` (5 distinct silhouettes) + `resource.*` name keys ×3 + per-pill accessible name `«{resource}: {count}»` (was generic "3 cards"); a11y test guards it. Also fixed S1.6.2 nit-2 (fixture income before city debit) + all 3 S1.6.6a nits (formatNumber counts, `a11y.languageSwitcher` key, LocaleSwitcher roving-tabindex) + emblem glow. client 45→79 tests (monorepo 301). Defers: log content, §8 dashboard/histogram, Trade UI (S1.6.4), interactivity/WS/live-timers (S1.6.5), mobile. `GameTable` host div `100vw/vh`→`100%` (fits grid; canvas logic untouched). **Follow-ups:** (1) resource silhouettes are placeholders → commissioned art later (§5); (2) consider exporting `publicVictoryPoints` from core to retire the client renown-mirror (rules-in-core hygiene). |
| S1.6.4 Trade UI (product heart) | ✅ **done — merged `d99c1af`** (Opus worker `78d79da`; lead-review **MERGE WITH NITS, no blockers** — review independently re-ran full verification green, client 104 / `-r` all 5 packages). Full §7 interaction: `OfferBuilder`/`OfferCard`(incoming/outgoing/history)/`TradeZone`, two-step seal (150ms arm guard), counter-in-place bounded at `depth>=1`, anti-misclick (accept/decline 16px, incoming = docked `<section>` not modal), pending-seal wax pulse (reduced-motion safe), 3 predefined quick-reactions (no free-text). Seam realized: components call ONLY `store.dispatchIntent(intent)` (pure UI stub — appends `tradeLog` + flips `pendingSeal`, NEVER mutates `gameState`, zero network — asserted); S1.6.5 swaps only the stub body. `canComposeOffer`/`canAffordBundle` + `flipToTargetPerspective` (give/get proposer→my-seat) pure+tested; core `validate` never called client-side. i18n 48 keys ×ru/uk/en (build-gated). **Contract correction:** core `BaseIntent` REQUIRES `playerId` (`validate.ts:844` rejects mismatch) — client composes `playerId: myPlayerId`; S1.6.5 contract fixed to match. **3 non-blocking review nits → folded into S1.6.5:** (1) `OfferCard` incoming `pending` prop is dead → after Accept the incoming card shows no pending + Accept stays enabled (double-dispatch possible; harmless in stub, MUST be handled when S1.6.5 adds real send+echo reconciliation); (2) dead i18n key `trade.dealSwap` (remove); (3) resource nouns capitalized mid-sentence vs DESIGN §7.2 lowercase example (minor typography, all 3 locales). |
| S1.6.5 WS client (live wire) | ✅ **done — merged `54d3ea9`** (Opus worker `ad54eaf`; lead-review **MERGE WITH NITS, no blockers** — reviewer independently re-ran the full suite green: core 211 / protocol 31 / server 42 / bots 1 / **client 141**, core byte-untouched, client imports NO `@skervik/server`). Framework-free net layer: `net/connection.ts` (pure — `ConnectionStatus` union, `statusForLeaveCode`, `parseJoinError`, NO colyseus import) + `net/wsClient.ts` (`attachRoom(room,cbs)` pure over structural `RoomLike` → mock-testable; `connect()` = thin real-`Client` wrapper). **Every inbound frame zod-validated** (per-envelope schemas incl. `event.batch = z.array(GameEventSchema)`), malformed dropped w/ dev-warn (can't crash the fold). **Isomorphic fold (ADR-0009 Fork 1)**: `applyEventBatch` folds via core `reduce` seeded by snapshot — NO parallel mirror; ordering guard `first.index < gameState.eventIndex` proven correct (=eventIndex is next-expected; test asserts real 2-event batch === independent `events.reduce(reduce,snapshot)` + eventIndex advance). **`pendingSeal` §7.6 server-truth**: cleared ONLY by own folded echo (`trade.offered` proposer===me / `trade.executed` accepter===me) OR `intent.rejected`/`intent.error` — someone-else's echo never clears (neg-tested); optimistic preview never mutates `gameState`. `myPlayerId` settable from `sessionId` (dev fixture fallback kept). Version-reject: `parseJoinError` JSON-parses+`ServerMessageSchema`-validates rejection → `version-mismatch` UI; non-version/parse-fail → generic `error`, never throws. `GAME_ROOM_NAME` **hoisted to `@skervik/protocol`** (server re-exports, zero behavior change; client never imports server). **3 carried S1.6.4 nits folded**: (1) IncomingCard reads `pending`→disables Accept/Decline/Counter (double-dispatch guard, LIVE not dead-prop); (2) dead `trade.dealSwap` removed; (3) deal-sentence nouns lowercased. **Trade-UI seam held**: `OfferBuilder.tsx`/`TradeZone.tsx` **byte-unchanged** (git-confirmed); only `OfferCard.tsx` (sanctioned nits) + store action bodies + net layer new. i18n 21 keys ×ru/uk/en (build-gated). **colyseus.js `^0.16.22`** (there is NO 0.17.x client line). **DEFERRED (not built):** server boot `listen()`/E2E, match-start orchestration, reconnect grace/bot-fill, server timers, guest auth/room codes, board-click intents. **3 review nits → follow-ups (non-blocking):** (1) `applyEventBatch` trusts server order (drops behind-batches but doesn't sort; core `reduce` doesn't assert index continuity → gapped batch silently mis-folds) — E1.7 hardening note; (2) add symmetric neg-test: `trade.executed` w/ `accepterId!==me` leaves my accept-seal intact; (3) `PendingSeal.turn` written but never read — use (stale cross-turn guard) or drop. **E1.7 FLAG:** colyseus.js@0.16 bundles `@colyseus/schema@^3` vs server's `@4.0.x` — M1 gameplay rides the message bus (stable), but lobby/late-join *Schema* state-sync must be verified in the real cross-process boot (E1.7). |
| **✅ E1.6 client FUNCTIONALLY COMPLETE** | board render + pieces + i18n framework + HUD + **Trade UI** + **live WS wire** (connect → snapshot-seed → isomorphic `reduce` fold → send intent → server-truth `pendingSeal`). The static-fixture client is now a live client against the authoritative room (mock-transport proven; real cross-process boot is E1.7). Only residual = S1.6.6 locale-string QA pass. **M1 core+server+protocol+client done (E1.1–E1.6).** NEXT: **E1.7 E2E + alpha** — S1.7.1 guest auth/rooms (Fastify) · S1.7.2 CI E2E full 3–4-client scripted match (server boot `listen()` + isomorphic replay-equality) · S1.7.3 seed reveal + `/verify` endpoint. **E1.7 closes the M1 GATE.** Carry into E1.7: the colyseus.js@0.16 `@colyseus/schema` v3-vs-v4 real-boot verification flag + the 3 S1.6.5 follow-up nits. |
| S1.6.6 residual locale content/QA | not materialized (framework already shipped as S1.6.6a; residual = locale-string QA pass across all E1.6 surfaces — can run alongside/after E1.7). |
| S1.7.1 guest auth + server boot (real `listen()`) | ✅ **done — merged `f109be6`** (Opus worker `fb4a4df`, resumed under **ADR-0011**; lead-review **MERGE WITH NITS, no blockers** — reviewer re-ran 449 tests green + git-verified byte-unchanged GameRoom/core/S1.6.5-tests, confirmed no boot race + genuine real-socket proof). **🔴 STEP 0 fired the STOP-gate → ADR-0011:** the spike found `colyseus.js@0.16` client CANNOT join `colyseus@0.17` server (matchmaking seat-reservation body shape changed between majors — nested→flat — TypeError *before* WS connect; worse than the flagged v3/v4 risk). Queen resolved: **client migrated `colyseus.js@0.16` → `@colyseus/sdk@0.17`** (`f3397b3`; net layer's structural-`RoomLike` absorbed it — only the `Client` import moved, S1.6.5 net/store tests re-green UNCHANGED), server stays 0.17+schema4 → **both sides schema v4, S1.6.5 v3/v4 flag RETIRED.** Boot (`9348b0a`): Fastify owns HTTP; Colyseus WS via `transport.attachToServer(fastify.server)` (`noServer:true`, upgrades only) + `/matchmake/*` MOUNTED into Fastify (`matchMaker.controller.invokeMethod`) + `matchMaker.accept()` awaited before serve — **NOT** `bindRoutes()`/`serverless()` (double-binds HTTP → `ERR_HTTP_HEADERS_SENT`). `createHttpServer()`/`startServer()`+`start` script; `createGameServer()` unchanged. `GET /health`→200; `POST /auth/guest`→`{guestId,displayName}` (anonymous, in-memory, opaque `randomUUID`, "NOT a security boundary in M1"). Protocol: `ConnectOptionsSchema` +optional `guestId`/`displayName` (protocolVersion still required + rejected first; drift-pins intact). **Real-socket proof** (`boot.test.ts`, real 0.17 SDK): join → seed-FREE `state.snapshot` + coherent DECODED v4 Schema (seedHash+seats+playerId===sessionId) + `event.batch` round-trip + version-mismatch REJECTED over socket. **GameRoom + core byte-unchanged** (git-confirmed); `PlayerId` stays `sessionId`; anti-spoof/`#queue`/seed-secrecy untouched. Client `fetchGuest()` before connect (`79e5a3f`, `VITE_API_URL`, never-throws→fixture fallback). Deps: fastify@5/`@fastify/cors`@11/`@colyseus/ws-transport`@0.17.13; `@colyseus/sdk`@0.17.43 (client + server devDep). 449 tests (core 211/protocol 34/client 146/server 57/bots 1). **Room-by-code → S1.7.1b** (not gate-critical). **3 review nits (non-blocking):** (1) onAuth WS close code is 4002 not the thrown 4001 (Colyseus wrapper; test asserts message payload — add clarifying comment); (2) malformed optional guest field → reject as PROTOCOL_VERSION_MISMATCH (pre-existing safeParse path, wider trigger, harmless); (3) no end-to-end test drives the 0.17 SDK reject through `parseJoinError`→`version-mismatch` (raw throw asserted; compose in S1.7.2) + stale "colyseus.js" comment `wsClient.test.ts:20` left to keep file byte-unchanged. |
| S1.7.1b room create/join-by-code | not materialized (fast-follow on S1.7.1's Fastify boot: `POST /rooms` + `joinById`/room-code metadata; invite-a-friend UX). |
| S1.7.2 CI E2E full 3–4-client scripted match | ✅ **materialized — DISPATCH AFTER nothing (S1.7.1 merged `f109be6`, dep cleared)** `S1.7.2-e2e-full-match.md` (T3 Opus + lead-review; large — may commit Phase A then B). **Phase A = match-start orchestration** (the missing trigger: room auto-starts on seats-full → emits `match.started`+`board.generated` via `generateBoard(seed,topology)` through the existing `#queue`/persist/broadcast pipeline; sanctioned GameRoom change — the "don't touch" was scoped to S1.7.1's boot story). **Phase B = cross-process E2E**: real boot → 3–4 `@colyseus/sdk@0.17` clients play a full Classic match to `game.ended` via a deterministic scripted TEST driver (NOT a bot — M2), asserting **(1)** victory reached (`computeVictoryPoints`≥10), **(2)** determinism (same seed+intents → deep-equal final), **(3)** **replay-equality** (persisted `events.ndjson`→`parseGameEventLog`→`replay` deep-equal to authoritative state — the event-sourcing gate + S1.7.3 seam), **(4)** seed-secrecy end-to-end. ≥1 trade exercised; driver must provably terminate (hard cap fails loudly, never hangs CI); named CI step (A2 discipline). Folds S1.7.1 review nit #3 (drive SDK reject through `parseJoinError`). Pins to S1.7.1's `startServer` surface confirmed at dispatch. |
| S1.7.3 seed reveal + `GET /matches/{id}/verify` | not materialized (recompute rolls from persisted log + revealed seed vs `seedHash`; brings the FS/DB `MatchMetadataStore`/`FsEventSink` prod impls; the year's headline «Честный жребий»). **Closes the M1 GATE.** |
