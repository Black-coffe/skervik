---
story: m2-gate-02
spec: m2-gate
status: in-progress -> done (wave 3, 2026-08-17; 2 rounds)
tier: 3
worker: worker-code
tracer: false
wave: 3
blocked_by: [m2-gate-05]
---

# Adaptive duration goes live: genesis wiring + lobby estimate

## Goal
`computeAdaptiveDuration` (core, tested, ceiling 60 min) currently has ZERO callers -
the gate clause is satisfied by dead code. After this story: GameRoom applies it once at
match genesis (deterministic from profile + final seat count), the lobby shows the
estimated duration for the selected preset + player count and a warning when the
estimate exceeds the ceiling even at the VP floor, in all three locales.

## Requirements
> adaptive duration keeps matches ≤60 min
> Подключить живьём — GameRoom применяет computeAdaptiveDuration на генезисе матча
> (детерминированно от числа игроков) + лобби показывает оценку длительности и
> предупреждение (3 новых i18n-ключа ×3 локали)

## Files
- packages/server/src/room/GameRoom.ts
- packages/server/src/room/GameRoom.test.ts
- packages/client/src/lobby/LobbyScreen.tsx
- packages/client/src/lobby/LobbyScreen.test.tsx
- packages/client/src/lobby/lobbyStore.ts
- packages/client/src/lobby/lobbyStore.test.ts
- packages/client/src/i18n/keys.ts
- packages/client/src/i18n/locales/en.ts
- packages/client/src/i18n/locales/ru.ts
- packages/client/src/i18n/locales/uk.ts
- packages/server/src/e2e/expandedMultiClient.e2e.test.ts

## Non-goals
- Do NOT touch the estimator's tunable constants or `packages/core` at all - the v1
  heuristic recalibrates at M3 with telemetry; this story only WIRES what exists.
- Do NOT invent your own channel for the adjusted vpToWin - story 05 shipped the seam
  (optional victory override on `GameState`/`MatchStartedEvent`, honored by
  `validate.ts`); GameRoom SETS it at genesis, and sets it ONLY when the adaptive
  result differs from the profile constant (absent = frozen bytes). If the seam is
  insufficient, return `NEEDS_CONTEXT`, do not improvise.
- Lobby estimate seat count: clamp to the selected profile's `[minSeats, maxSeats]`
  (Queen decision, plan delta 2026-08-17) - the estimate is advisory; genesis truth
  stays with the room. Never call the estimator below `ADAPTIVE_MIN_PLAYERS`.
- Do NOT let the adjustment reach Classic 2-4p: the calibration anchor says 4p Classic
  fits the ceiling, so its vpToWin must come out UNCHANGED - assert that (Classic
  byte-freeze), do not assume it.
- Do NOT debounce/animate the lobby warning - plain conditional render, DESIGN.md tokens.

## Map slice
memory/map/server.md (GameRoom genesis), memory/map/client.md (lobby); context: packages/core/src/adaptiveDuration.ts, its test's calibration anchors

## Acceptance criteria
- [ ] GameRoom at genesis sets the story-05 override to the adaptive result for the
      actual seat count; a GameRoom test proves a 6-seat expanded room starts with a
      LOWER effective vpToWin than the profile constant (and the win check honors it),
      and a 4p classic room emits NO override (field absent, vpToWin 10 unchanged).
- [ ] Determinism: same profile + same roster + same seed → byte-identical event log
      across two runs WITH the wiring in place (existing replay-equality pattern).
- [ ] Lobby: for the selected preset + bot count the estimated minutes render; when the
      estimator returns `exceeds_ceiling_at_vp_floor` a warning renders; all new strings
      via i18n keys present in en/ru/uk (locale-completeness test stays green).
- [ ] Full client + server suites green.

## Verification
`pnpm --filter @skervik/server test -- --reporter=dot && pnpm --filter @skervik/client test -- --reporter=dot`

## Implementation notes
<!-- appended by the worker -->
- Wiring landed as specified: `#startMatch` resolves the profile first, calls
  `#adaptiveVpToWinOverride(profile, seatCount)`, and spreads `vpToWinOverride` onto
  `match.started` only when it differs (guarded for out-of-range seat counts — the
  estimator throws, and 1-seat test rooms exist — and for positive-integer, which the wire
  schema requires). Measured: Classic 3p/4p and twoPlayer 2p emit NOTHING (4p Classic = 58
  min, inside the ceiling); `expanded` 5p → 8, 6p → 6. Lobby estimate clamps `botCount + 1`
  into `[minSeats, maxSeats]` ∩ `[ADAPTIVE_MIN_PLAYERS, ADAPTIVE_MAX_PLAYERS]` and shows the
  POST-adaptation minutes; no shipping preset × bot count reaches the warning branch today,
  so `deriveDurationEstimate` is tested separately with a real tight-target core result.
- `packages/core/dist` was STALE (predated story 05) — the server imports core through
  `dist`, so `reduce` silently dropped the override until `pnpm -r build` was re-run. Worth
  knowing before debugging a "the seam doesn't work" symptom in the server package.
- `expandedMultiClient.e2e.test.ts` changed because THIS STORY changed the intended
  behavior, not because the test was wrong before: it asserted the winner's standing
  `>= loadRuleProfile('expanded').victory.vpToWin` (10) for a live 5-seat room, which now
  legitimately ends at 8 under the genesis override. One assertion amended (Queen-approved
  round 2, `## Files` extended) to read the EFFECTIVE threshold,
  `localState.vpToWinOverride ?? loadRuleProfile('expanded').victory.vpToWin` — same intent,
  current source of truth. `expandedMatch.e2e.test.ts` builds its own genesis events rather
  than going through `GameRoom`, so it never sees the override and stays untouched.

## Findings
<!-- appended by the worker ONLY on a wall -->
