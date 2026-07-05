# ADR-0010: Client i18n mechanism — a custom typed layer over the platform `Intl` APIs

- Status: **accepted** — owner-selected 2026-07-05 (recommended option)
- Date: 2026-07-05
- Spec: docs/specs/m1-vertical-slice (E1.6 client — binds every S1.6.x UI story; realized as the framework in S1.6.6)
- Implements the mechanism ADR-0008 mandates (trilingual RU/UA/EN from the first playable build)

## Context

ADR-0008 locked the product as **trilingual RU/UA/EN from the first playable build**:
every user-facing string ships in all three locales, and *no user-facing string ever
exists in fewer than three languages* — a hard PR merge gate, not a retrofit. E1.6 is
the first epic that produces user-facing strings (S1.6.3 HUD onward; S1.6.1 board render
and S1.6.2 pieces are canvas-only, locale-independent digits). Before HUD strings
accumulate, the client needs ONE i18n mechanism, chosen once, so every UI story from
S1.6.3 speaks through it and the ADR-0008 gate is enforced mechanically rather than by
reviewer vigilance.

Constraints from the locked stack and constitution shape the answer:

- **AGPL-3.0, no third-party CDN calls** (DESIGN.md §3 — all faces self-hosted): the
  locale mechanism and its data must be bundled/self-hosted, never fetched from a
  translation CDN.
- **Lean dependency posture** (CLAUDE.md): `@skervik/core` is zero-runtime-dep;
  `@skervik/protocol` acquired its first runtime dep (zod) only under protest, to guard
  the trust boundary. New client deps must earn their place.
- **Modest M1 string surface:** DESIGN.md §11 fixes a small, specific component
  inventory (Button, Pill, PlayerCard, Panel, OfferCard, LogLine, Histogram, …) — the
  M1 string set is bounded, not an open-ended content platform.
- **Slavic plural complexity:** RU and UA have non-trivial plural categories
  (one/few/many/other) — "2 руна" vs "5 рун" — which naive `key + count` interpolation
  gets wrong. Any mechanism must produce correct Slavic plurals.
- **DESIGN.md §10 merge gates:** locale-aware number/date/timer formatting, tabular
  numerals, and text that tolerates ~25–35% RU/UA expansion.

Three mechanisms were weighed: (A) a custom typed layer over the platform `Intl` APIs;
(B) `i18next` + `react-i18next`; (C) `react-intl` (FormatJS).

## Decision

### Adopt **Option A — a custom, typed i18n layer built on the platform `Intl` APIs.**

The mechanism is a thin, first-party module in `@skervik/client` (materialized as the
framework in **S1.6.6**, but its call-site API — `t(key, params)` / a `useTranslation`
hook / a `LocaleSwitcher` — is the contract every earlier E1.6 story codes against):

1. **Typed key catalogue as the single source of truth.** A canonical `TranslationKey`
   union (or a `const` key object) defines every user-facing string id. Each locale is a
   `Record<TranslationKey, string>` for `ru`, `ua`, `en`. Because all three locale
   records are typed against the *same* key union, **a key missing from any one locale
   fails `tsc` / the build.** This turns ADR-0008's "no string in fewer than three
   languages" from a runtime missing-key fallback (what i18next/react-intl give) into a
   **compile-time type error** — the strongest possible enforcement of the mandate, and
   the decisive reason for this choice on our stack.

2. **Plurals via the built-in `Intl.PluralRules`.** `Intl.PluralRules('ru' | 'uk')`
   yields correct CLDR plural categories (one/few/many/other) with zero dependency; the
   layer maps a category → the localized form authored in the catalogue. Correct Slavic
   plurals, no library.

3. **Number / date / timer formatting via `Intl.NumberFormat` / `Intl.DateTimeFormat`**
   (built into the JS runtime) — satisfies DESIGN.md §10 locale-aware formatting and
   tabular-numeral requirements without a formatting dependency.

4. **Zero runtime dependencies.** Aligns with the lean posture (core zero-dep; protocol
   minimal); everything self-hosted, satisfying AGPL/no-CDN by construction.

5. **Keys come from the lore-primer glossary.** New user-facing terms are authored in
   all three languages at creation, sourced from `docs/wiki/lore-primer.md`'s RU/UA/EN
   glossary (the established pattern), so lore terminology stays consistent with the
   canvas/brand.

