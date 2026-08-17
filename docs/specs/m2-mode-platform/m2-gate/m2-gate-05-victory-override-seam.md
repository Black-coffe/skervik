---
story: m2-gate-05
spec: m2-gate
status: todo
tier: 3
worker: worker-code
tracer: false
wave: 2
blocked_by: [m2-gate-01, m2-gate-03]
---

# Per-match victory override seam (core + protocol)

## Goal
The engine can consume an adjusted `vpToWin`. Today `validate.ts` decides victory only
from `loadRuleProfile(state.profileId).victory.vpToWin` — no per-match channel exists,
which is why story 02 walled. After this story: `GameState` and `MatchStartedEvent`
carry an OPTIONAL victory override (absent = profile constant, so every existing log is
byte-identical), the `vpToWin` read honors it, and the protocol schema mirrors the
field. Nothing SETS the override yet — that is story 02's job at genesis.

## Requirements
> adaptive duration keeps matches ≤60 min
> Подключить живьём — GameRoom применяет computeAdaptiveDuration на генезисе матча
> cut `m2-gate-05` (wave 2) — optional per-match victory override
> in core+protocol, absent for Classic 2–4p (byte-freeze by construction, precedent:
> `profileId`, `neutralSettlements`)

## Files
- packages/core/src/types.ts
- packages/core/src/validate.ts
- packages/core/src/validate.test.ts
- packages/protocol/src/messages.ts
- packages/protocol/src/messages.test.ts

## Non-goals
- Do NOT set the override anywhere — no GameRoom, no lobby, no bots change; the seam
  ships unset and byte-inert. Wiring is story 02.
- Do NOT touch `computeAdaptiveDuration` or any estimator constant.
- Do NOT make the field required or defaulted-to-a-number — ABSENT is the frozen-bytes
  contract (precedent: `profileId`, `neutralSettlements` are optional-absent fields).
- Do NOT touch replay/verify/golden fixtures — if any golden changes, the design is
  wrong; stop and return NEEDS_CONTEXT.
- If core victory tests live in a different file than `validate.test.ts` (it may not
  exist), do NOT go hunting across the suite — return NEEDS_CONTEXT naming the actual
  file so the Queen amends this list.

## Map slice
memory/map/core.md (types, validate); context: packages/core/src/validate.ts:633, packages/core/src/types.ts:213 + :414, packages/protocol/src/messages.ts (MatchStarted schema)

## Acceptance criteria
- [ ] Optional override field on `GameState` + `MatchStartedEvent` (core types) and the
      protocol `match.started` schema; name at worker's discretion, stated in notes.
- [ ] `validate.ts` victory check uses the override when present, profile constant when
      absent; a test proves BOTH branches (win at overridden 6 VP; unchanged at 10).
- [ ] Byte-freeze: a test (or existing suite run) proves a match WITHOUT the override
      serializes identically to before this story — zero golden churn.
- [ ] Core + protocol suites green; core stays zero-runtime-deps.

## Verification
`pnpm --filter @skervik/core test -- --reporter=dot && pnpm --filter @skervik/protocol test -- --reporter=dot && node scripts/check-core-no-runtime-deps.mjs`

## Implementation notes
<!-- appended by the worker -->

## Findings
<!-- appended by the worker ONLY on a wall -->
