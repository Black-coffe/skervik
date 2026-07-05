// Supported client locales (ADR-0010). BCP-47 codes as consumed by `Intl`.
// The product brands Ukrainian as "UA" in UI copy; the Intl/BCP-47 code is
// `uk`, so that is the `Locale` value used everywhere in code.
export type Locale = 'ru' | 'uk' | 'en';

export const LOCALES: readonly Locale[] = ['ru', 'uk', 'en'];

// RU is the default per the current user base (lore-primer §"Зафиксировано
// владельцем"; ADR-0008 trilingual mandate applies to content, not default).
export const DEFAULT_LOCALE: Locale = 'ru';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
