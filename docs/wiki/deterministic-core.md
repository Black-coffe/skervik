---
domain: core-engine
tags: [determinism, architecture, invariant]
related: [fair-rng-commit-reveal, server-authority]
last-verified: 2026-06-30
---

# Deterministic isomorphic rule core (`@skervik/core`)

`@skervik/core` is a **pure** package: `reduce(state, event) → newState` and
`validate(state, intent, playerId) → { ok, events } | { ok:false, reason }`.
Same inputs → same outputs, on every device. This determinism is what makes
replays, client prediction, crash recovery, async play, and RNG fairness possible.

Invariants any agent touching core MUST respect:
- **Zero runtime dependencies**; no I/O, no network, no filesystem, no logging side effects.
- **No nondeterminism:** never call `Date.now()`/`new Date()`/`Math.random()`; never depend on object-key or `Set`/`Map` iteration order for game-affecting logic; no floating-point where integers suffice.
- **Time and randomness are data**, not ambient: they enter only as fields on events derived from the seeded PRNG (see [[fair-rng-commit-reveal]]).
- **Only events mutate state.** Intents are requests; `validate` turns a legal intent into events; illegal intents are rejected (see [[server-authority]]).
- **Replay = truth:** replaying an event log from the initial state reproduces byte-identical state. A golden-replay test guards this in CI (story S0.3.2).

Decision record: ADR-0003. Break-glass: weakening determinism requires a
lead-architect consult and an ADR superseding 0003.
