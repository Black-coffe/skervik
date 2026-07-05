import type { Locale } from './locale.js';

export interface Formatters {
  readonly formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  readonly formatDateTime: (
    value: Date | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
}

// Thin wrappers over `Intl.NumberFormat`/`Intl.DateTimeFormat` bound to a
// locale — DESIGN.md §10 (numbers/dates must be locale-correct, not just
// strings).
export function makeFormatters(locale: Locale): Formatters {
  return {
    formatNumber: (value, options) =>
      new Intl.NumberFormat(locale, options).format(value),
    formatDateTime: (value, options) =>
      new Intl.DateTimeFormat(locale, options).format(value),
  };
}
