import { beforeEach, describe, expect, it } from 'vitest';

import {
  deriveLobbyViewState,
  MAX_LOBBY_BOTS,
  selectJoinMode,
  selectLobbySelection,
  shouldMarkConnected,
  useLobbyStore,
} from './lobbyStore.js';

// Reset the shared module-level store before each test (mirrors hud/store.test.ts).
beforeEach(() => {
  useLobbyStore.setState({
    profileId: 'classic',
    botCount: 0,
    joinMode: 'quickMatch',
    roomCode: '',
    started: false,
  });
});

describe('useLobbyStore — initial state', () => {
  it('defaults to classic, zero bots, quick match, not started', () => {
    const state = useLobbyStore.getState();
    expect(state.profileId).toBe('classic');
    expect(state.botCount).toBe(0);
    expect(state.joinMode).toBe('quickMatch');
    expect(state.roomCode).toBe('');
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

describe('setJoinMode / setRoomCode (S2.5.3)', () => {
  it('replaces the held joinMode', () => {
    useLobbyStore.getState().setJoinMode('createPrivate');
    expect(useLobbyStore.getState().joinMode).toBe('createPrivate');
  });

  it('replaces the held roomCode', () => {
    useLobbyStore.getState().setRoomCode('abc123xyz');
    expect(useLobbyStore.getState().roomCode).toBe('abc123xyz');
  });
});

describe('selectJoinMode (S2.5.3)', () => {
  it('defaults to quickMatch', () => {
    expect(selectJoinMode(useLobbyStore.getState())).toEqual({ kind: 'quickMatch' });
  });

  it('[forcing] createPrivate produces { kind: "createPrivate" } — no roomId leaks in from a stale roomCode', () => {
    useLobbyStore.setState({ joinMode: 'createPrivate', roomCode: 'leftover-code' });
    expect(selectJoinMode(useLobbyStore.getState())).toEqual({ kind: 'createPrivate' });
  });

  it('[forcing] joinByCode carries the trimmed roomCode as roomId', () => {
    useLobbyStore.setState({ joinMode: 'joinByCode', roomCode: '  room-42  ' });
    expect(selectJoinMode(useLobbyStore.getState())).toEqual({
      kind: 'joinByCode',
      roomId: 'room-42',
    });
  });
});

describe('shouldMarkConnected (S2.5.2, replaces S2.5.4a shouldStartAfterConnect) — the connected-flag decision, pure', () => {
  const HANDLE = {
    sessionId: 's1',
    roomId: 'r1',
    sendIntent: () => {},
    startMatch: () => {},
    disconnect: () => {},
  };

  it('[forcing] a live handle returns true — for EVERY join mode now (S2.5.2 unifies the transition; the GameScreen-vs-waiting decision moved to shouldShowGame(phase))', () => {
    expect(shouldMarkConnected(HANDLE)).toBe(true);
  });

  it('[forcing] null (failed connect) returns false — regardless of join mode, the user stays on LobbyScreen', () => {
    expect(shouldMarkConnected(null)).toBe(false);
  });
});

describe('deriveLobbyViewState (S2.5.3) — LobbyScreen conditional sections, pure', () => {
  it('quickMatch (default), not yet connected: shows the rule selectors, no invite, Start enabled, no waiting/start-match sections', () => {
    const view = deriveLobbyViewState({ joinMode: 'quickMatch', roomCode: '' }, null);
    expect(view).toEqual({
      showRuleSelectors: true,
      showInvite: false,
      startDisabled: false,
      showStartMatchButton: false,
      showWaitingForHost: false,
      showWaitingForPlayers: false,
    });
  });

  it('[forcing] joinByCode hides the rule selectors regardless of roomCode', () => {
    const empty = deriveLobbyViewState({ joinMode: 'joinByCode', roomCode: '' }, null);
    const filled = deriveLobbyViewState(
      { joinMode: 'joinByCode', roomCode: 'room-1' },
      null,
    );
    expect(empty.showRuleSelectors).toBe(false);
    expect(filled.showRuleSelectors).toBe(false);
  });

  it('[forcing] joinByCode disables Start while roomCode is empty/whitespace-only, enables it once non-empty', () => {
    expect(
      deriveLobbyViewState({ joinMode: 'joinByCode', roomCode: '' }, null).startDisabled,
    ).toBe(true);
    expect(
      deriveLobbyViewState({ joinMode: 'joinByCode', roomCode: '   ' }, null)
        .startDisabled,
    ).toBe(true);
    expect(
      deriveLobbyViewState({ joinMode: 'joinByCode', roomCode: 'r1' }, null)
        .startDisabled,
    ).toBe(false);
  });

  it('quickMatch/createPrivate never disable Start, regardless of roomCode', () => {
    expect(
      deriveLobbyViewState({ joinMode: 'quickMatch', roomCode: '' }, null).startDisabled,
    ).toBe(false);
    expect(
      deriveLobbyViewState({ joinMode: 'createPrivate', roomCode: '' }, null)
        .startDisabled,
    ).toBe(false);
  });

  it('[forcing] the invite section shows ONLY for createPrivate AND an actual connected roomId — never for quickMatch/joinByCode, never before connecting', () => {
    expect(
      deriveLobbyViewState({ joinMode: 'createPrivate', roomCode: '' }, null).showInvite,
    ).toBe(false); // not yet connected
    expect(
      deriveLobbyViewState({ joinMode: 'createPrivate', roomCode: '' }, 'room-1')
        .showInvite,
    ).toBe(true);
    expect(
      deriveLobbyViewState({ joinMode: 'quickMatch', roomCode: '' }, 'room-1').showInvite,
    ).toBe(false);
    expect(
      deriveLobbyViewState({ joinMode: 'joinByCode', roomCode: '' }, 'room-1').showInvite,
    ).toBe(false);
  });

  // --- S2.5.2: host-only Start / waiting sections -----------------------

  it('[forcing] not connected: none of the host/waiting sections show, regardless of host/private', () => {
    const view = deriveLobbyViewState({ joinMode: 'createPrivate', roomCode: '' }, null, {
      isHost: true,
      isPrivate: true,
    });
    expect(view.showStartMatchButton).toBe(false);
    expect(view.showWaitingForHost).toBe(false);
    expect(view.showWaitingForPlayers).toBe(false);
  });

  it('[forcing] connected host of a private room: shows the Start-match button, nothing else', () => {
    const view = deriveLobbyViewState(
      { joinMode: 'createPrivate', roomCode: '' },
      'room-1',
      { isHost: true, isPrivate: true },
    );
    expect(view.showStartMatchButton).toBe(true);
    expect(view.showWaitingForHost).toBe(false);
    expect(view.showWaitingForPlayers).toBe(false);
  });

  it('[forcing] connected non-host joiner of a private room: shows "waiting for host", never the Start-match button', () => {
    const view = deriveLobbyViewState(
      { joinMode: 'joinByCode', roomCode: 'r1' },
      'room-1',
      { isHost: false, isPrivate: true },
    );
    expect(view.showStartMatchButton).toBe(false);
    expect(view.showWaitingForHost).toBe(true);
    expect(view.showWaitingForPlayers).toBe(false);
  });

  it('[forcing] connected to a non-private (quick match) room: shows "waiting for players" — never the Start-match button, even for the seat-0 "host"', () => {
    const asHost = deriveLobbyViewState(
      { joinMode: 'quickMatch', roomCode: '' },
      'room-1',
      { isHost: true, isPrivate: false },
    );
    expect(asHost.showStartMatchButton).toBe(false);
    expect(asHost.showWaitingForPlayers).toBe(true);

    const asJoiner = deriveLobbyViewState(
      { joinMode: 'quickMatch', roomCode: '' },
      'room-1',
      { isHost: false, isPrivate: false },
    );
    expect(asJoiner.showStartMatchButton).toBe(false);
    expect(asJoiner.showWaitingForPlayers).toBe(true);
  });

  it('omitting the host arg defaults to "not host, not private" (every pre-S2.5.2 call site keeps working)', () => {
    const view = deriveLobbyViewState({ joinMode: 'quickMatch', roomCode: '' }, 'room-1');
    expect(view.showStartMatchButton).toBe(false);
    expect(view.showWaitingForHost).toBe(false);
    expect(view.showWaitingForPlayers).toBe(true);
  });
});
