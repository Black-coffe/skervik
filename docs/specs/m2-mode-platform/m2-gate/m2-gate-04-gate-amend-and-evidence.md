---
story: m2-gate-04
spec: m2-gate
status: in-progress -> done (wave 4, 2026-08-17)
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
- Gate paragraph amended in place (two clauses only) with a blockquote directly under it
  quoting the owner's verbatim Q1/Q2 answers from `brief.md` `## Answers` (2026-08-17), plus
  an 11-row **Gate evidence** table (one row per clause) and an explicit "Verdict: NOT
  recorded here" line so the pack stays auditable without claiming a pass. §6: S2.1.7a/7b
  rewritten to ✅ done with `cac69af` / `3035ba5` — the 7a WIP detail is kept as "History"
  rather than deleted, since the typecheck blocker it records is the exact core↔wire drift
  `m2-gate-03` later pinned by test; E2.6 moved from ▶ IN PROGRESS to 🔶 near-closed with
  S2.6.4 ✅ `7542700`.
- Two facts were verified against the repo rather than taken from the dispatch: the CI step
  is named "E2E full-match gate — per-profile match + replay-equality" (`ci.yml:72`) and
  lists exactly the six e2e files; and `TRANSLATION_KEYS` now holds **191** keys, not 188 —
  188 was the pre-`m2-gate-02` count and the 3 duration-estimate keys landed on top. The
  evidence row states 191.

## Findings
<!-- appended by the worker ONLY on a wall -->
