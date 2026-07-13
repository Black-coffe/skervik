---
spec: m2-mode-platform
status: ready-for-execution
owner: Queen (any top-model session — written for Opus 4.8, self-sufficient)
date: 2026-07-07
base-commit: 0b3348d (E2.1 S2.1.1–S2.1.4 merged; S2.1.5/S2.1.6 + E2.2–E2.6 remain)
---

# M2 — Mode platform & resilience: execution plan (Queen playbook)

**Mission (M2 GATE):** a multi-mode platform (Classic / Balanced / Blitz), 2–6 players,
single-player + multiplayer, **adaptive duration** (≤60 min), **catch-up** mechanics,
robust **reconnect + bot-fill**, **matchmaking + lobby + presence**, heuristic **bots**, and
**accounts**. (ROADMAP.md §M2, gate line; H2-2026 plan.) M1 shipped the deterministic Classic
slice; M2 turns "one engine" into "one engine configured many ways" and makes it survive real
players leaving, reconnecting, and being matched.

## 0. How to run this plan (process — read first)

1. **The Queen writes NO code.** Specs, stories, docs, orchestration, acceptance — yes. Any
   file under `packages/**` / `infra/**` — only via `worker-code` subagents. Even one-line
   fixes. (Constitution · owner directive 2026-07-03 · [[queen-no-code]].)
2. **Story cycle (the rhythm this session ran S2.1.1→S2.1.4):** materialize the next story
   file here (mirror `S2.1.1`–`S2.1.4` format) → `drone-scout` recon for exact file:line
   anchors → dispatch ONE `worker-code` (Sonnet T1–T2 / Opus T3–T4) with the story + map slice
   → worker implements on a feature branch, runs the FULL verify chain, commits (conventional,
   lowercase after `type(scope):`, body ≤100 chars — commitlint; footer needs a leading blank
   line) → Queen routes to `lead-review` (mandatory T3+, recommended for any server/fairness
   diff) → on MERGE, Queen merges `--no-ff`, pushes, deletes branch, marks the story done +
   updates §6 + memory. **Never merge without the owner's go-ahead unless they pre-authorized
   this story's flow.**
3. **One story = one branch = one worker dispatch.** SHARED worktree (isolation stale-bases
   this repo — [[vulyk-isolation-worktree-stale-base]]); do not git-write while a worker runs
   ([[vulyk-shared-worktree-git-race]]). Parallelize only stories with no shared files.
4. **Subagent comms gotcha (observed all session):** scouts/workers/reviewers often send only
   an `idle_notification`, not their report. **Request the report explicitly via SendMessage**;
   if a subagent stays stuck idle without content, **spawn a fresh one** (that unblocked
   `s214-scout`→`s214-scout2`). The report text is what you need, not the idle ping.
5. **Rebuild core before server tests** (`pnpm -r build` before `pnpm --filter @skervik/server
   test`) — the stale-dist gotcha bites every server story ([[server-intent-pipeline-serialization]]).
6. **Verification is the worker's job; acceptance is the Queen's.** Full chain:
   `pnpm --filter @skervik/core test && pnpm -r build && pnpm --filter @skervik/server test &&
   pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm -r build &&
   node scripts/check-core-no-runtime-deps.mjs`.

## 1. Hard invariants (check EVERY M2 story against these)

- **Determinism boundary now spans the server.** The core stays PURE — no `Math.random`/
  `Date`/`setTimeout`/ambient state in `packages/core` (ESLint + `check-core-no-runtime-deps`
  guard). **All wall-clock, timers, Redis, network liveness live server-side ONLY.** Anything
  that must REPLAY goes into the event log as a deterministic event with **no timestamp** — the
  S2.1.4 turn-timer pattern is the template: on a wall-clock trigger, inject a deterministic
  action through the authoritative pipeline; the log records the RESULT, never the clock.
- **Profiles are config, not code branches — and this is now REAL** (S2.1.1). Every mode /
  catch-up / timer knob is a `RuleProfile` field **added WHEN its behavior ships** (Law 2 — no
  dead config), delivered to the pure engine via `state.profileId` + `loadRuleProfile` (resolved
  INSIDE reduce/validate; the engine contract signatures are LOCKED — never a new positional
  arg). NO `if (mode === 'blitz')` branches in rule code.
- **Seed is NOT in `GameState`** — 4th param of `validate()`; commit-reveal intact. Every
  seed-derived draw anchors to the verifier's OWN position counter (S1.7.3 positional binding,
  [[commit-reveal-verify-positional-binding]]) — any new randomness (catch-up event tiles?) must
  follow it and stay verify-covered; prefer deterministic-from-state policies over new seed slots
  when a draw needn't be "fair-random" (the S2.1.4 discard-policy precedent).
- **`verifyMatchRandomness` must stay profile-aware.** S2.1.2 discharged the deck+randomness
  legs; the **board leg is still open** ([[verify-profile-blindness-carryforward]]) — the first
  board-diverging profile (2-player trimmed board, S2.1.6) MUST rewire the verifier's board
  recompute onto `loadRuleProfile(state.profileId).board`.
- **Authoritative server + `#queue` single-serialization.** Colyseus doesn't serialize async
  handlers; every state mutation (real intent, timer-forced action, bot move, reconnect resync)
  funnels through the room's `#queue` and the ONE shared `#applyAuthoritativeIntent` tail — never
  a floating callback ([[server-intent-pipeline-serialization]]).
- **No karmic bans** (product law). Reconnect ≥120s grace + bot-fill + safe leave/rejoin; a
  disconnect never forfeits a game. The S2.1.4 anti-AFK `idle`/`consecutiveMisses` flags are the
  hooks E2.3 bot-fill consumes.
- **Trilingual RU/UA/EN (ADR-0008) + a11y from the first line** for ALL new user-facing strings
  (lobby, adaptive warnings, account/GDPR UI, bot display names). **Core/protocol emit STRUCTURED
  codes, never localized prose** (the S2.1.3 `warningCode` precedent); the UI localizes. Lobby UI
  (S2.5.4) binds root `PRODUCT.md` + `DESIGN.md` (tokens, zoning, a11y/i18n merge gates) — owner
  sign-off for deviations. i18n mechanism = ADR-0010 (typed catalogue, missing key fails build).
