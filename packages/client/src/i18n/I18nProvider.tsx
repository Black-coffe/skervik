import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { Formatters } from './format.js';
import { makeFormatters } from './format.js';
import type { TranslationKey } from './keys.js';
import type { Locale } from './locale.js';
import { DEFAULT_LOCALE, isLocale } from './locale.js';
import { en } from './locales/en.js';
import { ru } from './locales/ru.js';
import { uk } from './locales/uk.js';
import type { Messages } from './messages.js';
import type { TranslateParams } from './translate.js';
import { translate } from './translate.js';

const MESSAGES_BY_LOCALE: Record<Locale, Messages> = { ru, uk, en };

const STORAGE_KEY = 'skervik:locale';

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    // localStorage may be unavailable (private mode / disabled) — fall back
    // to the default rather than crash the app.
    return DEFAULT_LOCALE;
  }
}

export interface I18nContextValue extends Formatters {
  readonly locale: Locale;
  readonly setLocale: (locale: Locale) => void;
  readonly t: (key: TranslationKey, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export interface I18nProviderProps {
  readonly children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting is best-effort — the switch still applies this session.
    }
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const messages = MESSAGES_BY_LOCALE[locale];
    const formatters = makeFormatters(locale);
    return {
      locale,
      setLocale,
      t: (key, params) => translate(messages, locale, key, params),
      ...formatters,
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation() must be used within an <I18nProvider>');
  return ctx;
}
