---
story: m2-gate-10
spec: m2-gate
status: todo
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

## Findings
<!-- appended by the worker ONLY on a wall -->