- **Colyseus/schema versions aligned** ([[colyseus-version-alignment]]): client `@colyseus/sdk`
  ↔ server `colyseus` majors must match (0.17 + schema4, ADR-0011); Fastify boot via
  `attachToServer` + mounted matchmaking.

## 2. Epic order (anchored to ROADMAP.md §M2)

| # | Epic | Stories (tier) | Target | Notes |
|---|---|---|---|---|
| 1 | **E2.1 Rule Profiles engine** | S2.1.1 profile engine ✅ · S2.1.2 Balanced Deck ✅ · S2.1.3 adaptive-duration ✅ · S2.1.4 turn timers ✅ · **S2.1.5 parallel phases [T3]** · **S2.1.6 2-player mode [T2→T3]** | mostly DONE | S2.1.6 unblocks the verify board-leg |
| 2 | **E2.2 Catch-up (profile-gated)** | S2.2.1 friendly robber ✅ · S2.2.2 robin-hood/poverty ✅ · S2.2.3 final round + hidden VP ✅ · S2.2.4 catch-up event tiles ✅ | **DONE 4/4 — EPIC CLOSED** | each = a profile flag added with its behavior. S2.2.1 hardened the S2.1.4 forced-robber path (CI-guarded). S2.2.2 opened the `catchUp` sub-profile (tech-spec §180) — S2.2.3/S2.2.4 flags join it; added persistent `povertyTokens` GameState field. S2.2.3 added `finalRound`+`hiddenVp` booleans + `finalRound?` GameState field (additive/absent when off); win-check now uses `thresholdVp` (public-VP under `hiddenVp`); turn-end can end the game (Splendor round); forced-action hang risk CLOSED for the robber+finalRound legs. **S2.2.4 (`0aeeb4f`) added `eventTiles` flag + `eventTilesInterval` param + additive `sevensRolled?` counter: every Nth storm (7) ALSO grants trailing player(s) a poverty token, REUSING S2.2.2 `computePovertyGrants(state,{})` + `poverty.tokensGranted` (no new event, no protocol/verify change, no seed); robber/discard legality UNCHANGED → forced-action hang stays CLOSED; off on all presets → Classic byte-frozen. lead-review MERGE WITH NITS.** |
| 3 | **E2.3 Resilience: reconnect & bot-fill** | S2.3.1 grace ✅ · S2.3.2 in-tab resync ✅ · S2.3.2a reload-resume ✅ · S2.3.3 bot-fill on expiry ✅ | ✅ **DONE 4/4 — EPIC CLOSED** (`e8d3172`+`a9d42fd`+`e1c8d73`+`481c72d`) | disconnect never forfeits (grace+reconnect) and never stalls (bot-fill on expiry); game-end consented-close fixed |
| 4 | **E2.4 Bots (AI)** | S2.4.1 bot worker harness ✅ · S2.4.2 heuristic bot v1 ×3 difficulty ✅ (+ S2.4.2a core-fix ✅) · S2.4.3 single-player + bot-fill integration ✅ | **DONE 3/3 — EPIC CLOSED** | in-process module consuming `@skervik/core` (separate process deferred to M5). S2.4.3 (`1da5022`) wired v1 into the authoritative `#queue`: bot-seat type (`isBot`/`botDifficulty` on `SeatSchema`), `bots:[{difficulty}]` room option minting `bot-N` seats at genesis + `#bots` map, a proactive `#scheduleBotTurnIfNeeded`/`#driveBotTurn` loop through the EXISTING tail (`client===undefined`, no 2nd apply path), null/illegal → `resolveForcedAction` fallback + per-turn cap (fail-loud). Bot match-seed-blind (`seed:'bot-${i}'`), events carry no timestamp/marker → replay byte-identical, Classic byte-frozen. **CLOSED the last leg of [[turn-timer-forced-action-hang-risk]]** (setup null-return proven geometrically unreachable). lead-review MERGE WITH NITS. |
| 5 | **E2.5 Lobby, matchmaking, presence** | S2.5.1 Redis presence/queues/pubsub/sticky [T3] · S2.5.2 matchmaking by mode + preview [T2] · S2.5.3 private rooms by code/link [T2] · S2.5.4 Lobby UI: settings+map preview+ready-up [T2] | late-M2 | S2.5.4 resolves the profile-override delivery seam |
| 6 | **E2.6 Persistence & accounts** | S2.6.1 Postgres schema+migrations [T2] · S2.6.2 OAuth+guest-upgrade+JWT [T3] · S2.6.3 match metadata + event-log→S3 [T2] · S2.6.4 GDPR delete/export [T2] · S2.6.5 solo save/resume [T2, non-gating] | late-M2 | first DB + first external-auth surface |

**Dependency spine:** E2.1 (config backbone) → E2.4 harness (bots need the engine) → E2.3
(bot-fill needs bots) ‖ E2.2 (catch-up, independent, profile-gated) → E2.5 (lobby ties mode
selection + matchmaking + presence together; Redis first) → E2.6 (accounts persist it). E2.2 can
run in parallel with the E2.4→E2.3 chain. Materialize stories just-in-time from ROADMAP.md +
the §3 notes below.

## 3. Domain notes per epic (so no story needs re-research)

**E2.1 — remaining two stories.**
- **S2.1.5 parallel phases (simultaneous trade & discard) [T3].** Today the discard-on-7 phase
  already lets NON-current players act (`playersToDiscard` carve-out in `validate`), and the
  S2.1.4 forced-discard cascades all owers — so "parallel discard" is largely present; S2.1.5
  formalizes it + adds **parallel trade** (multiple offers open at once). Risk: concurrent
  offers through the single `#queue` — validate each against current state at execution time
  (offers can be invalidated by an intervening swap); a `parallelPhases` profile flag gates it.
  Keep atomic-swap-in-one-event (M1 trade invariant). This is a `#queue`/validate-ordering story,
  not new randomness.
