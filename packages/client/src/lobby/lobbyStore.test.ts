import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_LOBBY_BOTS, selectLobbySelection, useLobbyStore } from './lobbyStore.js';

// Reset the shared module-level store before each test (mirrors hud/store.test.ts).
beforeEach(() => {
  useLobbyStore.setState({ profileId: 'classic', botCount: 0, started: false });
});

describe('useLobbyStore — initial state', () => {
  it('defaults to classic, zero bots, not started', () => {
    const state = useLobbyStore.getState();
    expect(state.profileId).toBe('classic');
    expect(state.botCount).toBe(0);
    expect(state.started).toBe(false);
  });
});

describe('setProfileId', () => {
  it('replaces the held profileId', () => {
    useLobbyStore.getState().setProfileId('blitz');
    expect(useLobbyStore.getState().profileId).toBe('blitz');
  });
});

describe('setBotCount', () => {
  it('accepts an in-range value', () => {
    useLobbyStore.getState().setBotCount(2);
    expect(useLobbyStore.getState().botCount).toBe(2);
  });

  it('clamps below zero to zero', () => {
    useLobbyStore.getState().setBotCount(-1);
    expect(useLobbyStore.getState().botCount).toBe(0);
  });

  it(`clamps above ${MAX_LOBBY_BOTS} to ${MAX_LOBBY_BOTS} (matches the server's wire-level cap)`, () => {
    useLobbyStore.getState().setBotCount(99);
    expect(useLobbyStore.getState().botCount).toBe(MAX_LOBBY_BOTS);
  });
});

describe('start', () => {
  it('flips started to true', () => {
    useLobbyStore.getState().start();
    expect(useLobbyStore.getState().started).toBe(true);
  });
});

describe('selectLobbySelection', () => {
  it('builds one bot entry per botCount, all at the fixed default difficulty (bot difficulty tuning is out of scope for S2.5.4)', () => {
    useLobbyStore.setState({ profileId: 'balanced', botCount: 2, started: false });
    const selection = selectLobbySelection(useLobbyStore.getState());
    expect(selection.profileId).toBe('balanced');
    expect(selection.bots).toEqual([{ difficulty: 'medium' }, { difficulty: 'medium' }]);
  });

  it('produces an empty bots array at botCount:0', () => {
    const selection = selectLobbySelection(useLobbyStore.getState());
    expect(selection.bots).toEqual([]);
  });
});
