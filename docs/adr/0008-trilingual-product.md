# ADR-0008: Trilingual product — RU / UA / EN from the first playable build

- Status: accepted
- Date: 2026-07-03
- Spec: owner directive 2026-07-03; supersedes the M4 scheduling of i18n strings in ROADMAP E4.4

## Context

The tech spec (§9) has always required "i18n from day one: UA, RU, EN minimum",
and fix-plan B7 added two structural rules to E1.6 (no hardcoded strings, never
color-only). But the actual i18n *framework and translated strings* were scheduled
for M4 (`E4.4/S4.4.3`) — meaning the M1 vertical slice and the entire alpha period
would ship English-or-single-language UI, with real localization retrofitted at the
end. The owner has now made multilinguality a hard product requirement: **the game
is trilingual — Russian, Ukrainian, English — and this must be baked in immediately,
across specs, lore, naming, and UI/UX**, not delivered as an M4 layer.

## Options

1. **Keep M4 scheduling** — locale keys now, translations later. Rejected: this is
   exactly the "retrofit" the project promised not to do; alpha testers (RU/UA
   community is the seed audience) would test a wrong-language product.
2. **Trilingual from M1 (chosen)** — i18n framework + RU/UA/EN locale files ship
   with the first playable build; every user-facing term is authored in all three
   languages at creation time.
3. **Trilingual everything including engineering docs** — also translate all specs,
   ADRs, wiki ×3. Rejected for now: triples doc-maintenance for a bus-factor-1
   project with zero product value to players; docs keep repo conventions (internal
   docs RU, code/identifiers EN, public contributor docs EN). Revisit if a
   non-RU-speaking contributor community materializes.

## Decision

1. **The product is trilingual RU / UA / EN starting with the M1 vertical slice.**
   The i18n framework and all three locale files move from M4 (`S4.4.3`) into M1
   (`E1.6`, new story `S1.6.6`). M4 keeps only locale QA: proofreading,
   text-expansion audit, new-locale scalability.
2. **Every user-facing name is born trilingual.** Lore terms, UI copy, marketing
   and landing texts are authored in RU+UA+EN at creation time — the lore primer's
   glossary (`docs/wiki/lore-primer.md`) is the reference pattern. No
   "translate-later" placeholders in any user-facing artifact.
3. **UI/UX must be designed for three locales**, not merely translatable:
   - layouts tolerate text expansion (RU/UA run ~20–35% longer than EN);
   - no text baked into raster/art assets — text is always a rendered layer;
   - fonts cover full Cyrillic **including Ukrainian ґ, є, і, ї** plus Latin;
   - a locale switcher exists in the very first menu UI (guest flow included);
   - locale detection defaults from browser, always user-overridable.
4. **Review gate:** a PR that adds a user-facing string in fewer than all three
   locales is rejected — same severity as the B7 rules (hardcoded strings /
   color-only). CI may enforce locale-file key parity once locale files exist.
5. **Engineering docs are NOT translated** (option 3 rejected above): internal
   specs/wiki stay RU, code and identifiers EN, public contributor docs (README,
   CONTRIBUTING) EN. Player-facing docs (rules help, landing, store pages) are
   product surface → trilingual per point 2.

## Consequences

- Easier: no M4 retrofit; alpha playtests run in testers' native languages;
  RU/UA community (the seed audience) sees itself in the product from day one;
  lore naming stays consistent because terms are fixed in 3 languages once.
- Harder: M1 UI work authors ~3× strings (mitigated: M1 slice text volume is
  small — HUD, lobby, trade dialog; authoring at creation is far cheaper than
  retrofitting); every UI PR carries a 3-locale checklist item.
- ROADMAP.md (E1.6 checklist, new S1.6.6, E4.4), ROADMAP-2026-H2 (§12 not-doing
  list, November section), tech-spec §9/§11-M4, and CLAUDE.md fixed-decisions
  table updated by this ADR's companion commit.

## Invariants created

- **Three locales — RU, UA, EN — are a launch requirement of every user-facing
  surface**, from the M1 slice onward; no user-facing string exists in fewer
  than three languages.
- New user-facing terms are defined trilingually at creation (lore primer pattern).

## Revisit when

- A fourth locale is proposed (architecture must already support it — S4.4.3).
- A sustained non-RU-speaking contributor community appears (docs translation,
  option 3).
