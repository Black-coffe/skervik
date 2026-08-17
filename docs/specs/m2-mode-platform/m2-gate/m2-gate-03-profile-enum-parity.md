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
Parity is **order-pinned** (`toEqual` on both arrays, plus a set-equality check that
names the drifting id, plus a non-vacuity length guard) — core documents the list as
"in display order" and the wire enum mirrors it 1:1, so a one-sided reorder is drift
worth surfacing; no hardcoded count, so a genuine sixth profile added to BOTH sides
stays green. `ShippingProfileIdSchema` is private to messages.ts, so `.options` is read
through its exported consumer — `JoinLobbySelectionSchema.shape.profileId.unwrap()` IS
that enum object, not a copy — which keeps the story test-only (no export added,
schema untouched). `@skervik/core` was ALREADY a dependency of packages/protocol, so
no package.json change was needed. Added 5 tests (47 → 52): order-pinned equality,
set equality, every core shipping id accepted by the join allow-list, the same ids
accepted by `match.started` (the enum's two consumers can't drift apart), and a 🔴
guard that no `EXPERIMENTAL_PROFILE_IDS` value is reachable at the wire. Liveness was
verified by temporarily asserting against a 6-id list inside the test file (red:
`expected [ Array(5) ] to deeply equal [ Array(6) ]`), then reverting — no broken
state left behind.

## Findings
<!-- appended by the worker ONLY on a wall -->
