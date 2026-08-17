---
story: m2-gate-04
spec: m2-gate
status: todo
tier: 2
worker: worker-code
tracer: false
wave: 4
blocked_by: [m2-gate-01, m2-gate-02, m2-gate-03, m2-gate-05]
---

# Gate amendment + evidence table + stale status rows

## Goal
The milestone plan's M2 GATE paragraph matches owner-decided reality, every clause
points at its proof, and §6's stale rows tell the truth. This story runs LAST so the
evidence lines can name the tests wave 1 just added.

## Requirements
> Амендить гейт — переписать пункт на «in-memory presence (Redis → M5)»
> Амендить: guest сейчас, OAuth ← креды — переписать пункт на «guest JWT в M2; OAuth —
> когда владелец зарегистрирует приложения (S2.6.2b)»
> сверка всех пунктов M2-гейта
> обновление стейл-статусов 7a/7b

## Files
- docs/specs/m2-mode-platform/plan.md

## Non-goals
- Do NOT reword any gate clause beyond the two owner-authorized amendments (Redis,
  OAuth) - the adaptive-duration clause STAYS as written because story 02 makes it true.
- Do NOT delete history from §6 - correct the S2.1.7a/S2.1.7b rows to done (with merge
  commits `cac69af` / `3035ba5`) preserving the row format; fix the E2.6 epic row's
  stale "S2.6.4 next" (S2.6.4 is merged `7542700`).
- Do NOT mark the M2 gate "passed" - that verdict belongs to the owner after
  /vulyk-review of this pack; the story only makes the checklist auditable.

## Map slice
docs/specs/m2-mode-platform/plan.md (M2 GATE paragraph + §6 table) - docs-only story, no source access needed.

## Acceptance criteria
- [ ] Gate paragraph: Redis clause reads in-memory presence with Redis deferred to M5;
      accounts clause reads guest JWT now with OAuth gated on owner-registered apps
      (S2.6.2b); both cite brief.md `## Answers` (2026-08-17).
- [ ] Under the gate paragraph: one evidence line per clause naming the proving test
      file(s)/commit (classic/balanced/blitz/twoPlayer/expanded e2e, adaptive genesis
      test, i18n completeness test, GDPR suite, reconnect suite, bots suite).
- [ ] §6 rows for S2.1.7a and S2.1.7b show done + merge commits; E2.6 row current.
- [ ] Prettier clean (docs formatting hook passes).

## Verification
`npx prettier --check docs/specs/m2-mode-platform/plan.md`

## Implementation notes
<!-- appended by the worker -->

## Findings
<!-- appended by the worker ONLY on a wall -->
