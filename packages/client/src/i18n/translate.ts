import type { TranslationKey } from './keys.js';
import type { Locale } from './locale.js';
import type { Messages } from './messages.js';
import { isPluralForms } from './messages.js';

export type TranslateParams = Record<string, string | number>;

// Numeric params render through `Intl.NumberFormat` (locale-grouped, tabular
// per DESIGN.md §10) instead of a bare `String(value)` — S1.6.6a lead-review
// nit 3. Non-numeric params interpolate as plain strings, unchanged.
function interpolate(template: string, locale: Locale, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'number'
      ? new Intl.NumberFormat(locale).format(value)
      : value;
  });
}

// Pure translate: no React, no I/O — takes the active locale's `Messages`
// plus the key/params and returns the rendered string. `useTranslation()`
// binds this to the active locale for call sites.
export function translate(
  messages: Messages,
  locale: Locale,
  key: TranslationKey,
  params?: TranslateParams,
): string {
  const message = messages[key];

  // Types guarantee every key is present in every locale (Messages =
  // Record<TranslationKey, MessageValue>), but stay defensive at runtime
  // rather than crash the UI on an unexpected gap.
  if (message === undefined) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] missing message for key "${key}" (locale "${locale}")`);
    }
    return key;
  }

  if (!isPluralForms(message)) {
    return interpolate(message, locale, params);
  }

  const count = params?.count;
  if (typeof count !== 'number') {
    if (import.meta.env.DEV) {
      console.warn(
        `[i18n] plural key "${key}" used without a numeric "count" param — falling back to "other"`,
      );
    }
    return interpolate(message.other, locale, params);
  }

  const form = new Intl.PluralRules(locale).select(count);
  const template = message[form] ?? message.other;
  return interpolate(template, locale, params);
}
