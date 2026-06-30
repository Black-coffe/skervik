# ADR-0007: Project name / brand — Skervik

- Status: accepted
- Date: 2026-06-30
- Spec: docs/specs/m0-foundation (S0.1.2)

## Context

The project needed an original, legally clean, ownable brand — it cannot use "Catan"
(trademarked by Catan GmbH) and must not infringe on any existing game names, active
.com domains, or Steam titles. The working codename "Archipelago" described the setting
but was never intended as the final brand. A final name was needed before M1 art
direction begins (S0.1.2 gate).

## Options

1. **Skerry** — loved for its Norse skerry (small rocky island) feel and direct tie to
   the archipelago setting. Blocked: an existing online game "Within Skerry" appears on
   Steam (trademark/SEO collision risk); skerry.com has been registered since 1999.
2. **Skervik** — *skerry* + Norse *vík* ("bay/inlet"). Retains the loved "Sker-" prefix
   and the archipelago/island setting resonance; skervik.com was free; zero brand
   conflicts found across games, Steam, trade registers.
3. **Nesoi** — Greek word for islands; poetic but obscure, no strong association with the
   setting's Norse/maritime feel.
4. **Hexarch** — descriptive of the hex-grid mechanic; too genre-generic, risks confusion
   with other hex-grid games.

## Decision

**Skervik.** Deciding factors: clean on all collision checks (games, Steam, trade
registers); skervik.com available and registered 2026-06-30 (2-year term, exp 2028,
WHOIS privacy ON, auto-renew ON via Namecheap); preserves the "Sker-" sound the team
loved in "Skerry"; the *vík* suffix adds distinctiveness and Norse authenticity fitting
the sea-trade setting.

## Consequences

- Easier: brand assets, social handles, Discord, and domain all under one clean name.
- Harder: none significant — the name is short and memorable.
- Accepted debt: the package scope `@skervik/*` is **not** renamed by this ADR — that is a
  separate decision (no breaking change to tooling at this stage).

## Invariants created

- The project brand is **Skervik**; all new user-facing text, assets, and handles must
  use this name.
- The word "archipelago" (lowercase) describing the game world / setting / lore is
  **preserved** — Skervik's world is an archipelago of skerries.
- The package scope `@skervik/*` remains unchanged until a separate ADR decides otherwise.

## Revisit when

- A genuine trademark conflict with "Skervik" is discovered.
- The `@skervik/*` scope rename decision is made (tracked separately).
