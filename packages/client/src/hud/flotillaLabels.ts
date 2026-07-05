// Pure `FlotillaId` -> localized `hud.flotilla.*` translation-key mapping —
// same "exhaustive Record, no dynamic key string" discipline as `phase.ts`.
import type { TranslationKey } from '../i18n/keys.js';
import type { FlotillaId } from '../theme/flotillaColors.js';

export const FLOTILLA_KEY: Readonly<Record<FlotillaId, TranslationKey>> = {
  petrel: 'hud.flotilla.petrel',
  orca: 'hud.flotilla.orca',
  walrus: 'hud.flotilla.walrus',
  narwhal: 'hud.flotilla.narwhal',
};
