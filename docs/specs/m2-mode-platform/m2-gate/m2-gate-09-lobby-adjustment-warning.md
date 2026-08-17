---
story: m2-gate-09
spec: m2-gate
status: in-progress -> done (wave 6, 2026-08-17; 2 rounds)
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
- packages/client/src/lobby/LobbyScreen.css
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
- The duration section became an exported `LobbyDurationSection({ estimate })` — the only
  way to render a non-default pick at all (zustand's frozen `getServerSnapshot`), which is
  what makes the lowered-target and ceiling notices POSITIVELY testable, in EN/RU/UK (the
  locale is switched by stubbing `window.localStorage` for `I18nProvider`). Separators
  folded into the catalogue merged four keys into two summary keys
  (`lobby.botCountSummary`, `lobby.durationSummary`); `Pill` is gone from this file.
- Literal recheck: Classic 2-seat is still 34 min (its 10-VP track is untouched by the
  floor), so the pinned literal did not move. The rewritten shipping-space guard now pins
  the exact over-ceiling set as `['expanded/5']` (6 seats, 68 min) instead of asserting the
  set is empty.
- Round 2 (Files amended to include LobbyScreen.css): `.lobby-screen__duration-notice` and
  its `--warning` modifier styled from the shared tokens — `--accent` (§2 "sea-glass —
  links, info") for the disclosure, `--primary` ("kerosene") for the over-ceiling sentence,
  the same normal→warning step `TimerDisplay` takes, at the file's existing 0.8125rem
  secondary size. Tone never carries meaning alone (§10): each notice is a sentence.

## Findings
<!-- appended by the worker ONLY on a wall -->
