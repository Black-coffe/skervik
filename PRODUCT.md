# Product

> Strategic design context for Skervik UI work. Binding for every agent that
> touches `packages/client` or authors UI specs. Visual rules live in
> [DESIGN.md](DESIGN.md). Canonical lore & naming: `docs/wiki/lore-primer.md`.

## Register

product

(The game table is the one surface that earns brand-level atmosphere; HUD,
lobby, dialogs and dashboards are instruments and follow product rules. See
"Two-surface model" in DESIGN.md.)

## Users

Competitive online board-game players, 3–4 per match (7–10 later), sessions
capped at 60 minutes, mostly evenings on desktop; mobile browser is a
first-class secondary target (PWA). Trilingual audience — RU / UA / EN from
the first build (ADR-0008). Many arrive burned by competitors: perceived
rigged dice, trade misclicks, dead time, karmic disconnect bans. Their job:
negotiate, plan, and win a fair match with friends or strangers without the
UI ever costing them a move.

## Product Purpose

Skervik is an open-source (AGPL-3.0, non-commercial) online
"explore–trade–settle" strategy game — mechanically familiar, legally and
artistically independent from CATAN. Success = players trust the dice
(provably fair commit-reveal RNG, "Честный жребий"), trade fearlessly (the
trade UI is the heart of the product, not a feature), and finish matches on
time (adaptive duration). The client renders and sends intents; the server is
authoritative — the UI must never pretend otherwise.

## Brand Personality

**Weathered · precise · fair.** A turn-of-the-century (≈1900) polar trading
expedition: steam + sail, riveted iron, brass instruments, kerosene light,
wet granite, gray water. Painterly, adult, premium. The UI behaves like a
navigator's instrument: calm, exact, quietly confident. Drama comes from the
sea and the deal, never from the chrome. One scientific anomaly (the Mist);
zero mysticism.

## Anti-references

- **CATAN trade dress** — legal red line: no lookalike tile textures, port
  icons, wording, or component styling. Independent world, independent look.
- **Colonist-class trade UI** — buttons that move underfoot, misclick-prone
  offers, hidden state. Our trade flow is stable, explicit, confirmable.
- **Viking/fantasy kitsch** (Valheim, Northgard vibes) and any mysticism —
  wrong era, wrong tone.
- **Cartoon board-game pastel** and **grimdark** — both off-tone; we are
  painterly realism.
- **Steampunk kitsch** — gears-and-goggles ornament, brass gradients on every
  button. Era 1900 is a material palette, not a costume.
- **Generic SaaS dashboard chrome** — the stats surfaces are ship's
  instruments, not a KPI landing page.

## Design Principles

1. **The board is the light source.** The dark sea-chart environment exists
   to make the Лоция (board) and the deal glow; UI chrome recedes.
2. **Never cost the player a move.** Stable layouts, explicit confirmations,
   ≥44px targets, latency states — a misclick or a mystery state is a
   product-level defect, not polish debt.
3. **Fairness must be visible.** Seed-hash chip, tide-lot distribution vs.
   expected curve, replayable history — trust is a UI feature.
4. **Distinguish by more than color.** Every resource, flotilla, and state
   carries a shape/emblem/pattern in addition to its hue (a11y invariant).
5. **Three languages or none.** No user-facing string exists in fewer than
   RU/UA/EN; layouts budget for the longest locale.
6. **Instrument, not ornament.** Motion and decoration convey game state
   (tide, storm, mist, turn) — never run for their own sake.

## Accessibility & Inclusion

WCAG 2.1 AA floor: body text ≥4.5:1, large text/graphics ≥3:1. Colorblind-safe
by construction (principle 4), plus planned colorblind modes (M4 hardening,
but nothing shipped in M1 may *depend* on hue alone). Keyboard navigation for
all non-canvas UI; screen-reader coverage for menus/lobby; font-scale setting;
`prefers-reduced-motion` honored everywhere including canvas animations.
Trilingual i18n baked in from the first string (keys only, no hardcoded text).
