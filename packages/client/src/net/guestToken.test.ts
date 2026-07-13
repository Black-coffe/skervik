// S2.6.2a — durable guest session-token persistence (localStorage).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearGuestToken, persistGuestToken, readGuestToken } from './guestToken.js';

/** A minimal in-memory localStorage stand-in (the node test env has none). */
function fakeLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe('guestToken persistence (S2.6.2a)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('with localStorage available', () => {
    beforeEach(() => {
      vi.stubGlobal('localStorage', fakeLocalStorage());
    });

    it('round-trips a persisted token', () => {
      expect(readGuestToken()).toBeNull();
      persistGuestToken('header.payload.sig');
      expect(readGuestToken()).toBe('header.payload.sig');
    });

    it('clears a persisted token', () => {
      persistGuestToken('header.payload.sig');
      clearGuestToken();
      expect(readGuestToken()).toBeNull();
    });
  });

  describe('without localStorage (bare test runner / disabled storage)', () => {
    it('degrades to no-ops instead of throwing', () => {
      // No stub — `localStorage` is undefined in this node env.
      expect(typeof localStorage).toBe('undefined');
      expect(() => persistGuestToken('x')).not.toThrow();
      expect(readGuestToken()).toBeNull();
      expect(() => clearGuestToken()).not.toThrow();
    });
  });
});
