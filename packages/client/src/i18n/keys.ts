// Single source of truth for every user-facing string id (ADR-0008 gate).
// `TranslationKey` is derived from this const array so it doubles as a
// runtime list (used by the locale-completeness test) and a compile-time
// string-literal union (used by `Messages`/`translate`). Adding a key here
// without adding it to ALL THREE locale files fails `tsc` — see
// `messages.ts` and `locales/*.ts`.
//
// Namespaced, dotted keys (e.g. `common.cancel`, `phase.setup`). This seed
// is intentionally small — S1.6.3 (HUD) grows the catalogue key-by-key.
export const TRANSLATION_KEYS = [
  'common.cancel',
  'common.confirm',
  'phase.setup',
  'phase.roll',
  'phase.main',
  'phase.finished',
  'hud.resourceCards',
] as const;

export type TranslationKey = (typeof TRANSLATION_KEYS)[number];
