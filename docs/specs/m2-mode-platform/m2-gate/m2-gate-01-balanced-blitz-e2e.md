---
story: m2-gate-01
spec: m2-gate
status: todo
tier: 2
worker: worker-test
tracer: false
wave: 1
blocked_by: []
---

# Balanced + Blitz full-match e2e, named in CI

## Goal
Every shipping profile has a full-match e2e driving a real match to a winner. Recon:
`classic` ✅ (socket + boot-free), `twoPlayer` ✅ (boot-free), `expanded` ✅ (both);
`balanced` has only a liveness probe (no winner asserted), `blitz` only preset-resolution
tests. After this story both gaps are closed and CI's named "E2E full-match" step lists
every per-profile e2e file instead of classic alone.

## Requirements
> Classic/Balanced/Blitz all playable + seed-verifiable
> CI green incl. a per-profile full-match
> per-profile full-match E2E если чего-то не хватает

## Files
- packages/server/src/e2e/balancedMatch.e2e.test.ts
- packages/server/src/e2e/blitzMatch.e2e.test.ts
- .github/workflows/ci.yml

## Non-goals
- Do NOT add socket/multi-client variants — boot-free is the pattern `twoPlayer` set
  and it satisfies the gate; sockets are covered by classic + expanded.
- Do NOT touch the sweep/sim harness in `packages/bots` — its balanced/blitz arms stay
  as they are (they answer a different question).
- Do NOT restructure ci.yml — only extend the existing named "E2E full-match" step's
  vitest invocation with the new files (and the existing twoPlayer/expanded ones).
- Do NOT add a blitz verify test — BLITZ_PROFILE spreads CLASSIC changing only
  vpToWin/timers; randomness is classic's, already verified. Say so in a comment.

## Map slice
memory/map/server.md (e2e section); pattern source: packages/server/src/e2e/twoPlayerMatch.e2e.test.ts

## Acceptance criteria
- [ ] balancedMatch e2e: full match to a winner under `profileId: 'balanced'`, asserts
      winner VP >= the balanced profile's vpToWin, determinism (same seed → same event
      log), replay equality, and the fairness verify leg passes on the real log.
- [ ] blitzMatch e2e: full match to a winner under `profileId: 'blitz'`, asserts
      vpToWin 8 is in force (winner VP >= 8, and a 10-VP classic win condition is NOT
      required), determinism + replay legs.
- [ ] ci.yml "E2E full-match" named step runs all per-profile e2e files explicitly.
- [ ] Full server suite green.

## Verification
`pnpm --filter @skervik/server exec vitest run src/e2e --reporter=dot`

## Implementation notes
<!-- appended by the worker -->

## Findings
<!-- appended by the worker ONLY on a wall -->
