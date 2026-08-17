---
story: m2-gate-02
spec: m2-gate
status: todo
tier: 3
worker: worker-code
tracer: false
wave: 1
blocked_by: []
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

## Non-goals
- Do NOT touch the estimator's tunable constants or `packages/core` at all - the v1
  heuristic recalibrates at M3 with telemetry; this story only WIRES what exists.
- Do NOT invent a new protocol message for the adjusted vpToWin - per the plan's
  `## Contracts`, client and server call the same core function on the same inputs; if
  that turns out to be insufficient, return `NEEDS_CONTEXT`, do not improvise.
- Do NOT let the adjustment reach Classic 2-4p: the calibration anchor says 4p Classic
  fits the ceiling, so its vpToWin must come out UNCHANGED - assert that (Classic
  byte-freeze), do not assume it.
- Do NOT debounce/animate the lobby warning - plain conditional render, DESIGN.md tokens.

## Map slice
memory/map/server.md (GameRoom genesis), memory/map/client.md (lobby); context: packages/core/src/adaptiveDuration.ts, its test's calibration anchors

## Acceptance criteria
- [ ] GameRoom at genesis: effective vpToWin = adaptive result for the actual seat
      count; a GameRoom test proves a 6-seat expanded room starts with a LOWER vpToWin
      than the profile constant, and a 4p classic room starts with vpToWin 10 unchanged.
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

## Findings
<!-- appended by the worker ONLY on a wall -->
