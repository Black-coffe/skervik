// Pure `GamePhase` -> localized `phase.*` translation-key mapping (S1.6.3).
// A `Record<GamePhase, TranslationKey>` so TypeScript enforces every phase
// has a key — adding a phase to core's `GamePhase` union without extending
// this map is a compile error, the same "can't ship a gap" discipline as
// `Messages`.
import type { GamePhase } from '@skervik/core';

import type { TranslationKey } from '../i18n/keys.js';

export const PHASE_KEY: Readonly<Record<GamePhase, TranslationKey>> = {
  lobby: 'phase.lobby',
  setup: 'phase.setup',
  roll: 'phase.roll',
  main: 'phase.main',
  robber: 'phase.robber',
  finished: 'phase.finished',
};
