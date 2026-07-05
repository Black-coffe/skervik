// Pure Classic-resource -> localized `resource.*` translation-key mapping —
// same exhaustive-`Record` discipline as `phase.ts`/`flotillaLabels.ts`.
import type { TranslationKey } from '../i18n/keys.js';
import type { ClassicResource } from './resourceGlyphs.js';

export const RESOURCE_KEY: Readonly<Record<ClassicResource, TranslationKey>> = {
  timber: 'resource.timber',
  clay: 'resource.clay',
  fleece: 'resource.fleece',
  barley: 'resource.barley',
  iron: 'resource.iron',
};
