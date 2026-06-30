---
domain: fairness
tags: [rng, security, trust, invariant]
related: [deterministic-core, server-authority]
last-verified: 2026-06-30
---

# Provably fair RNG (commit-reveal)

The single biggest reputational failure of competitors is *perceived* rigged dice.
We answer it with cryptographic provability, not promises.

Protocol (tech spec §4.2):
1. **Commit** — at match start the server generates a crypto-random `seed` and shows
   players `seedHash = SHA256(seed)` *before* play begins.
2. **Derive** — every random event (dice, number-deck shuffle, dev-card draw) is
   computed deterministically from `seed` + the event's `rngStreamIndex` via the
   seeded PRNG. Nothing is rolled "live".
3. **Reveal** — when the match ends the server publishes the raw `seed`.
4. **Verify** — anyone can recompute every roll from `seed` + the public event log
   (`GET /matches/{id}/verify`) and confirm nothing was altered.

Invariants:
- The `seed` is **never** sent before the match ends; only `seedHash` is shown early.
- All randomness flows through the seeded PRNG keyed by stream index — never `Math.random()` (see [[deterministic-core]]).
- The event log is the source of truth for verification; it must record `rngStreamIndex` on every random event.

Surfaced to users via the verification UI (story S3.3.3) and roll-distribution
analytics (S3.4.1) so trust is data-backed.
