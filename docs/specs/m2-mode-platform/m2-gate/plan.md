# M2 gate audit & closure (plan)

**Tier:** 3 · **Spec slug:** `m2-gate` · **Brief:** [brief.md](brief.md)
**Governed by:** `docs/specs/m2-mode-platform/plan.md` (M2 GATE, §6 status table) ·
ADR-0003 (pure zero-dep core) · ADR-0008 (trilingual) · ADR-0013
**Depends on:** S2.1.7b ✅ merged (`3035ba5`) — last feature pack before the gate.

## Goal

Close the M2 gate honestly: every gate clause either holds with named evidence, or is
amended by the owner on the record. Recon (2 scouts, 2026-08-17) found three gaps between
the gate's letter and the repo: no full-match e2e for `balanced`/`blitz`, adaptive
duration implemented but never wired (zero callers), and two clauses (Redis presence,
OAuth) contradicting earlier owner deferrals. Owner answered all three briefing
questions (brief.md `## Answers`): amend Redis and OAuth clauses; wire adaptive duration
live. After this pack the gate text matches reality and each remaining clause has a test
or a file to point at.

## Assumptions

- Applying `computeAdaptiveDuration` at match genesis is deterministic given profile +
  seat count, so replay/verify stay byte-stable for a fixed roster (worker must add the
  determinism leg to prove it, not assert it).
- Blitz full-match e2e can run boot-free with inert timers (bots act immediately);
  timers are covered by S2.1.4's own suite.
- Classic 4p stays within the 60-min ceiling (calibration test), so wiring adaptive
  duration does NOT change Classic 2–4p behavior — Classic byte-freeze holds.

## Stories

**Wave 1** (3 concurrent, disjoint packages)
- `m2-gate-01-balanced-blitz-e2e` — boot-free full-match e2e for `balanced` and `blitz`
  (winner, determinism, replay, verify) + CI named gate lists all per-profile e2e files.
- `m2-gate-02-adaptive-duration-live` — GameRoom applies `computeAdaptiveDuration` at
  genesis; lobby shows the duration estimate + over-ceiling warning; 3 i18n keys ×3.
- `m2-gate-03-profile-enum-parity` — test pinning protocol `ShippingProfileIdSchema` to
  core `SHIPPING_PROFILE_IDS` (a sixth profile can no longer pass core and die on wire).

**Wave 2** (after all of wave 1)
- `m2-gate-04-gate-amend-and-evidence` — milestone plan.md: amend gate wording per owner
  answers (Redis → M5, OAuth ← creds, adaptive now enforced), evidence line per clause,
  fix stale §6 rows (S2.1.7a/7b), record E2.6 epic closure state.

## Contracts

- The adjusted `vpToWin` is computed SERVER-SIDE once, at match genesis, as
  `computeAdaptiveDuration(profile, seatCount)` from `@skervik/core`; the client lobby
  estimate calls the SAME core function with the same inputs — no new protocol message,
  no second estimator. If the worker finds the room needs to surface the adjusted value
  to the client beyond existing state, that is an INTERFACES return line, not an
  improvised message.
- New i18n keys (3: estimate label, minutes value, over-ceiling warning) land in
  `keys.ts` + all three locales in the same story (02) — the locale-completeness test
  makes a partial landing unmergeable.
- Story 01's CI edit only ADDS named vitest invocations to the existing "E2E full-match"
  step; it does not restructure the workflow.

## Integration gate

`pnpm -s typecheck && pnpm -s -r lint && pnpm -s -r test && pnpm -s -r build && node scripts/check-core-no-runtime-deps.mjs`
plus `bash scripts/wave-check.sh docs/specs/m2-mode-platform/m2-gate` before each dispatch.

## Descoped

*(empty)*

## Plan deltas

*(none yet)*

**Approved:** owner, 2026-08-17 — plan + 3 briefing answers (Redis→M5, OAuth←creds, adaptive live) accepted; build authorized.
