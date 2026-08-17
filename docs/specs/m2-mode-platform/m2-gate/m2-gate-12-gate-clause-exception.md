---
story: m2-gate-12
spec: m2-gate
status: todo
tier: 1
worker: worker-code
tracer: false
wave: 8
blocked_by: []
---

# Gate clause amended per Q5 + N3 on the record + EN plural

## Goal
Re-review N1/N3: the gate headline matches the owner's accepted trade, the
lever-is-a-constant property is recorded next to it, and the EN adjusted-target string
gets the plural form its RU/UK siblings have.

## Requirements
> Амендить с исключением — ≤60 мин для всех столов, кроме 6-местного Grand Chart: там
> порог снижен до пола 8 и игрок предупреждён в лобби; вписывание в 60 мин — после
> M3-калибровки эстиматора телеметрией
> adaptive duration keeps matches ≤60 min
> with floor 8 the adaptive lever currently emits exactly one value (8)

## Files
- docs/specs/m2-mode-platform/plan.md
- packages/client/src/i18n/locales/en.ts
- packages/client/src/lobby/LobbyScreen.test.tsx

## Non-goals
- Only the adaptive clause changes in the gate paragraph (cite Q5, brief.md Answers);
  the evidence row below it gains the N3 note (one emitted value until M3) — nothing
  else in the milestone plan moves.
- EN `lobby.durationAdjusted` becomes a plural object mirroring RU/UK structure; the
  rendered text for count 8 must not change (adjust the test only if the literal
  proves it — do not weaken assertions).

## Map slice
docs/specs/m2-mode-platform/plan.md (M2 GATE paragraph + evidence table); packages/client/src/i18n/locales/ru.ts (plural shape precedent)

## Acceptance criteria
- [ ] Gate clause reads: ≤60 min for every table except 6-seat Grand Chart — target
      lowered to the floor of 8, disclosed in the lobby, fits after M3 estimator
      calibration; citing Q5 (2026-08-17).
- [ ] Evidence row notes N3: every shipping table currently emits either nothing or 8.
- [ ] EN plural form lands; client suite green; prettier clean on the plan file.

## Verification
`pnpm --filter @skervik/client test -- --reporter=dot && npx prettier --check docs/specs/m2-mode-platform/plan.md`

## Implementation notes
<!-- appended by the worker -->

## Findings
<!-- appended by the worker ONLY on a wall -->
