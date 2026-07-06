import { describe, expect, it } from 'vitest';

import {
  generateGuestName,
  InMemoryGuestStore,
  MAX_DISPLAY_NAME_LENGTH,
  sanitizeDisplayName,
} from './guestStore.js';

describe('sanitizeDisplayName', () => {
  it('keeps a normal name unchanged', () => {
    expect(sanitizeDisplayName('Nemo')).toBe('Nemo');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeDisplayName('  Aronnax  ')).toBe('Aronnax');
  });

  it('strips control characters but keeps ordinary spaces', () => {
    // C0 (BEL 0x07) + C1 (0x85) control chars embedded around a real space.
    const withControls = `Ned${String.fromCharCode(0x07)} ${String.fromCharCode(0x85)}Land`;
    expect(sanitizeDisplayName(withControls)).toBe('Ned Land');
  });

  it('clamps to the max length', () => {
    const long = 'x'.repeat(MAX_DISPLAY_NAME_LENGTH + 20);
    expect(sanitizeDisplayName(long)).toHaveLength(MAX_DISPLAY_NAME_LENGTH);
  });

  it('returns null for empty / whitespace-only / control-only input', () => {
    expect(sanitizeDisplayName('')).toBeNull();
    expect(sanitizeDisplayName('   ')).toBeNull();
    expect(sanitizeDisplayName(String.fromCharCode(0x07, 0x00))).toBeNull();
    expect(sanitizeDisplayName(undefined)).toBeNull();
  });
});

describe('generateGuestName', () => {
  it('produces a Guest-XXXX handle', () => {
    expect(generateGuestName()).toMatch(/^Guest-[0-9A-F]{4}$/);
  });
});

describe('InMemoryGuestStore', () => {
  it('issues a valid supplied name plus an opaque id', () => {
    const store = new InMemoryGuestStore();
    const guest = store.issueGuest('Conseil');
    expect(guest.displayName).toBe('Conseil');
    // opaque crypto uuid, not a guessable/sequential id
    expect(guest.guestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(store.size).toBe(1);
  });

  it('falls back to a generated name when none is usable', () => {
    const store = new InMemoryGuestStore();
    expect(store.issueGuest().displayName).toMatch(/^Guest-[0-9A-F]{4}$/);
    expect(store.issueGuest('   ').displayName).toMatch(/^Guest-[0-9A-F]{4}$/);
  });

  it('mints a distinct id per guest', () => {
    const store = new InMemoryGuestStore();
    const a = store.issueGuest('a');
    const b = store.issueGuest('b');
    expect(a.guestId).not.toBe(b.guestId);
    expect(store.size).toBe(2);
  });
});
