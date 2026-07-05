import type { TranslationKey } from './keys.js';

// A message is either a plain string (optionally with `{placeholder}`
// tokens) or a set of CLDR plural forms selected via `Intl.PluralRules`
// (ADR-0010). `other` is the only mandatory form; languages that need
// `one`/`few`/`many`/`zero`/`two` add them explicitly.
export type PluralForms = { other: string } & Partial<
  Record<Intl.LDMLPluralRule, string>
>;

export type MessageValue = string | PluralForms;

// Every locale must supply every key, exactly — this is `Record`, not a
// partial/index-signature map, so a missing OR extra OR typo'd key in any
// one locale file is a `tsc` error. That is the build-time realization of
// ADR-0008's "no string ships in fewer than three languages".
export type Messages = Record<TranslationKey, MessageValue>;

export function isPluralForms(value: MessageValue): value is PluralForms {
  return typeof value === 'object';
}
