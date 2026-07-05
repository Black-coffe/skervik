import type { Messages } from '../messages.js';

// Russian — default locale. Phase names + glossary tone from
// `docs/wiki/lore-primer.md` (realism ≈1900, no mysticism).
export const ru: Messages = {
  'common.cancel': 'Отмена',
  'common.confirm': 'Подтвердить',
  'phase.setup': 'Постановка',
  'phase.roll': 'Прилив',
  'phase.main': 'Торговля и стройка',
  'phase.finished': 'Итог',
  'hud.resourceCards': {
    one: '{count} карта',
    few: '{count} карты',
    many: '{count} карт',
    other: '{count} карты',
  },
};