- **S2.1.6 2-player mode (phantom player / limited trade / trimmed board) [T2, likely T3].**
  This is the FIRST board-diverging profile → it MUST (a) add a `board` variant to the profile
  (smaller tile/token set), (b) teach `generateBoard` a radius/size param (boardgen topology
  work — the real cost), (c) **discharge the verify board-leg** ([[verify-profile-blindness-carryforward]])
  by resolving the verifier's board from `state.profileId`, and (d) handle 2p trade limits +
  the phantom-player/neutral mechanic. Because of (b)+(c) treat as T3, Opus. It also unblocks
  **setup-phase forced-placement** (the deferred S2.1.4 gap) once topology helpers exist.

**E2.2 — Catch-up (all profile-gated flags; add the flag WITH the behavior).**
- S2.2.1 friendly robber: can't rob a player ≤2 VP (T1). S2.2.2 robin-hood/poverty tokens.
  S2.2.3 final round (Splendor-style trigger) + hidden VP until the trigger. S2.2.4 catch-up
  event tiles (some 7s → boosts). Each is a `RuleProfile` catch-up flag consumed in reduce/
  validate. **CRITICAL CROSS-CHECK:** any rule that changes discard/robber legality re-opens the
  S2.1.4 forced-action hang risk ([[turn-timer-forced-action-hang-risk]]) — the story that
  changes legality MUST also add the re-arm watchdog + no-progress `break` + per-kind timer test.
  New randomness (event tiles) follows the S1.7.3 positional-binding + verify coverage.

**E2.3 — Resilience.** Reconnect tokens + grace ≥120s (a player disconnects → their seat is
held, NOT forfeited); full `room.state` resync on rejoin (Colyseus state-sync + a snapshot
message — the S1.7.x StateSnapshot pattern); bot-fill on disconnect (S2.3.3) drives the absent
seat via the E2.4 bot through the SAME `#queue`. **Coordinate with S2.1.4 turn timers:** decide
whether a turn timer PAUSES during the grace window or the bot plays it — this is the deferred
S2.1.4 "reconnect/grace coordination" item. Consume `seat.idle`/`consecutiveMisses`. No karmic
bans, ever.

