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
  'phase.lobby',
  'phase.setup',
  'phase.roll',
  'phase.main',
  'phase.robber',
  'phase.finished',
  'hud.resourceCards',
  'a11y.languageSwitcher',
  'hud.matchId',
  'hud.seedChip',
  'hud.timer',
  'hud.resources',
  'hud.ventures',
  'hud.awardLongestRoad',
  'hud.awardLargestArmy',
  'hud.knightsPlayed',
  'hud.renownLabel',
  'hud.connectionOnline',
  'hud.actionBuild',
  'hud.actionTrade',
  'hud.actionVenture',
  'hud.actionEndTurn',
  'hud.tideLotPlaceholder',
  'hud.log.title',
  'hud.log.empty',
  'hud.log.collapse',
  'hud.log.expand',
  'hud.yourTurn',
  'hud.opponentTurn',
  'hud.flotilla.petrel',
  'hud.flotilla.orca',
  'hud.flotilla.walrus',
  'hud.flotilla.narwhal',
  'resource.timber',
  'resource.clay',
  'resource.fleece',
  'resource.barley',
  'resource.iron',
  'a11y.resourceCount',
] as const;

export type TranslationKey = (typeof TRANSLATION_KEYS)[number];
