# ADR-0005: Authentication providers

- Status: accepted
- Date: 2026-06-30 (locked by owner)
- Spec: docs/specs/roadmap (S0.1.3, M2 E2.6)

## Context
"One-click play" is a product requirement (guests, no signup). Registered accounts
need low-friction OAuth suited to a gaming audience.

## Options
1. **Guest sessions + Google + Discord OAuth** (recommended).
2. Google only — broad but impersonal for gamers.
3. Email/password — highest friction, more security surface (password storage, resets).

## Decision
**Guest sessions + Google + Discord** (locked). Discord matches the
gamer audience and doubles as the community hub; Google maximizes reach; guests remove
the signup barrier and can upgrade in place.

## Consequences
- Easier: instant play; community continuity via Discord.
- Harder: OAuth callback + token-refresh + guest-upgrade flows to build (M2 E2.6).
- Debt: guest accounts need a cleanup/retention policy.

## Invariants created
- Guests need no email; JWT short TTL + refresh; self-service delete/export (GDPR).

## Revisit when
- Demand for Apple/Steam/other identity providers appears.
