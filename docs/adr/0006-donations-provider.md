# ADR-0006: Donations / funding provider

- Status: accepted
- Date: 2026-06-30 (locked by owner)
- Spec: docs/specs/roadmap (S0.1.3, M4 E4.7)

## Context
Infra is donation-funded; transparency of income/spend is part of the project's trust
story (tech spec §7B, §10).

## Options
1. **Open Collective** (recommended) — public ledger of income and expenses.
2. GitHub Sponsors — frictionless for devs, less expense transparency.
3. Ko-fi — simple tips, least transparency.

## Decision
**Open Collective** (locked). Deciding factor: a public expense ledger
turns "we won't be greedy" into something verifiable, reinforcing the OSS trust pitch.

## Consequences
- Easier: public transparency page (`GET /donations/public`) maps directly to the ledger.
- Harder: Open Collective fees / fiscal-host setup overhead.
- Debt: none significant; can add GitHub Sponsors as a secondary channel.

## Invariants created
- Funding is transparent; no feature/gameplay is ever paywalled (cosmetic-only, no p2w).

## Revisit when
- Recurring infra cost outgrows donations and a sustainability model is needed.
