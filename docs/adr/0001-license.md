# ADR-0001: Project license

- Status: accepted
- Date: 2026-06-30 (locked by owner)
- Spec: docs/specs/roadmap (S0.1.1)

## Context
The project is OSS, non-commercial, donation-funded, and ships as a *hosted online
service*. The license must protect the community's work from a closed-source
competitor that takes the code, runs it as a service, and contributes nothing back.

## Options
1. **AGPL-3.0** — network copyleft: anyone running a modified version as a network service must publish their source. Strongest protection for a hosted game.
2. **MIT** — maximal permissiveness; allows closed-source forks and hosted derivatives.
3. **GPL-3.0** — copyleft, but the network-use loophole lets SaaS forks stay closed.

## Decision
**AGPL-3.0** (locked). Deciding factor: the value
of this project is the *running service*; AGPL closes the SaaS loophole that MIT/GPL
leave open, which fits the "OSS, no greedy closed forks" intent (tech spec §10).

## Consequences
- Easier: contributors trust their work stays open; aligns with transparency narrative.
- Harder: some companies avoid AGPL dependencies — irrelevant for an end-user game, but note it if `@skervik/core` is ever meant for reuse (could dual-license core under MIT later).
- Debt: every source file needs an AGPL header; CI license-check recommended.

## Invariants created
- All first-party packages carry the project license; third-party assets/art must be license-compatible and attributed.

## Revisit when
- We want `@skervik/core` reusable as a permissive library → consider dual-licensing core (MIT) while the service stays AGPL.
