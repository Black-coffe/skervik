import './LocaleSwitcher.css';

import type { KeyboardEvent } from 'react';
import { useRef } from 'react';

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
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Roving-tabindex radio pattern (S1.6.6a lead-review nit 1): a single tab
  // stop (the active option), Left/Up/Right/Down move + apply selection,
  // same as a native <input type="radio"> group.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % LOCALES.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + LOCALES.length) % LOCALES.length;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextLocale = LOCALES[nextIndex] as Locale;
    setLocale(nextLocale);
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      className="locale-switcher"
      role="radiogroup"
      aria-label={t('a11y.languageSwitcher')}
    >
      {LOCALES.map((candidate, index) => {
        const active = candidate === locale;
        return (
          <button
            key={candidate}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            tabIndex={active ? 0 : -1}
            className="locale-switcher__option"
            onClick={() => setLocale(candidate)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {ENDONYMS[candidate]}
          </button>
        );
      })}
    </div>
  );
}
