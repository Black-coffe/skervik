import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchGuest } from './guestAuth.js';

/** Stub `globalThis.fetch` for one test; restored in afterEach. */
function stubFetch(impl: () => Promise<Response> | Response): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchGuest', () => {
  it('returns the issued identity on a 200 with a well-formed body', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ guestId: 'g-1', displayName: 'Nemo' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(fetchGuest('http://localhost:2567')).resolves.toEqual({
      guestId: 'g-1',
      displayName: 'Nemo',
    });
  });

  it('POSTs the supplied displayName to /auth/guest', async () => {
    const fetchMock = vi.fn(
      () =>
        new Response(JSON.stringify({ guestId: 'g-2', displayName: 'Aronnax' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchGuest('http://localhost:2567', 'Aronnax');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:2567/auth/guest',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ displayName: 'Aronnax' }),
      }),
    );
  });

  it('returns null on a non-2xx response (falls back to fixture)', async () => {
    stubFetch(() => new Response('{"error":"INVALID_BODY"}', { status: 400 }));
    await expect(fetchGuest('http://localhost:2567')).resolves.toBeNull();
  });

  it('returns null when the server is down (fetch rejects) — never throws', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(fetchGuest('http://localhost:2567')).resolves.toBeNull();
  });

  it('returns null on a malformed (non-identity) body', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ nope: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(fetchGuest('http://localhost:2567')).resolves.toBeNull();
  });
});