Rejected — **Option B (`i18next` + `react-i18next`):** the de-facto standard, with rich
ICU pluralization, namespaces, lazy-loading, and a mature translator-tooling ecosystem
(key extraction, TMS integrations). But for M1 it costs a ~40 kB runtime dependency,
enforces the trilingual invariant only at **runtime** (a missing key falls back, it does
not fail the build — strictly weaker than a type error for ADR-0008), and carries far
more API surface than the bounded M1 string set needs. Its ecosystem advantages
(external-translator workflows, many locales) are M4-era concerns (locale QA), and the
call-site `t()` API we adopt is deliberately kept compatible so a later migration TO
i18next is a swap of the layer, not a rewrite of call sites.

Rejected — **Option C (`react-intl` / FormatJS):** standards-grade ICU MessageFormat and
strong formatting, but heavier ceremony, a build-time message-extraction step, and
overkill for M1's string surface; same runtime (not compile-time) key enforcement as B.

## Consequences

- **Easier:** ADR-0008's core invariant is enforced by the type-checker, not by review
  diligence — a PR that adds an EN-only string cannot compile; no new runtime dependency
  enters the client; correct RU/UA plurals and locale formatting fall out of the platform
  `Intl` APIs; the whole mechanism is a few small first-party files that stay auditable
  and self-hosted (AGPL/no-CDN).
- **Harder / debt accepted:** we own the layer (the `t()`/`useTranslation`/plural-select
  glue and its tests) instead of importing a maintained one; there is **no built-in
  external-translator tooling** (key extraction, TMS sync) — acceptable while locales are
  authored in-repo by the team (M1–M3), revisited if/when outside translators are
  onboarded; ICU-grade message features (nested select, rich formatting) are not
  available out of the box — the M1 string set does not need them, and anything beyond
  simple interpolation + plural-select should prompt a reassessment rather than an ad-hoc
  extension.
- **Per-story guidance:**
  - **S1.6.1 / S1.6.2 (board / pieces):** canvas-only, **zero** user-facing DOM strings
    (locale-independent digits are allowed). Do not hardcode any translatable string; do
    not pre-build the i18n layer (S1.6.6 owns it). Compliant by having no strings.
  - **S1.6.3 (HUD) — FIRST consumer:** materialize the typed layer's call-site contract
    here if S1.6.6 has not landed yet, OR sequence S1.6.6's framework portion before
    S1.6.3. Every HUD string is a typed key with `ru`/`ua`/`en` authored together. (The
    Queen will decide the exact ordering when dispatching E1.6's middle stories; the
    binding rule is: no HUD/Trade string may merge mono-lingual or untyped.)
  - **S1.6.4 (Trade UI):** all offer/confirm/counter/reaction copy through typed keys in
    three locales; quick-reactions are predefined localized strings (DESIGN.md §7.3),
    never free text.
  - **S1.6.6 (i18n framework + locales):** materializes the layer — `TranslationKey`
    catalogue, three locale records, `Intl.PluralRules` plural-select, `Intl.*`
    formatters, `useTranslation` hook, `LocaleSwitcher` component — and backfills any
    keys introduced by earlier E1.6 stories, all three locales complete.

## Invariants created

Bind every E1.6 (and later) client UI story; add to the client UI review checklist:

1. **Every user-facing string is a typed key present in all three locale records
   (`ru`, `ua`, `en`).** A missing key in any locale is a build failure, not a runtime
   fallback. No hardcoded user-facing string, ever (canvas locale-independent digits
   excepted).
2. **Plurals go through `Intl.PluralRules`** (never `count === 1 ? a : b`); numbers,
   dates, and timers through `Intl.NumberFormat` / `Intl.DateTimeFormat` with tabular
   numerals (DESIGN.md §10).
3. **The client i18n layer adds no runtime dependency** and fetches nothing over the
   network — locale data is bundled/self-hosted (AGPL/no-CDN).
4. **New user-facing terms are born trilingual from the lore-primer glossary** at
   creation time (ADR-0008); lore terms use i18n keys, while core/protocol identifiers
   stay mechanical English (`settlement`, `robber`, `desert`).
5. **The call-site API (`t(key, params)` / `useTranslation`) is kept
   library-agnostic** so a future migration to i18next/react-intl swaps the layer without
   touching call sites.

## Revisit when

- Outside translators or a translation-management platform are onboarded, or the locale
  count grows well beyond three — reassess against `i18next`'s extraction/TMS ecosystem
  (migrate the layer, keep call sites).
- A UI need genuinely requires ICU-grade message features (nested select, gender,
  complex embedded formatting) that the thin layer cannot express cleanly — reopen rather
  than accreting ad-hoc complexity onto the custom layer.
- The hand-owned layer's maintenance cost (plural glue, formatter wiring, its tests)
  starts to exceed what a maintained library would charge — reopen the build-vs-buy call.
