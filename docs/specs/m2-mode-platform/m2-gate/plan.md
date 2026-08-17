# M2 gate audit & closure (plan)

**Tier:** 3 · **Spec slug:** `m2-gate` · **Brief:** [brief.md](brief.md)
**Governed by:** `docs/specs/m2-mode-platform/plan.md` (M2 GATE, §6 status table) ·
ADR-0003 (pure zero-dep core) · ADR-0008 (trilingual) · ADR-0013
**Depends on:** S2.1.7b ✅ landed — `3035ba5` is the **last commit of that pack**, not a merge
commit (single parent `21add10`); the last feature pack before the gate.

## Goal

Close the M2 gate honestly: every gate clause either holds with named evidence, or is
amended by the owner on the record. Recon (2 scouts, 2026-08-17) found three gaps between
the gate's letter and the repo: no full-match e2e for `balanced`/`blitz`, adaptive
duration implemented but never wired (zero callers), and two clauses (Redis presence,
OAuth) contradicting earlier owner deferrals. Owner answered all three briefing
questions (brief.md `## Answers`): amend Redis and OAuth clauses; wire adaptive duration
live. After this pack the gate text matches reality and each remaining clause has a test
or a file to point at.

## Assumptions

- Applying `computeAdaptiveDuration` at match genesis is deterministic given profile +
  seat count, so replay/verify stay byte-stable for a fixed roster (worker must add the
  determinism leg to prove it, not assert it).
- Blitz full-match e2e can run boot-free with inert timers (bots act immediately);
  timers are covered by S2.1.4's own suite.
- Classic 4p stays within the 60-min ceiling (calibration test), so wiring adaptive
  duration does NOT change Classic 2–4p behavior — Classic byte-freeze holds.

## Stories

**Wave 1** (3 concurrent, disjoint packages)
- `m2-gate-01-balanced-blitz-e2e` — boot-free full-match e2e for `balanced` and `blitz`
  (winner, determinism, replay, verify) + CI named gate lists all per-profile e2e files.
- `m2-gate-02-adaptive-duration-live` — GameRoom applies `computeAdaptiveDuration` at
  genesis; lobby shows the duration estimate + over-ceiling warning; 3 i18n keys ×3.
- `m2-gate-03-profile-enum-parity` — test pinning protocol `ShippingProfileIdSchema` to
  core `SHIPPING_PROFILE_IDS` (a sixth profile can no longer pass core and die on wire).

**Wave 2** (after wave 1)
- `m2-gate-05-victory-override-seam` — core+protocol: optional per-match victory
  override (`GameState`/`MatchStartedEvent` + the `victory.vpToWin` read), absent for
  Classic 2–4p so golden/replay bytes stay frozen by construction.

**Wave 3**
- `m2-gate-02-adaptive-duration-live` — GameRoom applies `computeAdaptiveDuration` at
  genesis THROUGH the 05 seam; lobby shows the duration estimate + over-ceiling warning;
  3 i18n keys ×3.

**Wave 4**
- `m2-gate-04-gate-amend-and-evidence` — milestone plan.md: amend gate wording per owner
  answers (Redis → M5, OAuth ← creds, adaptive now enforced), evidence line per clause,
  fix stale §6 rows (S2.1.7a/7b), record E2.6 epic closure state.

## Contracts