**E2.4 — Bots.** Bot worker harness = a SEPARATE process (`@skervik/bots`) consuming the pure
core (`validate`/`reduce`) — it holds NO authority; it emits intents like a client. The
`decideAction` heuristic from S1.7.2 `scriptedDriver` (expansion-first, [[e2e-scripted-driver-expansion]])
is the seed of heuristic-bot-v1; ×3 difficulties = depth/greed knobs. Single-player = a room
filled with bots. Bots must be deterministic-enough for tests but may use their own RNG (they're
not the authority — only the server's seed is fair-audited). **Design-for-reuse (added 2026-07-07):**
expose the heuristic's board/action *evaluation* as a reusable module inside `@skervik/bots` —
the M4 E4.8 assist-mode advisor ("profitable spots" hints) consumes the same evaluation; bot and
advisor share one brain, so don't bury scoring inside the decision loop.

**E2.5 — Lobby, matchmaking, presence.** Redis first (S2.5.1): presence, matchmaking queues,
pub/sub, **sticky room routing** (a match lives on one node — periphery is stateless, per the
architecture). Matchmaking by mode + room preview; private rooms by code/link + one-click guest
invite (no signup). **S2.5.4 Lobby UI** is where several threads converge: (a) mode/profile
SELECTION (finally lets a human pick Balanced/Blitz — GameRoom has hardcoded `'classic'` since
S2.1.1); (b) **resolve the profile-override delivery seam** ([[adaptive-profile-override-delivery-seam]])
— the lobby runs `computeAdaptiveDuration`, and the chosen/adjusted profile must reach the match
via `match.started` (record the override so replay/verify resolve identical rules — likely an
optional `profileOverride` in the genesis event, or register computed configs; an ADR may be
warranted); (c) render the S2.1.4 `turnDeadline` countdown + LOCALIZE the adaptive `warningCode`
(RU/UA/EN); (d) map preview. Binds `PRODUCT.md`/`DESIGN.md` + ADR-0008/0010.

**E2.6 — Persistence & accounts.** Postgres schema + migrations (users, matches, match_players)
— migration history becomes a no-go-zone once it exists. OAuth (Google/Discord) + guest upgrade
+ JWT/refresh (first external-auth surface — `/security-review` before merge). Match metadata +
event-log to S3-compatible storage (`matches/{id}/events.ndjson` — the durable sink the room
already writes; S2.6.3 moves it off local FS). GDPR self-service delete/export.
**S2.6.5 solo save/resume (added 2026-07-07, research-gap closure):** reconstruct a LIVE room
from the persisted event log — the same `replay(events)` path crash recovery uses, so the cost
is a room-bootstrap seam + a "my games / continue" list (REST + client), not new engine work.
Depends on S2.4.3 (solo mode exists) + S2.6.3 (log is durable). **Non-gating for M2** — the M2
gate is unchanged; ship it when E2.6 lands or let it slip without blocking the milestone. Async
E4.1 (multiplayer play-by-turn) does NOT cover this — see ROADMAP.md S2.6.5.

## 4. Open seams / carry-forward ledger (assign each to its owning story)

| Seam | Owner story | Memory |
|---|---|---|
| verify **board-leg** (verifier still Classic-board-hardcoded) | a future **trimmed-board / variable-radius** story (S2.1.6 chose phantom on the STANDARD board → board does NOT diverge, so it does NOT discharge this) | [[verify-profile-blindness-carryforward]] |
| **profile-override delivery** (adjusted non-preset profile → live match; state carries only `profileId`) | **E2.5 / S2.5.4** (lobby-apply; record in `match.started`) | [[adaptive-profile-override-delivery-seam]] |
| turn-timer **forced-action hang** — ROBBER leg discharged by S2.2.1; **finalRound leg CLOSED by S2.2.3** (`08cc776`: turn-end game-end changes NO per-action legality — forced `endTurn` stays legal all round; server re-arm reads `phase:'finished'` → arms no timer, `GameRoom.ts:764`). Still applies to **S2.2.4** event tiles if they change discard/robber legality, and **S2.1.6** setup forced-placement | [[turn-timer-forced-action-hang-risk]] |
| **setup-phase timeout auto-placement** (S2.1.4 returns `null` for setup) | **S2.1.6** (needs board topology helpers) | (in S2.1.4 spec) |
| adaptive calculator's **timer/board/parallel levers** (only VP is live) | added WITH each lever's delivery (post-S2.5.4 override) | S2.1.3 spec Key-decision 4 |
| **signed / hash-chained event log** (M1 residual: can't detect seamless event OMISSION in verify) | pre-ranked (M3) — optional in M2, revisit before competitive integrity matters | M1 close note |
| ~~robber-steal-eligibility duplication~~ **DISCHARGED by S2.2.2** (`c759090`): `isStealable(state,id,robber)` extracted + used at both validate.ts sites + forcedAction.ts; `computeVictoryPoints = computePublicVictoryPoints + hiddenVP`. Behavior-preserving (S2.2.1 + victory suites green unchanged, lead-review confirmed). | ✅ done | S2.2.1 nit → S2.2.2 |
| **robinHood exchange-rate guard** (S2.2.2 nit): discounted-trade legality accepts `robinHoodExchangeRate` without asserting it beats the actor's natural port rate — harmless while default 2 ≤ every natural rate, but a future profile setting rate > a port rate needs a guard. Also: reduce's `poverty.tokensGranted` case doesn't re-cap (trusts validate — unreachable via honest emission). | revisit when a preset first sets `robinHood:true` (batched preset-assignment) | S2.2.2 lead-review nits |
| **eventTilesInterval `> 0` guard** (S2.2.4 nit): validate computes `((sevensRolled ?? 0)+1) % eventTilesInterval`; if a future config set interval `0`, `x % 0 === NaN` → `NaN === 0` is `false` → the mechanic silently never grants (no crash — a dead flag, not a failure). Harmless today (all presets = 3, `eventTiles:false`). Assert `eventTilesInterval >= 1` at profile-load, or document the floor. | revisit when a preset first sets `eventTiles:true` (batched preset-assignment — same story as the robinHood-rate-guard nit) | S2.2.4 lead-review nit |
| ~~**v0 bot brain seed-fragility**~~ **ROOT CAUSE FOUND + FIXED**: the v0/v1 seed-stall was NOT bot quality — it was the [[core-bank-conservation-bug]] (builds/discards destroyed resources → bank drained → production froze). Fixed by **S2.4.2a** (`8129962`). S2.4.2's seed-sweep should now pass on resume. | ✅ resolved (S2.4.2a) | S2.4.1 finding → S2.4.2a fix |
| ~~**game-end consented-close** (S2.3.2a nit #3)~~ ✅ **DONE by S2.3.3** (`481c72d`): game-end schedules `disconnect(CONSENTED=4000)` (500ms defer so the `game.ended` batch flushes) → client maps 4000→`disconnected`→clears reconnect pointer → no wasted resume on a post-match reload. | ✅ done | S2.3.2a nit #3 → S2.3.3 |
| **bot-fill re-eval on reconnect** (S2.3.3 lead-review nit #1): in a narrow race — BOTH humans in a 2p match dropped-in-grace at once — when h1's grace expires the "no-connected-human-remains" guard skips its fill; if h2 then reconnects, h1's seat is never re-evaluated → h2 faces a PASSIVE seat (forced-defaults still pass h1's turns, so NO stall — a competent-bot-vs-passive quality gap only). | future refinement (re-evaluate un-filled expired seats when a human reconnects) — non-gating | S2.3.3 lead-review nit #1 |
| **reconnect-grace ≥120s floor** (S2.3.1 lead-review nit): `reconnectGraceSeconds` is unclamped (default 120; only tests pass sub-120). Harmless now (no external setter), but once a lobby/operator can supply it, a value < 120 would silently shorten the no-karmic-ban window below the product law. | **E2.5 / S2.5.4** (lobby-apply — enforce `Math.max(120, …)` or documented validation when grace becomes settable) | S2.3.1 lead-review nit |
| **single-player seating order** (S2.4.3 lead-review nit #3): bots are minted at genesis, the human joins AFTER → the human never takes the first snake-draft setup placement. Purely seating-order/UX, harmless to correctness. | **E2.5 / S2.5.4** (lobby owns seat ordering + ready-up — arrange the human's seat index before start) | S2.4.3 lead-review nit #3 |
| **adaptive duration trades comeback for time** (S2.2.5a, NEW): `computeAdaptiveDuration` lowers `vpToWin` to fit the 60-min ceiling. Under matched cuts that costs ~1.5pp of comeback per VP surrendered (14.6/13.2/11.3% at V=10/9/8) — runaway-leader is one of the two chronic pains the product exists to design out. Bounded: stopping-rule channel only, `vpToWin`-blind bots; Blitz's timers were never measured (action-capped sim). | **S2.1.3 / S2.5.4** — weigh explicitly; a lower threshold is not a pure duration knob | [[bot-sim-blind-spots]] |
| **`eventTiles` without `robinHood` is dead config** (S2.2.5 Diagnostic B, code-proven): `spendPovertyToken` has ONE call site gated on a short-circuiting `catchUp.robinHood`. Tokens are granted into a void. | **S2.2.6** (load-bearing assert G2) | — |
| ~~**robin-hood discount unreachable by the v1 bot**~~ **DISCHARGED by S2.4.4**: `povertyDiscountRate` (bots `eval/features.ts`) mirrors validate's discount branch and returns a rate only when it strictly beats `bestBankRate`, so a token is never burned for a rate a port already gives. 0 → 63,875 discounted trades / 5000 matches. `isTrailing` exported from core (one definition, not two). | ✅ done | [[bot-sim-blind-spots]] |
| **`robinHood` is UNMEASURED — commission no further simulation for it** (S2.4.4, owner-ratified 2026-07-10). H4 (+1.5pp comeback, p=0.0256) is **RETRACTED**: with the bot reading `catchUp.robinHood` the arms no longer share an event prefix, so `T*` and the trailing set are post-treatment (collider). The prefix-clean estimator (anchor only on the shared pre-divergence prefix, paired McNemar) gives χ²=1.88, p≈0.17 over 4000 seeds — and is itself unusable: 3066/4000 diverge before `T*`, so the eligible 18% are selected for *low* treatment exposure. Third struck balance result; the mechanic is agency-mediated and bots have no agency. | **OWNER** — preset assignment decided by human playtest, not by sim | [[bot-sim-blind-spots]], [[collider-conditioning-in-review]] |
| **bot discounts only trades it could already afford** (S2.4.4 nit): `bankTradeToward` picks its candidate at the player's **natural** rate (`v1.ts:281`, `held >= rate && surplus >= rate`) and applies the discount afterwards. So the discount fires only for a trailing player already holding 4+ of a resource; the resource-poor trailer `robinHood` exists to rescue never generates a candidate. Not a correctness bug (the proposed `count` is always ≤ what the player holds, so `validate` never rejects it → no hung bot turn); it is a *measurement* hole and a bot-quality gap. | non-gating; fold into whatever story next touches v1's trade candidates | S2.4.4 in-session review |
| **a runtime-built profile bypasses all three guards** (S2.2.6 lead-review forward note): `validateRuleProfile` runs at module init over `PROFILE_REGISTRY`'s frozen constants and is NOT re-exported from `core/src/index.ts`. Correct today — but the lobby will construct an adjusted non-preset profile at runtime, and nothing validates it. | **S2.5.4** — export it and call it wherever a profile is built at runtime | ties to [[adaptive-profile-override-delivery-seam]] |
| **invariant comments no test binds** (S2.2.6, NEW and generalizable): `reduce.ts:733` claimed `poverty.tokensGranted` is "only emitted under `robinHood:true`". **False on `main` for two epics** — S2.2.5 measured 3,983 such events with the flag off. It survived every review because nothing forced it, and the same class of unbound claim propagated the false `hiddenVp` premise from a doc-comment into the wiki. A test fails when it lies; a comment never does. | a `lead-review` sweep of `reduce.ts`/`validate.ts` — each finding gets a forcing test or a softened comment | — |
| **anchor-scoring guard: outer quantifier unstated** (S2.2.6 lead-review residual, optional): the bug-class test picks its line with `.find(...)`, so a *second*, lying `- anchor scoring:` line passes unseen. `.filter(...)` + `length === 1` closes it. Variant E (a separate `- baseline profile:` line) stays open by design — forbidding it means pinning the whole header. | follow-up, non-gating | — |
| **`lastPlacePlayers` still exported** from `sim/index.ts` though `@deprecated` (S2.2.5a lead-review nit 2) — the JSDoc is all that stands between the defective function and a future caller. Drop it from the barrel; `metrics.test.ts` can import it directly. | **S2.2.6** | — |
| **sensitivity outcome retained though it cannot arbitrate** (S2.2.5a lead-review nit 3): it conditions on tie-freeness at an endogenous midpoint — a post-treatment collider — and costs a second full fold of every log. Kept as a cross-check against the reviewer's independent replication. | **S2.2.6** — decide, don't inherit silently | — |
| ~~**Balanced = balanced_deck + `vpToWin: 9`**~~ **REVOKED 2026-07-09.** The owner approved it on H2/H3, which the corrected metric voided (and reversed). No preset gains a flag or a threshold change until a mechanism is demonstrated. | ✅ revoked | [[metric-must-be-invariant-to-treatment]] |
| **setup-payout bank mint** (S2.4.2a lead-review nit): `settlement.placed` setup payout (`validate.ts:1283`) grants starting resources WITHOUT debiting the bank → a full match FROM setup holds slightly >95 in the system, and S2.4.2a's uncapped build/discard credit can push `bank[k]` above `bankPerResource` (19). PRE-EXISTING, OPPOSITE-direction (mint, not destroy), NON-FATAL (more resources → less starvation; the build/buy/discard LOOP still conserves exactly 95, proven). Mirrors the existing uncapped `bank.trade` give-side credit. | owner call whether to enforce strict 95-across-a-full-match (debit setup payout + cap the credit at 19) — a separate small core story; not gating M2 | S2.4.2a lead-review nit |

## 5. Tier & model routing (token economy)

- **T1–T2 → Sonnet `worker-code`** (the S2.1.3 precedent: a pure/isolated module with no
  determinism/fairness/contract surface). **T3–T4 → Opus `worker-code` + mandatory `lead-review`**
  (S2.1.1/S2.1.2/S2.1.4: deterministic core, the verifier, or the wall-clock↔core boundary).
- **Any server/fairness/determinism diff gets `lead-review`** regardless of nominal tier — the
  reviewer independently re-runs the full chain and traces the load-bearing invariant (this
  session caught nothing blocking because the specs front-loaded the landmines, but the gate is
  what makes that safe to rely on).
- Recon on Haiku/`drone-scout`; docs/memory on `drone-docs`/`librarian`. Queen = specs +
  orchestration only.

## 6. Status (update after every merge)

| Story | Tier | Status | Merge |
|---|---|---|---|
| S2.1.1 RuleProfile engine | T3 | ✅ done | `2dee89d` |
| S2.1.2 Balanced Deck | T3 | ✅ done | `43fa167` |
| S2.1.3 adaptive-duration | T2 | ✅ done | `f0738b6` |
| S2.1.4 turn timers + anti-AFK | T3 | ✅ done | `4d149e0` |
| S2.1.5 parallel trade | T3 | ✅ done | `06e080d` |
| S2.1.6 2-player mode (phantom, standard board) | T3 | ✅ done | `f0d69b7` |
| S2.1.7a 5–6 player expanded board — CORE | T3 | 🔨 **dispatched** — ADR-0013 radius-3 (37 tiles); parameterize `buildTopology(radius,portSlotCount)` + `topologyForRadius` memo (replace singleton); `EXPANDED_PROFILE`/`EXPANDED_BOARD`; **verify board-leg discharge** (resolve topology+board from `profileId` — closes [[verify-profile-blindness-carryforward]]); G4 guard; Classic byte-frozen; core-only | — |
| S2.1.7b 5–6 player — CONSUMERS | T3 | ▫ next after 7a — route server(`GameRoom`)/client(`GameTable`)/bots through `topologyForRadius`; `maxSeats`→6 + lobby routes ≥5 to `expanded`; bots play the big board (owner-approved); 5–6p cross-process e2e (single + multi + verify) | — |
| S2.2.1 friendly robber | T2 | ✅ done — first E2.2 mechanic; lead-review MERGE | `cd4b876` |
| S2.2.2 robin-hood / poverty tokens | T3 | ✅ done — Option A (self-comp); discharged dedup; lead-review MERGE | `c759090` |
| S2.2.3 final round + hidden VP | T3 | ✅ done — Splendor round-to-circle + public-VP threshold; forced-action no-hang CLOSED; lead-review MERGE | `08cc776` |
| S2.2.4 catch-up event tiles | T2 | ✅ done — deterministic poverty-token boost on every Nth storm; reuses S2.2.2 grant; no new event/protocol/verify/seed; Classic byte-frozen; lead-review MERGE WITH NITS | `0aeeb4f` |
| E2.2 catch-up (×4) | T1–T3 | ✅ **DONE 4/4 — EPIC CLOSED** (all merged, each lead-reviewed) | — |
| S2.4.1 bot worker harness | T2 | ✅ done — `@skervik/bots` opened: S1.7.2 `decideAction` MOVED byte-identical (server E2E re-shims, 103/103 green), `Bot` seam (no seed/no authority) + in-process `simulateMatch` (fail-loud cap, full match 278 turns); no core/server-room change; lead-review MERGE WITH NITS | `57efc8c` |
| **S2.4.2a core bank-conservation fix** | T3 | ✅ done — CORE BUG surfaced by S2.4.2 bot seed-sweep: builds/dev-buys/discards destroyed resources (bank never refunded) → long matches froze production. Fix (reduce-only): `creditBank` in 5 cases from the event's own payload; `bank+hands` conserves 95; re-golden surface verified EMPTY; no validate/verify/protocol/seed/bot change; +4 tests, core 326; lead-review MERGE. Unblocks S2.4.2 | `8129962` |
| S2.4.2 heuristic v1 ×3 difficulty | T3 | ✅ done — scored brain over a shared weighted-feature eval module (`eval/`, M4-advisor-reusable); ×3 difficulty = feature set + selection noise (hard=argmax/medium=light noise/easy=top-K); independent bot PRNG (match-seed-blind); seed-sweep 24×3 all terminate (≤489t), hard 64% vs easy 18%; v0 FROZEN (S1.7.2 green); lead-review MERGE WITH NITS. **Owner-ratified deviation:** easy keeps a low-weight (20) dev-card path for termination (no-stall > "easy ignores dev cards"). Nits: knight-play mild scope-ext (contained); strength floor weak (optional tighten) | `62400ca` |
| S2.4.3 single-player + bot-fill | T2 | ✅ done — v1 bot wired into the authoritative `#queue` via a proactive drive loop reusing the forced-action tail (`client===undefined`); bot-seat type + `bots:[{difficulty}]` option + `#bots` map; match-seed-blind (`bot-${i}`); no-hang (forced-action fallback + per-turn cap, setup null proven unreachable); no core/bots/verify/contract change; Classic byte-frozen; +6 E2E; lead-review MERGE WITH NITS. **Established the reusable bot-drive seam E2.3/S2.3.3 consumes.** | `1da5022` |
| S2.3.1 reconnect tokens + grace ≥120s | T2 | ✅ done — native Colyseus `allowReconnection` seat-hold via `onDrop`(non-consented→grace)/`onLeave`(consented→no hold); reclaim by `sessionId` (no identity remap, no `onJoin`); `reconnectGraceSeconds` room option (default 120); grace does NOT pause the turn timer (owner-confirmed — forced defaults keep the match moving; **closes the deferred S2.1.4 grace-coordination item**); expiry = seat held `connected:false`, NO forfeit; TRANSPORT-only (zero `gameState` mutation, zero events → determinism byte-untouched); no core/bots/protocol/schema/client change; +6 tests (server 114). lead-review MERGE (post-expiry terminal `onLeave` proven harmless no-op vs installed `@colyseus/core@0.17.44`). | `e8d3172` |
| S2.3.2 full state resync | T2 | ✅ done — closed the reconnect loop for the IN-TAB case: client persists `reconnectionToken` + `client.reconnect(token)` on unexpected drop + synchronous re-attach (beat the resync race, no new protocol msg); server unicasts a fresh seed-free `StateSnapshotMessage` at the reclaim seam via `#sendSnapshot(liveClient)` (Colyseus 0.17 swaps the `Client` on reconnect → must look up `this.clients.find(sessionId)`, NOT the stale `onDrop` ref — undocumented quirk, in-scope fix); handle stays same object across reconnect; determinism byte-untouched (zero events/no gameState/no seed); reused snapshot msg + `reconnecting` indicator; +10 tests (server 115, client 155); lead-review MERGE WITH NITS. **Nit #1 → S2.3.2a:** persisted token is write-only in prod → page-reload resume NOT yet delivered (only in-tab blip recovers); Goal over-promised vs acceptance criteria. **Nit #2 → S2.3.2a:** client retry ~1s vs 120s grace. | `a9d42fd` |
| S2.3.2a resume-on-load + retry budget | T2 | ✅ done — PAGE RELOAD now resumes the held seat: `current-room` pointer (fixed sessionStorage key) lets a cold-load `connect()` read the token → `client.reconnect(token)` (self-contained) BEFORE `joinOrCreate`, wired through the SAME `attachRoom` (fallback to fresh join on reject); retry 3→8 (~31.5s, bounded). **Forcing cold-load test** proves reconnect is called from prod `connect()` + snapshot folds (fails if `attachRoom` dropped — anti-write-only guard, closes the S2.3.2 lesson [[spec-goal-must-match-acceptance-criteria]]). Client-only (server reclaim+resync unchanged); +13 tests (client 163); lead-review MERGE WITH NITS (cosmetic pointer-clear symmetry). | `e1c8d73` |
| S2.3.3 bot-fill on expiry + safe-leave | T3 | ✅ done — Fork B (owner): on grace EXPIRY (`onDrop` `.catch()`) + on a CONSENTED leave, `#botFillSeat` mints `createHeuristicBot({difficulty:#botFillDifficulty, seed:'bot-fill-${i}'})` → adds `playerId` to `#bots` (reuses S2.4.3 `#driveBotTurn` wholesale — `#nextBotActorId` gates on `#bots.has` alone) + flips `isBot`/`botDifficulty` (no new SeatSchema field). 3 guards: double-install (`#bots.has`), terminal-notice non-consented, **no-connected-human-remains** (skips pointless bot-vs-bot + a teardown log-write — worker deviation, review-confirmed correct). Game-end closes clients `disconnect(CONSENTED=4000)` (500ms defer so `game.ended` flushes; `#gameEndClosing` latch) → client clears reconnect pointer = **fixes S2.3.2a nit #3**. Match-seed-blind, replay byte-identical (test), Classic byte-frozen; no core/protocol/bots/schema-field change; +5 E2E (server 120); lead-review MERGE WITH NITS. | `481c72d` |
| E2.3 reconnect & bot-fill (×4 incl. S2.3.2a) | T2–T3 | ✅ **DONE 4/4 — EPIC CLOSED** (S2.3.1 grace + S2.3.2 in-tab + S2.3.2a reload + S2.3.3 bot-fill; each lead-reviewed). Disconnect NEVER forfeits AND never stalls the table. | — |
| E2.4 bots (×3) | T2–T3 | ✅ **DONE 3/3 — EPIC CLOSED** (S2.4.1 harness + S2.4.2 v1 ×3 + S2.4.2a core-fix + S2.4.3 server wiring; each lead-reviewed) | — |
| S2.2.5 balance-sim harness | T2 | ✅ done — profile-parameterized bot-vs-bot sweep (`@skervik/bots` `sim/`): paired McNemar + Wilson CIs + mandatory confound audit; **matched anchor cuts are the DEFAULT** for any cross-profile contrast, an arm can never score itself (forcing guard). Classic byte-frozen (`match.started` omits `profileId` for classic — the byte-freeze mechanism); `harness.test.ts` unmodified. lead-review **BLOCK** → S2.2.5a → MERGE WITH NITS | `704b3ae` |
| S2.2.5a comeback-metric correction | T3 | ✅ done — the original metric counted the winner being among the players **tied** for last at an *endogenous* midpoint; tie-set size grows as `vpToWin` falls, so the metric moved with the treatment. H2/H3/hiddenVp all VOID. Replaced by an exogenous anchor (`T*` = leader first reaches `ceil(V/2)` public VP) + strict deficit (`>= ceil(V/4)`). **The fix was confounded too** (`ceil(8/2)=4` vs `ceil(10/2)=5` → blitz's anchor fired earlier in a byte-identical game); worker pre-registered the objection and scored both arms at Classic's cuts. Reviewer proved bot `vpToWin`-blindness in code AND by 600 byte-identical event-prefix comparisons | `704b3ae` |
| E2.2 measurement tail (S2.2.5 + S2.2.5a) | T2–T3 | ✅ **DONE** — **no catch-up flag has a demonstrated comeback effect.** Under matched cuts a LOWER `vpToWin` makes comeback **worse** (14.6/13.2/11.3% at V=10/9/8) — "less time to compound" beats "less distance to close". Two code-proven findings survive any statistic: `eventTiles` without `robinHood` is **dead by construction**; the robin-hood discount executed **0 times in 3000 matches** (bot limitation). No preset changed | — |
| S2.2.6 guards + honest preset docs | T2 | ✅ done — `validateRuleProfile` runs once at registry init (NOT in `loadRuleProfile`: hot path, frozen constants). **G1** `eventTilesInterval` must be a positive **integer** (`NaN`/`Infinity` pass a bare `>= 1` and produce the exact dead flag the guard prevents). **G2** `eventTiles ⇒ robinHood` (else granted tokens have no consumer). **G3** `1 <= robinHoodExchangeRate < bankTrade.baseRate` (at `0` the bank hands over a resource free). Each guard has a violating-input test and **dies alone** when its own clause dies. `EVENT_TILES_TEST_PROFILE` deleted (G2 makes it unconstructible; `robinHood:true` would have duplicated the combined fixture). vp9 scaffolding retired. `docs/wiki/rule-profiles.md` added. **No preset literal changed**; Classic byte-frozen; core 326→334. lead-review BLOCK-free: MERGE WITH NITS ×2 → MERGE | `0400289` |
| E2.2 catch-up + measurement tail | T1–T3 | ✅ **DONE 6/6 — EPIC CLOSED** (S2.2.1–S2.2.4 mechanics · S2.2.5 harness · S2.2.5a metric correction · S2.2.6 guards). **Net: no catch-up flag is enabled on any preset, because none earned it.** Two survive as code-proven facts, not statistics; two are unmeasurable by a bot cohort at any N | — |
| S2.5.4 lobby UI: preset selection + bot-fill + human-seated-first | T2 | ✅ done — closed the seed-injection hole (allow-list ALL wire join options); GameRoom picks profile from lobby | `a2d1f77` |
| S2.5.4a lobby Start transition | T2 | ✅ done — flip `started` on connect-success (superseded by S2.5.2's unified phase-based transition) | `eb65d84` |
| S2.5.3 private rooms by code / invite link | T2 | ✅ done — `createPrivate`→`client.create`+`setPrivate(true)`; `joinByCode`→`client.joinById`; `?room=<roomId>` invite | `faadc0e` |
| S2.5.2 ready-up / host-started private matches | T2 | ✅ done — host manual-start + bot-fill empty seats; unified ALL modes onto `started && shouldShowGame(phase!=='lobby')` | `744bb5a` |
| S2.5.5 matchmaking by mode (`filterBy`) | T2 | ✅ done — `.filterBy(['profileId'])` on BOTH `define()` sites (index.ts dev + boot.ts prod) → quick-match segregates rooms by preset; forcing e2e proven to fail without the filter; core/protocol byte-unchanged, core frozen at 334; lead-review MERGE WITH NITS (pre-existing FsEventSink flake, unrelated) | `e13dabe` |
| S2.5.1 Redis presence/queues/pubsub/sticky routing | T3 | ▫ **DEFERRED** — multi-node scale; single-VPS Dec alpha uses in-memory presence (architecture: don't over-engineer scale early). Revisit at M5 or when a 2nd node is provisioned | — |
| E2.5 lobby/matchmaking/presence | T2–T3 | 🔶 **near-closed** — lobby+preset selection+private rooms+ready-up+matchmaking-by-mode all shipped; only S2.5.1 Redis deferred. Player-facing lobby loop COMPLETE | — |
| S2.6.1 Postgres schema + Drizzle migrations + repos | T2 | ✅ done — first DB surface; `users`/`matches`/`match_players` only (ADR-0012); schema+generated migration (`0000_steady_mandarin`)+`runMigrations`+`migrate` CLI+3 typed repos; PGlite-hermetic tests (server 146→156); NO room rewire, `boot.ts` byte-unchanged, DB optional (no-regression); deps (`drizzle-orm`/`pg`+dev `drizzle-kit`/`@electric-sql/pglite`/`@types/pg`) in `packages/server` only, core zero-dep; lead-review MERGE WITH NITS (3 non-blocking → folded into S2.6.3) | `c2c73f6` |
| S2.6.2a durable guest identity + JWT | T3 | ✅ done — `DbGuestStore` (guests→`users`, `guestId`=`users.id`) + `jose@6.2.3` HS256 tokens (sign `/auth/guest`, verify WS `onAuth`, code 4004 on present-invalid); `SESSION_SECRET` env + ephemeral fallback; `display_name` col via additive migration `0001`; PlayerId unchanged (`userData.userId` = metadata); server 156→170; core byte-unchanged; protocol additive-only. **/security-review PASS (no vulns) + lead-review MERGE WITH NITS** (3 non-blocking) | `8aa1fd6` |
| S2.6.2b OAuth (Google/Discord) + guest-upgrade | T3 | ⏸ **DEFERRED (owner-action)** — needs owner to register OAuth apps + provide client IDs/secrets; asymmetric signing revisit. Materialize when creds available | — |
| S2.6.3 Pg-backed match metadata + `match_players` | T3 | ✅ done — `PgMatchMetadataStore` writes `matches` (`status:'live'`→`'finished'`) + `match_players` at match-start/`game.ended` as pure `#queue` side-effects (determinism-safe: AC3 byte-identical batches, no metadata in ndjson); winner/VP from authoritative `GameEndedEvent.winnerId`+`finalStandings` (no core change); best-effort try/catch isolation (AC4 throwing store still completes match); `room_id` migration `0002`; folded S2.6.1 nits (#1 empty-patch guard, #2 `pool.end`); server 170→178; core/protocol byte-unchanged; **lead-review MERGE WITH NITS** | `dffbd12` |
| S2.6.4 GDPR export + erasure | T2 | ✅ done — auth-gated (`Authorization: Bearer` → S2.6.2a `verifySessionToken`, own-data-only, no IDOR) `GET /account/export` + `POST /account/delete` (soft-delete+anonymize, retain `match_players`); post-erasure token → 401 via `deleted_at` filter; +C2 nit-1 fix (`#seatUserIds` room-private map, off-wire → abandoned authed player keeps `user_id`); server 178→191; core/protocol byte-unchanged. **/security-review PASS + lead-review MERGE**. Carry-forward: scrub `username` on erasure once OAuth (S2.6.2b) adds provider-derived usernames (guests use non-PII `guest_<hex>`) | `7542700` |
| E2.6 persistence & accounts | T2–T3 | ▶ **IN PROGRESS** — **ADR-0012** (Drizzle+PGlite). S2.6.1 ✅ · S2.6.2a ✅ · S2.6.3 ✅ · S2.6.2b deferred (owner OAuth creds) · **S2.6.4 next** · S2.6.5 solo save/resume (non-gating). Carry-forward nits: **S2.6.3 review nit #1** — abandoned AUTHENTICATED player loses `user_id` linkage (`#resolveUserIdForSeat` reads live `this.clients`; a dropped human is gone → `user_id=null` despite `'abandoned'`; won't show in their "my games"). Fix: capture `userId` onto `SeatSchema` at onAuth/onJoin. Product-impact; fold into S2.6.4 or a small follow-up. Also: S2.6.2a nit #2 (client retry discards token on transient outage → post-M2) + #3 (cold-load omits displayName echo → S1.7.1b) | — |

**M2 GATE (all must hold):** Classic/Balanced/Blitz all playable + seed-verifiable; 2–6 players;
single + multiplayer; adaptive duration keeps matches ≤60 min; catch-up mechanics live &
profile-gated; reconnect + bot-fill robust (no karmic bans); matchmaking + lobby + presence
(Redis); heuristic bots ×3; accounts (OAuth + guest) + GDPR; every new user-facing string RU/UA/EN;
CI green incl. a per-profile full-match E2E.
