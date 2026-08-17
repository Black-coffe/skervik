---
story: m2-gate-10
spec: m2-gate
status: in-progress -> done (wave 7, 2026-08-17)
tier: 1
worker: worker-code
tracer: false
wave: 7
blocked_by: [m2-gate-08, m2-gate-09]
---

# Records catch up: evidence truth, ADR note, wiki, maps

## Goal
Review M1-remainder + record-hygiene minors: every written record matches what now
ships. Runs LAST so it documents the fix round's final numbers (floor 8; expanded
5p AND 6p → 8 VP).

## Requirements
> сверка всех пунктов M2-гейта
> stale ADR-0013/wiki/map records, `3035ba5`
> miscited as a merge

## Files
- docs/specs/m2-mode-platform/plan.md
- docs/specs/m2-mode-platform/m2-gate/plan.md
- docs/adr/
- docs/wiki/rule-profiles.md
- memory/map/

## Non-goals
- Do NOT mark the M2 gate passed — that stays with the owner after re-review.
- ADR-0013: append a dated note that the "Revisit when" trigger fired and the shipped
  mechanism is the `vpToWinOverride` event field (not ADR-0012 `matches.profile`) — do
  NOT rewrite the ADR's history.
- Map refresh: only the sections the pack touched (core adaptiveDuration/reduce seam,
  server GameRoom genesis, client lobby estimate) — no full re-map.

## Map slice
Evidence table in docs/specs/m2-mode-platform/plan.md; review minors in m2-gate/plan.md `## Plan deltas` (BLOCK entry)

## Acceptance criteria
- [ ] Evidence rows updated to the post-fix truth: thresholds 8/8, the 5-seat/twoPlayer
      genesis legs now cited, i18n key count re-verified, snapshot-schema fix cited for
      the reconnect clause.
- [ ] `3035ba5` citations reworded ("last commit of the pack", not a merge) in both
      plan files.
- [ ] ADR-0013 dated note added; docs/wiki/rule-profiles.md documents `expanded` and
      the per-match override; touched memory/map sections refreshed.
- [ ] `npx prettier --check` clean on every touched .md.

## Verification
`npx prettier --check docs/specs/m2-mode-platform/plan.md docs/specs/m2-mode-platform/m2-gate/plan.md docs/wiki/rule-profiles.md`

## Implementation notes
<!-- appended by the worker -->
- Every number re-derived from the repo, not copied from the brief: `ADAPTIVE_VP_FLOOR` is 8
  (`adaptiveDuration.ts:47`), expanded 5p → 8 VP / 58 min and 6p → 8 VP / 67.6 min + warning;
  `3035ba5` has ONE parent (`21add10`) so it is the pack's tip, not a merge — `cac69af` is the
  real merge commit. **`TRANSLATION_KEYS` re-counted = 191, unchanged**: story 09 swapped four keys
  for four (`durationLabel`/`durationMinutes`/`botCountLabel`/`botCount` → `durationSummary`/
  `durationAdjusted`/`botCountSummary`/`a11y.durationSection`), so the evidence row's total held
  while its parenthetical ("the 3 duration keys") went stale — the duration block is now four.
- Two review minors promoted to the milestone `## 4` ledger instead of being noted and lost: the
  `adaptiveOverrideFor` mirror in `expandedMatch.e2e.test.ts:88` (the room's copy is `#private`,
  and the mirror omits its seat-range guard — two places to edit), and the `dist`-resolution trap.
  Chasing the latter surfaced an unresolved CI question recorded there, NOT fixed here (out of
  Files): `dist/` is gitignored and `ci.yml` runs `Build` as its LAST step, after every test gate.
  No verdict on the gate was recorded anywhere (`## Non-goals`).

## Findings
<!-- appended by the worker ONLY on a wall -->
