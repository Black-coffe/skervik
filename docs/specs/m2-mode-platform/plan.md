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
| 3 | **E2.3 Resilience: reconnect & bot-fill** | S2.3.1 reconnect tokens + grace ≥120s [T2] · S2.3.2 full state resync [T2] · S2.3.3 bot-fill + safe leave/rejoin [T3] | after E2.4 harness | consumes S2.1.4 anti-AFK flags; coordinates with turn timers |
| 4 | **E2.4 Bots (AI)** | S2.4.1 bot worker harness [T2] · S2.4.2 heuristic bot v1 ×3 difficulty [T3] · S2.4.3 single-player + bot-fill integration [T2] | mid-M2 | separate process consuming `@skervik/core`; seed = S1.7.2 `decideAction` |
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
| S2.1.6 2-player mode (phantom, standard board) | T3 | ✅ done — **E2.1 COMPLETE** | `f0d69b7` |
| S2.2.1 friendly robber | T2 | ✅ done — first E2.2 mechanic; lead-review MERGE | `cd4b876` |
| S2.2.2 robin-hood / poverty tokens | T3 | ✅ done — Option A (self-comp); discharged dedup; lead-review MERGE | `c759090` |
| S2.2.3 final round + hidden VP | T3 | ✅ done — Splendor round-to-circle + public-VP threshold; forced-action no-hang CLOSED; lead-review MERGE | `08cc776` |
| S2.2.4 catch-up event tiles | T2 | ✅ done — deterministic poverty-token boost on every Nth storm; reuses S2.2.2 grant; no new event/protocol/verify/seed; Classic byte-frozen; lead-review MERGE WITH NITS | `0aeeb4f` |
| E2.2 catch-up (×4) | T1–T3 | ✅ **DONE 4/4 — EPIC CLOSED** (all merged, each lead-reviewed) | — |
| S2.4.1 bot worker harness | T2 | ✅ done — `@skervik/bots` opened: S1.7.2 `decideAction` MOVED byte-identical (server E2E re-shims, 103/103 green), `Bot` seam (no seed/no authority) + in-process `simulateMatch` (fail-loud cap, full match 278 turns); no core/server-room change; lead-review MERGE WITH NITS | `57efc8c` |
| **S2.4.2a core bank-conservation fix** | T3 | ✅ done — CORE BUG surfaced by S2.4.2 bot seed-sweep: builds/dev-buys/discards destroyed resources (bank never refunded) → long matches froze production. Fix (reduce-only): `creditBank` in 5 cases from the event's own payload; `bank+hands` conserves 95; re-golden surface verified EMPTY; no validate/verify/protocol/seed/bot change; +4 tests, core 326; lead-review MERGE. Unblocks S2.4.2 | `8129962` |
| S2.4.2 heuristic v1 ×3 difficulty | T3 | ✅ done — scored brain over a shared weighted-feature eval module (`eval/`, M4-advisor-reusable); ×3 difficulty = feature set + selection noise (hard=argmax/medium=light noise/easy=top-K); independent bot PRNG (match-seed-blind); seed-sweep 24×3 all terminate (≤489t), hard 64% vs easy 18%; v0 FROZEN (S1.7.2 green); lead-review MERGE WITH NITS. **Owner-ratified deviation:** easy keeps a low-weight (20) dev-card path for termination (no-stall > "easy ignores dev cards"). Nits: knight-play mild scope-ext (contained); strength floor weak (optional tighten) | `62400ca` |
| E2.3 reconnect & bot-fill (×3) | T2–T3 | ▫ not started | — |
| E2.4 bots (×3) | T2–T3 | ⏳ **2/3** — S2.4.1 harness + S2.4.2 v1 ×3 done (+ S2.4.2a core-fix); **S2.4.3 single-player + bot-fill [T2]** = last (wires the bot into the server `#queue` via the forcedAction seam; first bot-seat type) | — |
| E2.5 lobby/matchmaking/presence (×4) | T2–T3 | ▫ not started (S2.5.4 resolves override seam) | — |
| E2.6 persistence & accounts (×5; S2.6.5 non-gating) | T2–T3 | ▫ not started | — |

**M2 GATE (all must hold):** Classic/Balanced/Blitz all playable + seed-verifiable; 2–6 players;
single + multiplayer; adaptive duration keeps matches ≤60 min; catch-up mechanics live &
profile-gated; reconnect + bot-fill robust (no karmic bans); matchmaking + lobby + presence
(Redis); heuristic bots ×3; accounts (OAuth + guest) + GDPR; every new user-facing string RU/UA/EN;
CI green incl. a per-profile full-match E2E.
