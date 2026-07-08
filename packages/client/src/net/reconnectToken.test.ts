import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearReconnectionToken,
  persistReconnectionToken,
  readReconnectionToken,
} from './reconnectToken.js';

/** A minimal in-memory `Storage` — this test runner has no DOM/jsdom. */
class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length(): number {
    return this.#data.size;
  }
  clear(): void {
    this.#data.clear();
  }
  getItem(key: string): string | null {
    return this.#data.has(key) ? (this.#data.get(key) ?? null) : null;
  }
  key(index: number): string | null {
    return Array.from(this.#data.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.#data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#data.set(key, value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reconnectToken — sessionStorage helper', () => {
  it('persists + reads back a token scoped by roomId', () => {
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    persistReconnectionToken('room-1', 'token-abc');
    expect(readReconnectionToken('room-1')).toBe('token-abc');
  });

  it('scopes tokens per roomId — a different room never sees the first token', () => {
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    persistReconnectionToken('room-1', 'token-abc');
    expect(readReconnectionToken('room-2')).toBeNull();
  });

  it('clears a persisted token', () => {
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    persistReconnectionToken('room-1', 'token-abc');
    clearReconnectionToken('room-1');
    expect(readReconnectionToken('room-1')).toBeNull();
  });

  it('degrades to a no-op when sessionStorage is unavailable, never throws', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => persistReconnectionToken('room-1', 'token-abc')).not.toThrow();
    expect(readReconnectionToken('room-1')).toBeNull();
    expect(() => clearReconnectionToken('room-1')).not.toThrow();
  });
});
