---
domain: networking
tags: [security, anti-cheat, architecture, invariant]
related: [deterministic-core, fair-rng-commit-reveal]
last-verified: 2026-06-30
---

# Authoritative server (anti-cheat)

The server is the single source of truth. Clients render and send *intents*; they
never decide outcomes. This is the foundation of anti-cheat and synchronization
(tech spec §2.1, §8.4). Decision record: ADR-0004.

Invariants:
- **Client → intents only.** Every intent is validated server-side by `@skervik/core`
  `validate`; an invalid intent yields `intent.rejected`, never a state change.
- **Server → events only.** Authoritative events (a `event.batch`) are the only thing
  that mutates state on either side (see [[deterministic-core]]).
- **Hidden information stays hidden.** Opponents' dev cards / unrevealed state are
  **never serialized to a client** until legitimately revealed.
- **RNG is server-side** and provable (see [[fair-rng-commit-reveal]]); clients cannot
  predict or influence rolls.
- **Defense in depth:** rate-limit intents, validate turn timers server-side, guard
  against spam.
- **Client prediction is cosmetic** — only "safe" actions (menu/selection) predict
  locally; on divergence the client reconciles to authoritative state.

State lives in one node per room (**sticky-by-room**); periphery is stateless.
