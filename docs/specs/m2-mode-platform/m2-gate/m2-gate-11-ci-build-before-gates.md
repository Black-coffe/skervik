---
story: m2-gate-11
spec: m2-gate
status: in-progress -> done (wave 8, 2026-08-17)
tier: 1
worker: worker-code
tracer: false
wave: 8
blocked_by: []
---

# CI builds workspace dist before the test gates

## Goal
Re-review N2: `dist/` is gitignored, nothing builds it on install, and ci.yml runs
Build LAST — every gate step before it imports files that do not exist on a clean
checkout. After this story the Build step runs before the first test gate, so the CI
clause has clean-checkout evidence.

## Requirements
> CI green incl. a per-profile full-match
> CI builds gitignored `dist/` LAST, after every test gate that imports it — no
> clean-checkout evidence for the CI clause; fix = Build above the gates

## Files
- .github/workflows/ci.yml

## Non-goals
- Reorder ONLY — do not rename steps, change commands, or touch the named-gate list
  story 01 established. Re-parse the YAML after editing.

## Map slice
.github/workflows/ci.yml (steps: core-deps :40 … Build :94)

## Acceptance criteria
- [ ] Build runs after install/typecheck/lint, BEFORE the determinism / e2e / fairness
      gates and Test; step list otherwise byte-identical.
- [ ] YAML re-parsed clean; the named gate command unchanged.

## Verification
`node -e "require('js-yaml') && console.log('yaml ok')" 2>/dev/null || npx --yes js-yaml .github/workflows/ci.yml > /dev/null && echo parsed`

## Implementation notes
<!-- appended by the worker -->
- Moved the `Build` step (`pnpm build`) from last to directly after `Format check`, so it now
  precedes the determinism / e2e / fairness gates and `Test`; no step renamed, no command changed.
- Verified by re-parsing with js-yaml: 13 steps both before and after, and the sorted multiset of
  `{name, uses, run, with}` is identical to HEAD — only the position differs. Prettier check passes.

## Findings
<!-- appended by the worker ONLY on a wall -->
