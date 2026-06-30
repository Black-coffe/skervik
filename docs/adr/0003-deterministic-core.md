# ADR-0003: Deterministic isomorphic rule core

- Status: accepted
- Date: 2026-06-30
- Spec: docs/specs/roadmap (E0.5)

## Context
Replays, client prediction, crash recovery, async play, and *provable RNG fairness*
all require that the same inputs always produce the same game state, on any device.
This is the central architectural decision of the project (tech spec §4).

## Options
1. **Pure deterministic core** `reduce(state, event) → state`, zero runtime deps, shared by client & server.
2. Server-only rules + thin client — simpler core, but no client prediction, no shared replay, duplicated logic.
3. Per-runtime implementations (TS server + separate client) — drift risk, breaks determinism guarantees.

## Decision
**Option 1.** `@skervik/core` is a pure TS package with **no runtime dependencies**,
exporting `reduce` (state transition) and `validate` (intent → events | rejection).
The same compiled core runs authoritatively on the server and predictively on the client.

## Consequences
- Easier: free replays/audit/recovery/async; one rules codebase; testable in isolation.
- Harder: core must avoid all nondeterminism — **no `Date.now()`, no `Math.random()`, no I/O, no iteration-order-dependent logic over unordered maps**. Time and randomness enter only as event data derived from the seeded PRNG.
- Debt: a golden-replay determinism test must run in CI from day one (S0.3.2).

## Invariants created
- `@skervik/core` has zero runtime deps and is side-effect free.
- All randomness flows through the seeded PRNG (ADR + `docs/wiki/fair-rng-commit-reveal.md`), keyed by event-stream index.
- Only server-emitted **events** mutate state; client **intents** never do directly.
- Replaying an event log reproduces byte-identical state.

## Revisit when
- A required feature cannot be expressed deterministically (none foreseen) — escalate to lead-architect before weakening this.
