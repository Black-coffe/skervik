---
story: m2-gate-06
spec: m2-gate
status: in-progress -> done (wave 5, 2026-08-17)
tier: 2
worker: worker-code
tracer: false
wave: 5
blocked_by: []
---

# Adaptive VP floor clamps at 8 + fold guard

## Goal
Review C1: the adaptive floor of 5 allows a 6-VP expanded match winnable with zero
building (two setup settlements + both awards). Owner Q4: the floor is 8. After this
story `computeAdaptiveDuration` never recommends a threshold below 8 (expanded 5p AND
6p → 8 VP; 6p honestly reports `exceeds_ceiling_at_vp_floor`), and the reduce fold
ignores values the wire schema would reject (review minor: 0/negative/non-integer).

## Requirements
> Кламп пола ≥ 8 VP — адаптация не опускает порог побед ниже 8; expanded 5p и 6p
> играют до 8 VP; калибровка эстиматора — M3 с телеметрией
> adaptive duration keeps matches ≤60 min

## Files
- packages/core/src/adaptiveDuration.ts
- packages/core/src/adaptiveDuration.test.ts
- packages/core/src/reduce.ts
- packages/core/src/reduce.test.ts

## Non-goals
- Do NOT touch the estimator's minute constants (SETUP/PLAYER_TURN/ROUNDS_PER_VP) —
  only the floor changes; calibration is M3.
- Do NOT change validate.ts, GameRoom, lobby, or any schema.
- Do NOT weaken the fold's absent-key byte-freeze contract: an invalid value results in
  the key staying ABSENT, never a default number.

## Map slice
packages/core/src/adaptiveDuration.ts (ADAPTIVE_VP_FLOOR docstring), reduce.ts match.started fold

## Acceptance criteria
- [ ] `ADAPTIVE_VP_FLOOR` is 8; its docstring's "below 8 is punitive" claim and the
      constant now agree. Calibration anchors updated: expanded 5p → 8 (no warning if it
      fits, else warning), expanded 6p → 8 + `exceeds_ceiling_at_vp_floor`; Classic 4p
      unchanged (10, no adjustment); a test pins "result never below 8 for any
      profile × seat count in shipping range".
- [ ] reduce fold drops non-positive/non-integer/NaN `vpToWinOverride` (key absent),
      with tests; valid values fold exactly as before (existing tests stay green).
- [ ] Core suite green; zero-runtime-deps green.

## Verification
`pnpm --filter @skervik/core test -- --reporter=dot && node scripts/check-core-no-runtime-deps.mjs`

## Implementation notes
<!-- appended by the worker -->
- Floor 5→8 only (minute constants untouched): expanded 5p → 8 VP / 58 min (fits, no
  warning), expanded 6p → 8 VP / 67.6 min + `exceeds_ceiling_at_vp_floor`, Classic 4p
  unchanged. The old `('classic', 6)` "lowers until it fits" case asserted a now-false
  outcome (6p Classic also hits the floor and warns) and was re-pointed at expanded 5p/6p;
  a new loop pins ≥ 8 across `SHIPPING_PROFILE_IDS` × 2–6 seats.
- Fold guard `foldsVpToWinOverride` mirrors the wire schema (`int().positive()`): invalid
  values leave the key ABSENT (asserted byte-equal to a genesis without it). Server/client
  read core via `dist`, so 6→8 stays invisible to their suites until `pnpm -r build`.

## Findings
<!-- appended by the worker ONLY on a wall -->
