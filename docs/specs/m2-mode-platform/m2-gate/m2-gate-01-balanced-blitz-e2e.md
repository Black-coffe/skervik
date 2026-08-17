---
story: m2-gate-01
spec: m2-gate
status: in-progress -> done (wave 1, 2026-08-17)
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
- Added `packages/server/src/e2e/balancedMatch.e2e.test.ts` (5 legs, seed
  `skervik-balanced-0`, 4 seats, 280 steps / 88 rolls, winner 10 VP) and
  `packages/server/src/e2e/blitzMatch.e2e.test.ts` (5 legs, seed
  `skervik-blitz-2`, 4 seats, 200 steps, winner **exactly 8 VP**). Both follow
  `twoPlayerMatch`/`expandedMatch` boot-free shape (`decideAction` +
  `validate`/`reduce`, no sockets/FS); seeds pinned by a throwaway scan in-file,
  removed before finalizing. `ci.yml`'s named step renamed to "E2E full-match
  gate — per-profile match + replay-equality" and its single vitest invocation
  extended to all six per-profile e2e files (classic socket, twoPlayer,
  balanced, blitz, expanded boot-free + expanded multi-client) — no other
  restructuring; the step count is unchanged at 13 and the YAML was re-parsed to
  confirm the folded `>-` scalar yields exactly the one-line command.
- Decisions/surprises: (a) each profile e2e needed a leg that *discriminates* it
  from a relabeled Classic run, or it would survive the feature breaking —
  Balanced gets a deck leg (every complete 36-draw cycle in the real log is a
  permutation of `BALANCED_ROLL_DECK`) plus the clean `verifyMatchRandomness`
  pass, which only succeeds because the folded `profileId` routes the recompute
  through `drawBalancedRoll`; a mutation probe confirmed a Classic log of the
  same length has only **24** distinct pairs in its first 36 rolls, so the deck
  leg genuinely fails when the deck is bypassed. (b) Blitz's discriminator is a
  winner *below* Classic's 10 VP plus a same-seed/same-seats `classic` contrast
  run (200 vs 325 steps, classic winner 10 VP) — a seed whose winner happened to
  reach 10 could not tell the two thresholds apart, so the 8-VP seed was chosen
  deliberately. (c) Per the non-goals, blitz has NO verify leg and the file says
  why in its header comment; blitz's tighter timers are server-consumed only and
  are unreachable from a boot-free proof, also noted in-file.

## Findings
<!-- appended by the worker ONLY on a wall -->
