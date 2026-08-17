---
story: m2-gate-03
spec: m2-gate
status: todo
tier: 1
worker: worker-test
tracer: false
wave: 1
blocked_by: []
---

# Profile enum parity: protocol schema pinned to core allow-list

## Goal
`ShippingProfileIdSchema` (protocol) is a hand-copied literal of core's
`SHIPPING_PROFILE_IDS` (deliberate, documented at messages.ts:291-301) and nothing
asserts the two stay equal - a sixth shipping profile would pass every core test and be
rejected at the wire. After this story a test fails the moment the lists diverge.

## Requirements
> сверка всех пунктов M2-гейта
> 2–6 players

## Files
- packages/protocol/src/messages.test.ts

## Non-goals
- Do NOT change the schema itself or replace the hand-copy with a computed z.enum -
  the hand-copy is a documented decision (protocol must not import core at runtime);
  the story adds the missing parity ASSERTION, nothing else.
- Do NOT add a runtime dependency from protocol to core; a dev/test-only import in the
  test file is the point.

## Map slice
memory/map/protocol.md; context: packages/protocol/src/messages.ts:291-302, packages/core/src/ruleProfile.ts:770

## Acceptance criteria
- [ ] A test asserts `ShippingProfileIdSchema.options` deep-equals core
      `SHIPPING_PROFILE_IDS` (order-insensitive or order-pinned - worker's call, stated).
- [ ] The test fails if either list gains/loses/renames an id (prove by reasoning in the
      test name/comment, not by committing a broken state).
- [ ] Protocol suite green; no runtime dep added to packages/protocol/package.json.

## Verification
`pnpm --filter @skervik/protocol test -- --reporter=dot`

## Implementation notes
<!-- appended by the worker -->

## Findings
<!-- appended by the worker ONLY on a wall -->
