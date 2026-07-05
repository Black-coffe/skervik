import { describe, expect, it } from 'vitest';

import { TRANSLATION_KEYS } from './keys.js';
import { en } from './locales/en.js';
import { ru } from './locales/ru.js';
import { uk } from './locales/uk.js';

// Runtime companion to the compile-time gate: `Messages = Record<
// TranslationKey, MessageValue>` already makes a missing/extra/typo'd key in
// any locale file a `tsc` error (proven manually in the story report by
// temporarily deleting a key from uk.ts). This test asserts the same
// invariant holds at runtime, so a future refactor that weakens the typing
// (e.g. an `as Messages` cast) is still caught.
describe('locale completeness', () => {
  const locales: Record<string, Record<string, unknown>> = { ru, uk, en };
  const expectedKeys = [...TRANSLATION_KEYS].sort();

  it.each(Object.entries(locales))(
    '%s defines every TranslationKey exactly once',
    (_name, messages) => {
      expect(Object.keys(messages).sort()).toEqual(expectedKeys);
    },
  );
});
