import './LocaleSwitcher.css';

import { useTranslation } from './I18nProvider.js';
import type { Locale } from './locale.js';
import { LOCALES } from './locale.js';

// Language names are proper nouns (endonyms), not translatable strings —
// the one legitimate non-`t()` piece of UI text (S1.6.6a spec).
const ENDONYMS: Record<Locale, string> = {
  ru: 'Русский',
  uk: 'Українська',
  en: 'English',
};

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useTranslation();

  return (
    <div
      className="locale-switcher"
      role="radiogroup"
      aria-label={t('a11y.languageSwitcher')}
    >
      {LOCALES.map((candidate) => {
        const active = candidate === locale;
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            className="locale-switcher__option"
            onClick={() => setLocale(candidate)}
          >
            {ENDONYMS[candidate]}
          </button>
        );
      })}
    </div>
  );
}
