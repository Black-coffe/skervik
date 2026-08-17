---
story: m2-gate-05
spec: m2-gate
status: in-progress -> done (wave 2, 2026-08-17; 2 rounds)
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
- packages/core/src/reduce.ts
- packages/core/src/reduce.test.ts
- packages/core/src/ruleProfile.test.ts
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
- The override test lives in `ruleProfile.test.ts` beside the existing two-branch
  threshold pattern (`vpToWin is live config`, :139) — amended per round-1
  NEEDS_CONTEXT; `validate.test.ts` does not exist.

## Map slice
memory/map/core.md (types, validate); context: packages/core/src/validate.ts:633, packages/core/src/types.ts:213 + :414, packages/protocol/src/messages.ts (MatchStarted schema)

## Acceptance criteria
- [ ] Optional override field on `GameState` + `MatchStartedEvent` (core types) and the
      protocol `match.started` schema; name at worker's discretion, stated in notes.
- [ ] `validate.ts` victory check uses the override when present, profile constant when
      absent; a test proves BOTH branches (win at overridden 6 VP; unchanged at 10).
- [ ] `reduce.ts` `match.started` folds `event.vpToWinOverride` into `GameState`
      (conditional spread mirroring `profileId`); a test proves an event-carried
      override survives the fold — replay from the log reproduces the live threshold.
- [ ] Byte-freeze: a test (or existing suite run) proves a match WITHOUT the override
      serializes identically to before this story — zero golden churn.
- [ ] Core + protocol suites green; core stays zero-runtime-deps.

## Verification
`pnpm --filter @skervik/core test -- --reporter=dot && pnpm --filter @skervik/protocol test -- --reporter=dot && node scripts/check-core-no-runtime-deps.mjs`

## Implementation notes
<!-- appended by the worker -->
- Field is `vpToWinOverride?: number` on `GameState` + `MatchStartedEvent` (core) and
  `z.number().int().positive().optional()` on the protocol `match.started` schema. The
  single read site `validate.ts:633` now compares against a local
  `const vpToWin = state.vpToWinOverride ?? victory.vpToWin` (bound beside the existing
  `loadRuleProfile` destructure at :596) — absent override reads through to the profile
  constant, so `__fixtures__/` and every golden are untouched (verified: `git status` on
  the fixtures dir is empty; replay/verify/victory/finalRound/determinism all green).
- Round 2 (Queen: the fold belongs to this seam): `reduce.ts` `case 'match.started'` now
  folds `event.vpToWinOverride` with a conditional spread beside `profileId`'s, tested
  for `!== undefined` rather than truthiness so the fold never depends on the value's
  magnitude. Fold tests live in `packages/core/src/reduce.test.ts` — the file that
  already owns the `match.started` / `replay` cases — as
  `describe('match.started folds the per-match vpToWinOverride (S2.1.3)')`: the override
  survives replay (and `replay` === the manual `reduce` fold), an event without it leaves
  the key absent, and the folded value is the LIVE threshold end-to-end (a replayed
  genesis carrying 6 ends at 8 VP where the same log without it stays open at Classic 10).
- Story 02 therefore needs NO reduce change: setting `vpToWinOverride` on the emitted
  `match.started` is sufficient — it reaches state, `validate`, and replay on its own.

## Findings
<!-- appended by the worker ONLY on a wall -->
