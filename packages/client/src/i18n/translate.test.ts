import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { en } from './locales/en.js';
import { ru } from './locales/ru.js';
import { uk } from './locales/uk.js';
import { translate } from './translate.js';

describe('translate — plain strings', () => {
  it('returns the plain message unchanged when there is nothing to interpolate', () => {
    expect(translate(ru, 'ru', 'common.cancel')).toBe('Отмена');
    expect(translate(en, 'en', 'common.cancel')).toBe('Cancel');
  });

  it('interpolates {placeholder} tokens from params', () => {
    // hud.resourceCards doubles as the interpolation fixture via {count}.
    expect(translate(en, 'en', 'hud.resourceCards', { count: 1 })).toBe('1 card');
  });

  it('leaves an unmatched placeholder token untouched', () => {
    expect(translate(en, 'en', 'common.cancel', { unused: 'x' })).toBe('Cancel');
  });
});

describe('translate — plurals (Intl.PluralRules)', () => {
  it('selects correct RU forms for 1 / 2 / 5', () => {
    expect(translate(ru, 'ru', 'hud.resourceCards', { count: 1 })).toBe('1 карта');
    expect(translate(ru, 'ru', 'hud.resourceCards', { count: 2 })).toBe('2 карты');
    expect(translate(ru, 'ru', 'hud.resourceCards', { count: 5 })).toBe('5 карт');
  });

  it('selects correct UK forms for 1 / 2 / 5', () => {
    expect(translate(uk, 'uk', 'hud.resourceCards', { count: 1 })).toBe('1 картка');
    expect(translate(uk, 'uk', 'hud.resourceCards', { count: 2 })).toBe('2 картки');
    expect(translate(uk, 'uk', 'hud.resourceCards', { count: 5 })).toBe('5 карток');
  });

  it('selects correct EN forms for 1 / other', () => {
    expect(translate(en, 'en', 'hud.resourceCards', { count: 1 })).toBe('1 card');
    expect(translate(en, 'en', 'hud.resourceCards', { count: 2 })).toBe('2 cards');
    expect(translate(en, 'en', 'hud.resourceCards', { count: 5 })).toBe('5 cards');
  });

  it('distinguishes RU/UK one|few|many at boundary values (11 vs 21)', () => {
    // 11 -> many (карт/карток), 21 -> one (карта/картка) — classic Slavic trap.
    expect(translate(ru, 'ru', 'hud.resourceCards', { count: 11 })).toBe('11 карт');
    expect(translate(ru, 'ru', 'hud.resourceCards', { count: 21 })).toBe('21 карта');
    expect(translate(uk, 'uk', 'hud.resourceCards', { count: 11 })).toBe('11 карток');
    expect(translate(uk, 'uk', 'hud.resourceCards', { count: 21 })).toBe('21 картка');
  });
});

describe('translate — missing count on a plural key', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to the "other" form and dev-warns instead of throwing', () => {
    expect(() => translate(ru, 'ru', 'hud.resourceCards')).not.toThrow();
    expect(translate(ru, 'ru', 'hud.resourceCards')).toBe('{count} карты');
    expect(console.warn).toHaveBeenCalled();
  });
});
