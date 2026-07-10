// S2.5.4a — forcing tests for the lobby Start → GameScreen transition.
//
// `main.tsx` has no jsdom to render against (this test runner has none), and
// even if it did, zustand v5's static-render snapshot can never observe a
// `setState()` (see `lobby/lobbyStore.ts`'s `deriveLobbyViewState` docstring)
// — so a "render <App/>, click Start, expect <GameScreen/>" test is a dead
// end. Instead this drives the REAL `startConnection` (exported from
// `main.tsx`) with a mocked `connect`/`fetchGuest`, and asserts the store's
// `started` flag directly — the same observable `<App/>` branches on.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConnect, mockFetchGuest } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockFetchGuest: vi.fn(),
}));

vi.mock('./net/wsClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./net/wsClient.js')>();
  return { ...actual, connect: mockConnect };
});

vi.mock('./net/guestAuth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./net/guestAuth.js')>();
  return { ...actual, fetchGuest: mockFetchGuest };
});

const { startConnection } = await import('./main.js');
const { useLobbyStore } = await import('./lobby/lobbyStore.js');
const { useUiStore } = await import('./hud/store.js');

const FAKE_HANDLE = {
  sessionId: 'session-1',
  roomId: 'room-1',
  sendIntent: () => {},
  disconnect: () => {},
};

beforeEach(() => {
  useLobbyStore.setState({
    profileId: 'classic',
    botCount: 0,
    joinMode: 'quickMatch',
    roomCode: '',
    started: false,
  });
  useUiStore.getState().setConnection(null);
  mockConnect.mockReset();
  mockFetchGuest.mockReset();
  mockFetchGuest.mockResolvedValue(null);
});

describe('startConnection — Start button transition (S2.5.4a)', () => {
  it('[forcing] criterion 1: a Start-initiated connect that resolves a live handle flips started to true', async () => {
    mockConnect.mockResolvedValue(FAKE_HANDLE);
    await startConnection({ profileId: 'classic', bots: [] }, { kind: 'quickMatch' });
    expect(useLobbyStore.getState().started).toBe(true);
  });

  it('[forcing] criterion 2: a Start-initiated connect that resolves null (server down / rejected join) leaves started false', async () => {
    mockConnect.mockResolvedValue(null);
    await startConnection({ profileId: 'classic', bots: [] }, { kind: 'quickMatch' });
    expect(useLobbyStore.getState().started).toBe(false);
    expect(useUiStore.getState().connection).toBeNull();
  });

  it('[forcing] regression guard: a createPrivate Start with a LIVE handle does NOT flip started — the host must stay on LobbyScreen to see the invite link S2.5.3 renders there (deriveLobbyViewState.showInvite)', async () => {
    mockConnect.mockResolvedValue(FAKE_HANDLE);
    await startConnection({ profileId: 'classic', bots: [] }, { kind: 'createPrivate' });
    expect(useLobbyStore.getState().started).toBe(false);
    expect(useUiStore.getState().connection).toEqual(FAKE_HANDLE);
  });

  it('[forcing] regression guard: a joinByCode Start with a LIVE handle does NOT flip started — no live gameState yet, GameScreen would render blank', async () => {
    mockConnect.mockResolvedValue(FAKE_HANDLE);
    await startConnection(
      { profileId: 'classic', bots: [] },
      { kind: 'joinByCode', roomId: 'room-1' },
    );
    expect(useLobbyStore.getState().started).toBe(false);
  });

  it('criterion 3: a resume-style call (no lobbySelection) does not itself flip started, and does not throw when started is already true', async () => {
    mockConnect.mockResolvedValue(FAKE_HANDLE);
    useLobbyStore.getState().start(); // mirrors main.tsx's synchronous resume flip, before startConnection() runs
    await expect(startConnection()).resolves.toBeUndefined();
    expect(useLobbyStore.getState().started).toBe(true);
  });

  it('criterion 3: calling .start() again is a harmless no-op (idempotent)', () => {
    useLobbyStore.getState().start();
    expect(() => useLobbyStore.getState().start()).not.toThrow();
    expect(useLobbyStore.getState().started).toBe(true);
  });
});