- *(amended by the 2026-08-17 plan delta)* Story 05 provides the seam: an OPTIONAL
  per-match victory override on `GameState`/`MatchStartedEvent` (core) mirrored in the
  protocol schema, honored by the `victory.vpToWin` read in `validate.ts`; the field is
  ABSENT whenever the adaptive result equals the profile constant, so Classic 2–4p
  logs stay byte-identical by construction. Story 02 consumes exactly that seam: the
  room computes `computeAdaptiveDuration(profile, seatCount)` once at genesis and sets
  the override; the client lobby estimate calls the SAME core function (seat count
  clamped to the profile's `[minSeats, maxSeats]`) — still no second estimator. If
  either worker finds the seam insufficient, that is NEEDS_CONTEXT, not an improvised
  message.
- New i18n keys (3: estimate label, minutes value, over-ceiling warning) land in
  `keys.ts` + all three locales in the same story (02) — the locale-completeness test
  makes a partial landing unmergeable.
- Story 01's CI edit only ADDS named vitest invocations to the existing "E2E full-match"
  step; it does not restructure the workflow.

## Integration gate

`pnpm -s typecheck && pnpm -s -r lint && pnpm -s -r test && pnpm -s -r build && node scripts/check-core-no-runtime-deps.mjs`
plus `bash scripts/wave-check.sh docs/specs/m2-mode-platform/m2-gate` before each dispatch.

## Descoped

*(empty)*

## Plan deltas

- **2026-08-17, story 02 round 1 → NEEDS_CONTEXT → new story 05.** Worker's return: the
  adjusted vpToWin has NO channel into the engine — `validate.ts:633` reads victory only
  from `loadRuleProfile(state.profileId)`, the server never reads `vpToWin`, and story
  02's `## Non-goals` forbids touching core; the plan's Contract ("no new protocol
  message") mislocated the gap. Queen decision, per the owner's standing Q3 answer
  (подключить живьём): cut `m2-gate-05` (wave 2) — optional per-match victory override
  in core+protocol, absent for Classic 2–4p (byte-freeze by construction, precedent:
  `profileId`, `neutralSettlements`); story 02 re-scoped to consume the seam
  (wave 3, blocked_by 05); story 04 moves to wave 4. Rejected: descoping 02 to
  lobby-display-only — it would leave the gate clause satisfied by dead code, the exact
  finding that opened this pack. Also decided (worker blocker 2): the lobby estimate
  clamps seat count to the profile's `[minSeats, maxSeats]`; genesis truth stays with
  the room.
- **2026-08-17, story 05 round 1 → NEEDS_CONTEXT (answered).** `## Files` named
  `packages/core/src/validate.test.ts`, which does not exist; the two-branch vpToWin
  threshold tests live in `ruleProfile.test.ts:139` (`vpToWin is live config`). Files
  list amended to `ruleProfile.test.ts` (worker's recommendation — the override test
  sits beside its exact precedent). Same worker continued with context intact rather
  than a fresh dispatch: the fresh-worker default exists because same-context дозапрос
  needs an experimental flag in the plain client; this session's harness continues
  natively, so the reason does not apply. Worker also flagged for story 02's review:
  `vpToWin` is read by `packages/bots/src/sim/*` and asserted in six server e2e tests.
- **2026-08-17, story 02 round 2 → one e2e assertion follows the behavior change.**
  `expandedMultiClient.e2e.test.ts:360` asserted winner ≥ the profile constant (10) for
  a live 5-seat room — the exact assumption this story invalidates (correctly ends at
  8 now). Queen: amend that one assertion to the effective threshold
  (`vpToWinOverride ?? profile constant`); Files gain the test file. The sibling
  `expandedMatch.e2e.test.ts` builds genesis without GameRoom and stays green. Also
  recorded from the worker: server imports core via `dist` — a stale build masks the
  seam (`pnpm -r build` first when debugging it).
- **2026-08-17, story 05 round 2 — reduce fold pulled INTO the seam.** Worker's DONE
  report flagged that `reduce.ts:143` drops `event.vpToWinOverride` (spreads only
  `profileId`) — an override on the wire would vanish on replay from the event log,
  a silent-loss path. The fold is read-side plumbing of "the engine can consume it",
  so it belongs to story 05, not 02: Files gain `reduce.ts` + a fold test; same worker
  continues (context intact). Story 02's Non-goals stay as written — core remains
  outside its hands.

- **2026-08-17, lead-review → BLOCK → fix round (wave 5–7, stories 06–10).** Verdict on
  the wave-1–4 diff: scope clean, byte-freeze holds, new e2e discriminators genuine —
  blocked on behavior/disclosure: (C1) expanded silently plays to 8/6 VP from an
  uncalibrated heuristic, 6 VP winnable with zero building — owner Q4: clamp the
  adaptive VP floor to 8; (C2) the only lobby warning is structurally unreachable while
  the actual lowering shows no notice — warn on any real adjustment; (C3/M2, pre-existing
  but falsifying our evidence rows) `PublicGameStateSchema` strips `profileId` (reconnect
  on expanded re-renders a Classic board) and never carried `vpToWinOverride`; (M1) one
  evidence row overclaims (no 5-seat/twoPlayer genesis tests); (M3) amended e2e assertion
  pins nothing; (M4) `expandedMatch` e2e tests a config production no longer produces;
  plus minors (fold guard, i18n/a11y nits, stale ADR-0013/wiki/map records, `3035ba5`
  miscited as a merge). Routed: 06 core floor clamp + fold guard · 07 snapshot schema
  fields + wsClient test · 08 server test legs + pinned assertions · 09 lobby
  adjustment-warning + i18n/a11y · 10 records (evidence rows, ADR note, wiki, maps).
- **2026-08-17, story 09 round 2 — notice styling.** Worker's DONE flagged the new
  `lobby-screen__duration-notice` class has no CSS rule (LobbyScreen.css was outside its
  Files; `Pill` correctly removed per DESIGN.md §11) — a warning with no warning tone
  under-delivers C2's disclosure. Files gain LobbyScreen.css; same worker adds the
  tokened rule (info tone for the lowered-target notice, warning tone for the ceiling
  notice). Also accepted from the same return: bot-count ` — ` folded into the
  catalogue as well (the criterion was unqualified), locale-switch-via-localStorage
  test technique, and `role="status"` per instruction.
- **2026-08-17, story 10 — records caught up to the post-fix truth (the gate stays OPEN).**
  The evidence table now reads floor **8** everywhere (expanded 5p → 8 VP / 58 min; 6p → 8 VP
  + `exceeds_ceiling_at_vp_floor` / ~68 min — the 6p → 6 VP row was written before story 06),
  cites the new 5-seat/`twoPlayer`/`balanced` genesis legs, cites the `m2-gate-07` snapshot-schema
  fix under the reconnect clause, and states the re-counted key total: **191 — unchanged**, because
  story 09 swapped four keys for four (`durationLabel`/`durationMinutes`/`botCountLabel`/`botCount`
  out; `durationSummary`/`durationAdjusted`/`botCountSummary`/`a11y.durationSection` in), so the
  duration block is now four keys, not the three story 02 landed. `3035ba5` reworded in both plan
  files. Two review minors promoted to the milestone `## 4` ledger rather than being buried here:
  (a) the room's override rule is mirrored in `expandedMatch.e2e.test.ts`'s local
  `adaptiveOverrideFor` because `GameRoom.#adaptiveVpToWinOverride` is `#private` — two places to
  edit, and the mirror omits the room's seat-range guard; (b) the `dist` resolution trap all three
  of workers 02/06/07 hit, with the CI step-order question it raises. **No verdict recorded** —
  per this story's `## Non-goals` the gate is not marked passed here.

- **2026-08-17, re-review → BLOCK #2 → final round (wave 8, stories 11–12).** All seven
  prior findings verified fixed. New: (N1) the floor clamp made the gate headline
  "≤60 min" false for 6-seat Grand Chart (67.6 min) and the owner had not been asked —
  owner Q5: amend with the exception (disclosed in lobby, fits after M3 calibration);
  (N2) CI builds gitignored `dist/` LAST, after every test gate that imports it — no
  clean-checkout evidence for the CI clause; fix = Build above the gates; (N3, recorded
  with Q5) with floor 8 the adaptive lever currently emits exactly one value (8) —
  per-table machinery delivering a constant until M3 recalibrates. Minors: EN
  `durationAdjusted` gets the plural form; store→section wiring test, validate-side
  guard, mirror coupling stay in the milestone ledger. Routed: 11 CI order · 12 clause
  amendment + N3 record + EN plural.

**Approved:** owner, 2026-08-17 — plan + 3 briefing answers (Redis→M5, OAuth←creds, adaptive live) accepted; build authorized. Fix round authorized via Q4 (2026-08-17); final round via Q5 (2026-08-17).
