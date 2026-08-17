---
story: m2-gate-09
spec: m2-gate
status: todo
tier: 2
worker: worker-code
tracer: false
wave: 6
blocked_by: [m2-gate-06, m2-gate-07]
---

# Lobby discloses the adaptation; warning branch becomes real

## Goal
Review C2: the actual rule change (victory target lowered) produced no notice while the
only warning was structurally unreachable. After story 06 the ceiling warning IS
reachable (expanded 6p). After this story the lobby says both things where they apply:
"victory target lowered to N" whenever the adaptive result differs, and the over-ceiling
warning when the estimator says so — with positive render tests for each, in all three
locales, accessibly.

## Requirements
> (детерминированно от числа игроков) + лобби показывает оценку длительности и
> предупреждение (3 новых i18n-ключа ×3 локали)
> the actual lowering shows no notice — warn on any real adjustment

## Files
- packages/client/src/lobby/LobbyScreen.tsx
- packages/client/src/lobby/LobbyScreen.test.tsx
- packages/client/src/lobby/lobbyStore.ts
- packages/client/src/lobby/lobbyStore.test.ts
- packages/client/src/i18n/keys.ts
- packages/client/src/i18n/locales/en.ts
- packages/client/src/i18n/locales/ru.ts
- packages/client/src/i18n/locales/uk.ts

## Non-goals
- Do NOT touch core/protocol/server; the estimate still comes from the same core call.
- Review minors to fold in, nothing more: the `" — "` separator moves into the
  catalogue strings (no assembly outside i18n); the section gets its `a11y.*` key like
  every sibling; warnings carry `role="status"`; the lowered-target/warning copy does
  NOT ride the `Pill` chip (DESIGN.md §11 — chips are for counts/timers, not
  sentences); the test that computed its expected string via the function under test
  pins the literal instead.
- RU/UK copy: natural game-UI voice matching neighboring keys, not machine-literal.

## Map slice
Review C2 in plan.md `## Plan deltas`; LobbyScreen.tsx:352-359, lobbyStore.ts:149 (deriveDurationEstimate), core AdaptiveDurationResult.adjustments

## Acceptance criteria
- [ ] Selecting expanded 5p/6p renders "victory target lowered to 8" (localized);
      classic/twoPlayer/balanced/blitz render no such notice — both asserted.
- [ ] Expanded 6p renders the over-ceiling warning (now reachable); a POSITIVE render
      test exists (not just absence).
- [ ] All new strings via keys present in en/ru/uk; locale-completeness green;
      `role="status"` on the notices; a11y key present; no ` — ` assembled in JSX.
- [ ] Full client suite green.

## Verification
`pnpm --filter @skervik/client test -- --reporter=dot`

## Implementation notes
<!-- appended by the worker -->

## Findings
<!-- appended by the worker ONLY on a wall -->
