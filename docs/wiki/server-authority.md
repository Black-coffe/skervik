---
domain: networking
tags: [security, anti-cheat, architecture, invariant]
related: [deterministic-core, fair-rng-commit-reveal, seed-handling]
last-verified: 2026-07-03
---

# Authoritative server (anti-cheat)

The server is the single source of truth. Clients render and send *intents*; they
never decide outcomes. This is the foundation of anti-cheat and synchronization
(tech spec §2.1, §8.4). Decision record: ADR-0004.

Invariants:
- **Client → intents only.** Every intent is validated server-side by `@skervik/core`
  `validate`; an invalid intent yields `intent.rejected`, never a state change.
- **Server → events only.** Authoritative events (a `event.batch`) are the only thing
  that mutates state on either side (see [[deterministic-core]]). Server broadcasts
  validated `GameEvent[]`; clients fold them through the same `@skervik/core` `reduce`
  to advance local state (S1.4.1, ADR-0009 Fork 1).
- **The Colyseus room holds the authoritative plain `GameState`** — never mirrored into
  `@colyseus/schema`. The Schema (S1.4.1) projects **only** the public lobby/late-join data
  (`seedHash`, `phase`, `currentPlayerId`, seat list with connection status) — no resource
  counts, hand size, board state, or hidden information. Gameplay flows as `event.batch`,
  not through the Schema.
- **Hidden information stays hidden.** Opponents' dev cards / unrevealed state are
  **never serialized to a client** until legitimately revealed.
- **RNG is server-side** and provable (see [[fair-rng-commit-reveal]]); clients cannot
  predict or influence rolls. The raw seed is never broadcast (see [[seed-handling]]);
  only `seedHash` is public.
- **Defense in depth:** rate-limit intents, validate turn timers server-side, guard
  against spam.
- **Client prediction is cosmetic** — only "safe" actions (menu/selection) predict
  locally; on divergence the client reconciles to authoritative state via `state.snapshot`
  on join or reconnect.

State lives in one node per room (**sticky-by-room**); periphery is stateless. See
[[deterministic-core]] for how event-sourced state stays in sync across server authority
and client prediction.
