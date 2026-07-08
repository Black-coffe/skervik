import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearCurrentRoomId,
  clearReconnectionToken,
  persistCurrentRoomId,
  persistReconnectionToken,
  readCurrentRoomId,
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

describe('reconnectToken — current-room pointer (S2.3.2a)', () => {
  it('persists + reads back the current roomId', () => {
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    persistCurrentRoomId('room-1');
    expect(readCurrentRoomId()).toBe('room-1');
  });

  it('a later persist overwrites the earlier pointer (one active match per tab)', () => {
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    persistCurrentRoomId('room-1');
    persistCurrentRoomId('room-2');
    expect(readCurrentRoomId()).toBe('room-2');
  });

  it('clears the persisted pointer', () => {
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    persistCurrentRoomId('room-1');
    clearCurrentRoomId();
    expect(readCurrentRoomId()).toBeNull();
  });

  it('degrades to a no-op when sessionStorage is unavailable, never throws', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => persistCurrentRoomId('room-1')).not.toThrow();
    expect(readCurrentRoomId()).toBeNull();
    expect(() => clearCurrentRoomId()).not.toThrow();
  });
});
