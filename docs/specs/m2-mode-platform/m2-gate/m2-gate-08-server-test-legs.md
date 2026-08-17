---
story: m2-gate-08
spec: m2-gate
status: todo
tier: 2
worker: worker-test
tracer: false
wave: 6
blocked_by: [m2-gate-06, m2-gate-07]
---

# Server test legs: the coverage the evidence table promised

## Goal
Review M1/M3/M4 + minors: the genesis coverage claimed by the evidence table exists,
the amended e2e assertion pins the actual expected value, and the sibling e2e no longer
tests a configuration production never produces. NOTE: after story 06 the floor is 8 —
expanded 6p now overrides to 8, not 6; write against the NEW truth.

## Requirements
> one evidence row overclaims (no 5-seat/twoPlayer genesis tests)
> amended e2e assertion pins nothing
> `expandedMatch` e2e tests a config production no longer produces

## Files
- packages/server/src/room/GameRoom.ts
- packages/server/src/room/GameRoom.test.ts
- packages/server/src/e2e/expandedMultiClient.e2e.test.ts
- packages/server/src/e2e/expandedMatch.e2e.test.ts

## Non-goals
- GameRoom.ts: ONLY the review nit — `#adaptiveVpToWinOverride` compares against the
  passed `profile` but calls `computeAdaptiveDuration(this.#profileId, …)`; pass
  `profile.id` so there is one source. No behavior change.
- Do NOT touch balanced/blitz e2e, bots, core, protocol, client.
- Do NOT loosen any determinism/replay leg.

## Map slice
Review findings M1/M3/M4 quoted in plan.md `## Plan deltas` (2026-08-17 BLOCK entry); GameRoom.test.ts:1412+:1459 (existing genesis legs), expandedMultiClient.e2e.test.ts:363

## Acceptance criteria
- [ ] GameRoom genesis legs added: 5-seat expanded (override present, equals the
      adaptive result) and twoPlayer 2p (key ABSENT); balanced 4p asserted no-override
      (the 58-of-60 stale-margin guard, mirroring the existing classic 4p pin).
- [ ] expandedMultiClient assertion pins the value:
      `localState.vpToWinOverride` === the `computeAdaptiveDuration('expanded', 5)`
      threshold — so it fails if the wiring is removed OR the value drifts.
- [ ] expandedMatch e2e: genesis carries the override the room would set (or, if that
      breaks its self-built log design, a header states the divergence and one
      assertion covers the overridden path) — the file can no longer silently test a
      dead configuration.
- [ ] Full server suite green.

## Verification
`pnpm --filter @skervik/server test -- --reporter=dot`

## Implementation notes
<!-- appended by the worker -->

## Findings
<!-- appended by the worker ONLY on a wall -->
