import {
  ADAPTIVE_CEILING_MINUTES,
  ADAPTIVE_MIN_PLAYERS,
  ADAPTIVE_VP_FLOOR,
  computeAdaptiveDuration,
  loadRuleProfile,
  SHIPPING_PROFILE_IDS,
} from '@skervik/core';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  deriveDurationEstimate,
  deriveLobbyViewState,
  maxBotsForProfile,
  selectDurationEstimate,
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

  it('clamps above the current preset cap to that cap (default preset is classic, cap 3)', () => {
    useLobbyStore.getState().setBotCount(99);
    expect(useLobbyStore.getState().botCount).toBe(maxBotsForProfile('classic'));
  });

  it('[forcing] under the expanded preset (cap 5), accepts up to 5 bots', () => {
    useLobbyStore.getState().setProfileId('expanded');
    useLobbyStore.getState().setBotCount(5);
    expect(useLobbyStore.getState().botCount).toBe(5);
    expect(maxBotsForProfile('expanded')).toBe(5);
  });
});

describe('setProfileId — switch-down clamp (S2.1.7b-05)', () => {
  it('[forcing] switching from expanded (5 bots picked) back to classic clamps botCount down to 3, never sending an invalid selection', () => {
    useLobbyStore.getState().setProfileId('expanded');
    useLobbyStore.getState().setBotCount(5);
    expect(useLobbyStore.getState().botCount).toBe(5);

    useLobbyStore.getState().setProfileId('classic');
    expect(useLobbyStore.getState().profileId).toBe('classic');
    expect(useLobbyStore.getState().botCount).toBe(maxBotsForProfile('classic'));
  });

  it('switching to a preset with a HIGHER cap leaves an in-range botCount untouched', () => {
    useLobbyStore.getState().setBotCount(2);
    useLobbyStore.getState().setProfileId('expanded');
    expect(useLobbyStore.getState().botCount).toBe(2);
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

// --- S2.1.3 wired live (m2-gate-02): the lobby's duration readout -----------
// The lobby calls the SAME core calculator the room applies at genesis, on a
// seat count clamped into the selected profile's [minSeats, maxSeats] — the
// estimate is advisory, genesis truth stays with the room.
describe('selectDurationEstimate — seat clamp + the shared core calculator', () => {
  it('[forcing] a fresh CLASSIC lobby (zero bots = ONE seat) clamps UP to the profile minimum, never calling the estimator below ADAPTIVE_MIN_PLAYERS (it throws out of range rather than clamping)', () => {
    const estimate = selectDurationEstimate({ profileId: 'classic', botCount: 0 });
    expect(estimate.playerCount).toBe(loadRuleProfile('classic').minSeats);
    expect(estimate.playerCount).toBeGreaterThanOrEqual(ADAPTIVE_MIN_PLAYERS);
    expect(estimate.minutes).toBeGreaterThan(0);
  });

  it('[forcing] a GRAND CHART (expanded) lobby with zero bots clamps UP to its 5-seat minimum — the table it will actually seat, not the one person standing in it', () => {
    const estimate = selectDurationEstimate({ profileId: 'expanded', botCount: 0 });
    expect(estimate.playerCount).toBe(5);
  });

  it('a bot pick inside the range is used as-is (1 human + bots)', () => {
    expect(
      selectDurationEstimate({ profileId: 'classic', botCount: 3 }).playerCount,
    ).toBe(4);
    expect(
      selectDurationEstimate({ profileId: 'expanded', botCount: 5 }).playerCount,
    ).toBe(6);
  });

  it('reports the POST-adaptation estimate — the length the room will actually run, not the unadjusted baseline', () => {
    const sixSeat = computeAdaptiveDuration('expanded', 6);
    // The 6-seat expanded table is the one case a shipping preset gets adjusted.
    expect(sixSeat.adjustments).not.toEqual([]);
    expect(sixSeat.estimatedMinutes).toBeLessThan(sixSeat.baselineMinutes);
    expect(selectDurationEstimate({ profileId: 'expanded', botCount: 5 }).minutes).toBe(
      Math.round(sixSeat.estimatedMinutes),
    );
  });

  it('[forcing] every shipping preset × every selectable bot count produces an estimate and never throws — and exactly ONE pick outruns the ceiling: Grand Chart at its full six-seat table', () => {
    const overCeiling: string[] = [];
    for (const profileId of SHIPPING_PROFILE_IDS) {
      for (let botCount = 0; botCount <= maxBotsForProfile(profileId); botCount += 1) {
        const estimate = selectDurationEstimate({ profileId, botCount });
        expect(estimate.minutes).toBeGreaterThan(0);
        if (estimate.exceedsCeiling) {
          overCeiling.push(`${profileId}/${botCount}`);
        } else {
          expect(estimate.minutes).toBeLessThanOrEqual(ADAPTIVE_CEILING_MINUTES);
        }
      }
    }
    // Before m2-gate-06 this list was empty — the calculator kept lowering VP
    // until anything fit, so the warning branch was structurally unreachable
    // from the lobby (lead-review C1/C2). With the floor clamped at 8, the
    // six-seat Grand Chart table is honestly over the hour (67.6 min) and the
    // lobby says so; every other shipping pick still fits. Pinned as an exact
    // list so a future estimator tweak that silently widens or empties the
    // warning set fails here rather than passing quietly.
    expect(overCeiling).toEqual(['expanded/5']);
  });

  it('[forcing] Grand Chart reports the LOWERED victory target at both its table sizes (5 and 6 seats), and every preset that plays its base rules reports none — the disclosure the lobby renders (review C2)', () => {
    expect(selectDurationEstimate({ profileId: 'expanded', botCount: 4 })).toEqual({
      playerCount: 5,
      minutes: 58,
      loweredVpToWin: ADAPTIVE_VP_FLOOR,
      exceedsCeiling: false,
    });
    expect(selectDurationEstimate({ profileId: 'expanded', botCount: 5 })).toEqual({
      playerCount: 6,
      minutes: 68,
      loweredVpToWin: ADAPTIVE_VP_FLOOR,
      exceedsCeiling: true,
    });

    for (const profileId of ['classic', 'balanced', 'blitz', 'twoPlayer'] as const) {
      for (let botCount = 0; botCount <= maxBotsForProfile(profileId); botCount += 1) {
        expect(selectDurationEstimate({ profileId, botCount }).loweredVpToWin).toBeNull();
      }
    }
  });
});

describe('deriveDurationEstimate — the over-ceiling warning branch', () => {
  it('[forcing] a result carrying warningCode "exceeds_ceiling_at_vp_floor" sets exceedsCeiling — forced with a REAL core result at a tight target, not a hand-built fake', () => {
    const result = computeAdaptiveDuration('expanded', 6, 20);
    expect(result.warningCode).toBe('exceeds_ceiling_at_vp_floor');
    expect(result.withinCeiling).toBe(false);

    const estimate = deriveDurationEstimate(result);
    expect(estimate.exceedsCeiling).toBe(true);
    expect(estimate.playerCount).toBe(6);
    expect(estimate.minutes).toBe(Math.round(result.estimatedMinutes));
  });

  it('a result that fits leaves exceedsCeiling false, and an untouched base profile reports no lowered target', () => {
    const estimate = deriveDurationEstimate(computeAdaptiveDuration('classic', 4));
    expect(estimate.exceedsCeiling).toBe(false);
    expect(estimate.loweredVpToWin).toBeNull();
  });

  it('[forcing] loweredVpToWin reads the vpToWin adjustment core reports, not a re-derivation — a forced 20-min target on Classic lands the same value core put in `adjustments`', () => {
    const result = computeAdaptiveDuration('classic', 4, 20);
    expect(result.adjustments).toEqual([
      { knob: 'vpToWin', from: loadRuleProfile('classic').victory.vpToWin, to: 8 },
    ]);
    expect(deriveDurationEstimate(result).loweredVpToWin).toBe(8);
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
