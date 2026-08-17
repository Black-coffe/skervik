// Lobby UI-state (S2.5.4) — a SEPARATE zustand slice from `hud/store.ts`'s
// `UiStore`: lobby selections (which preset, how many bots) exist BEFORE a
// room does, so they never belong on `gameState` (which only exists once a
// server assigns one). `App.tsx` renders `<LobbyScreen>` while `started` is
// false and `<GameScreen>` once it flips — either because the human pressed
// Start, or because `main.tsx` detected a resumable match on a cold load and
// skipped the lobby entirely (S2.3.2a resume-first, never re-applying a pick).
import {
  ADAPTIVE_MAX_PLAYERS,
  ADAPTIVE_MIN_PLAYERS,
  type AdaptiveDurationResult,
  computeAdaptiveDuration,
  loadRuleProfile,
  type RuleProfileId,
} from '@skervik/core';
import { create } from 'zustand';

import type {
  BotDifficulty,
  JoinMode,
  LobbyJoinFields,
  WsClientHandle,
} from '../net/wsClient.js';

/**
 * The bot-count ceiling for a given preset (S2.1.7b-05) — one human seat is
 * always reserved, so the cap is `maxSeats - 1` (3 for Classic/Balanced/Blitz,
 * 1 for twoPlayer, 5 for Grand Chart/`expanded`). Replaces the old fixed
 * `MAX_LOBBY_BOTS = 3`, which silently assumed every room was 4-seat Classic.
 */
export function maxBotsForProfile(profileId: RuleProfileId): number {
  return loadRuleProfile(profileId).maxSeats - 1;
}

/**
 * Bot difficulty tuning is explicitly OUT OF SCOPE for this story's UI (only
 * bot COUNT is selectable) — every lobby-filled bot takes this single default.
 */
const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'medium';

/** The lobby's join-mode pick (S2.5.3) — mirrors `JoinMode`'s three kinds, minus the code payload (that lives in `roomCode` below, entered separately). */
export type LobbyJoinModeChoice = 'quickMatch' | 'createPrivate' | 'joinByCode';

export interface LobbyStore {
  readonly profileId: RuleProfileId;
  /** 0..{@link maxBotsForProfile}(profileId) — clamped on every write, including a preset switch that lowers the cap below the current count. */
  readonly botCount: number;
  /** Quick match / create a private room / join an existing one by its code (S2.5.3). */
  readonly joinMode: LobbyJoinModeChoice;
  /** The pasted invite code — only read when `joinMode === 'joinByCode'`. */
  readonly roomCode: string;
  /** `true` once the lobby's job is done (Start pressed, or a resume/invite-link cold load skipped it). */
  readonly started: boolean;
  readonly setProfileId: (id: RuleProfileId) => void;
  readonly setBotCount: (count: number) => void;
  readonly setJoinMode: (mode: LobbyJoinModeChoice) => void;
  readonly setRoomCode: (code: string) => void;
  readonly start: () => void;
}

export const useLobbyStore = create<LobbyStore>((set, get) => ({
  profileId: 'classic',
  botCount: 0,
  joinMode: 'quickMatch',
  roomCode: '',
  started: false,
  // Switching presets re-clamps the held botCount against the NEW cap — a
  // 4-5 bot pick made under Grand Chart must not survive a switch back to
  // Classic (max 3) as a stale, invalid-on-send value.
  setProfileId: (profileId) =>
    set((state) => ({
      profileId,
      botCount: Math.min(state.botCount, maxBotsForProfile(profileId)),
    })),
  setBotCount: (count) =>
    set({ botCount: Math.max(0, Math.min(maxBotsForProfile(get().profileId), count)) }),
  setJoinMode: (joinMode) => set({ joinMode }),
  setRoomCode: (roomCode) => set({ roomCode }),
  start: () => set({ started: true }),
}));

/** The `connect()` `lobby` argument for a FRESH join — `main.tsx`'s Start handler reads this once, never on the resume-first branch. */
export function selectLobbySelection(state: LobbyStore): LobbyJoinFields {
  return {
    profileId: state.profileId,
    bots: Array.from({ length: state.botCount }, () => ({
      difficulty: DEFAULT_BOT_DIFFICULTY,
    })),
  };
}

/**
 * The lobby's advisory match-length readout (S2.1.3 wired live, m2-gate-02) —
 * what `LobbyScreen` renders under the preset/bot selectors.
 */
export interface LobbyDurationEstimate {
  /**
   * The seat count the estimate was computed for — the lobby's own pick
   * (1 human + bots) CLAMPED into the selected profile's `[minSeats, maxSeats]`.
   * Exposed so the display can name the table size it is talking about, and so
   * the clamp itself is directly assertable.
   */
  readonly playerCount: number;
  /** Whole minutes, rounded — the estimate for the profile the room would ACTUALLY run (post-adaptation). */
  readonly minutes: number;
  /** `true` only for `warningCode: 'exceeds_ceiling_at_vp_floor'` — lowering VP to the floor still doesn't fit the ≤60-min ceiling. */
  readonly exceedsCeiling: boolean;
}

/**
 * The seat count the lobby estimate speaks for: one human plus the picked bots,
 * CLAMPED into the selected profile's advertised `[minSeats, maxSeats]` (Queen
 * decision, plan delta 2026-08-17). The estimate is ADVISORY — genesis truth
 * stays with the room, which computes from the real final roster — so a lobby
 * showing "5 captains" for a Grand Chart pick with zero bots is the honest
 * reading: that room seats five before it starts.
 *
 * The clamp is also what keeps `computeAdaptiveDuration` in range: it THROWS
 * outside `[ADAPTIVE_MIN_PLAYERS, ADAPTIVE_MAX_PLAYERS]` rather than clamping,
 * and a fresh Classic lobby (zero bots) is a ONE-seat pick. Both adaptive
 * bounds are folded in explicitly rather than leaned on transitively through
 * `ruleProfile.ts`'s G5 seat-range guard, so a future profile edit can never
 * turn this into a throw inside a render.
 */
function estimateSeatCount(profileId: RuleProfileId, botCount: number): number {
  const { minSeats, maxSeats } = loadRuleProfile(profileId);
  const low = Math.max(minSeats, ADAPTIVE_MIN_PLAYERS);
  const high = Math.min(maxSeats, ADAPTIVE_MAX_PLAYERS);
  return Math.min(high, Math.max(low, botCount + 1));
}

/**
 * Projects a core {@link AdaptiveDurationResult} onto the lobby's readout —
 * pure and separate from the store read below so a test can force the
 * over-ceiling branch with a REAL core result (a tight `targetMinutes`)
 * instead of a hand-built fake. Structured code in, no string out (ADR-0008):
 * the warning's copy lives in the locale files, keyed off `exceedsCeiling`.
 *
 * `estimatedMinutes` — the estimate for the RETURNED profile — is the number
 * shown, not `baselineMinutes`: the room applies the same adjustment at
 * genesis, so the post-adaptation figure is the one the players will live.
 */
export function deriveDurationEstimate(
  result: AdaptiveDurationResult,
): LobbyDurationEstimate {
  return {
    playerCount: result.playerCount,
    minutes: Math.round(result.estimatedMinutes),
    exceedsCeiling: result.warningCode === 'exceeds_ceiling_at_vp_floor',
  };
}

/**
 * The lobby's duration readout for the current preset + bot pick — the SAME
 * core calculator the room runs at genesis (`computeAdaptiveDuration`), never a
 * second estimator (plan Contract).
 */
export function selectDurationEstimate(
  state: Pick<LobbyStore, 'profileId' | 'botCount'>,
): LobbyDurationEstimate {
  return deriveDurationEstimate(
    computeAdaptiveDuration(
      state.profileId,
      estimateSeatCount(state.profileId, state.botCount),
    ),
  );
}

/** The `connect()` `joinMode` argument for a FRESH join (S2.5.3) — the pasted code is trimmed here, once, at the read boundary. */
export function selectJoinMode(state: LobbyStore): JoinMode {
  if (state.joinMode === 'createPrivate') return { kind: 'createPrivate' };
  if (state.joinMode === 'joinByCode') {
    return { kind: 'joinByCode', roomId: state.roomCode.trim() };
  }
  return { kind: 'quickMatch' };
}

/**
 * Whether a Start-initiated `connect()` attempt should mark the lobby
 * "connected" (S2.5.2 — replaces S2.5.4a's `shouldStartAfterConnect`, which
 * narrowed this to quickMatch only). Bound to ONE terminal observable: a live
 * handle (`connect()` never throws; `null` means a failed attempt — expired
 * resume, rejected join, absent server — and must leave the user on
 * `<LobbyScreen>`). Unlike S2.5.4a, this no longer discriminates by join
 * mode: `started` now means "a connection attempt succeeded," for every mode
 * alike — the GameScreen-vs-waiting-view decision moved downstream to
 * `hud/store.ts`'s `shouldShowGame(phase)`, which `App.tsx` combines with
 * this flag. A private room's host/joiner still lands on `<LobbyScreen>`'s
 * connected-but-waiting view (invite link / "Start match" / "waiting for
 * host") for as long as `gameState.phase === 'lobby'` — the SAME guarantee
 * S2.5.4a's narrowing used to provide, by a different, uniform mechanism.
 * Pure so the decision is directly unit-testable without a React render.
 */
export function shouldMarkConnected(handle: WsClientHandle | null): boolean {
  return handle !== null;
}

export interface LobbyViewState {
  /** Show the rule-preset + bot-count radiogroups (a joiner inherits the host's rules, never picks their own). */
  readonly showRuleSelectors: boolean;
  /** Show the invite code/link section (only once a `createPrivate` join has actually connected). */
  readonly showInvite: boolean;
  /** Disable Start (a `joinByCode` attempt with no code entered can never resolve). */
  readonly startDisabled: boolean;
  /**
   * S2.5.2: show the host-only "Start match" trigger — connected, I'm the
   * host (seat 0 / the room's creator), and the room is manual-start
   * (`isPrivate`). Never shown for quick match (it auto-starts).
   */
  readonly showStartMatchButton: boolean;
  /**
   * S2.5.2: connected to a manual-start (private) room, NOT the host —
   * "waiting for the host to start".
   */
  readonly showWaitingForHost: boolean;
  /**
   * S2.5.2: connected to an auto-start room (quick match) that hasn't
   * started yet — "waiting for players", regardless of seat/host.
   */
  readonly showWaitingForPlayers: boolean;
}

/**
 * The S2.5.2 host/manual-start signals `deriveLobbyViewState` needs —
 * `hud/store.ts`'s `isHost`/`isPrivateRoom`, folded from `state.snapshot`
 * (transport-only, never derived from `gameState`). Optional at the call
 * site (defaults to "not connected yet") so every pre-S2.5.2 call site keeps
 * working unmodified.
 */
export interface LobbyHostState {
  readonly isHost: boolean;
  readonly isPrivate: boolean;
}

const NOT_CONNECTED_HOST_STATE: LobbyHostState = { isHost: false, isPrivate: false };

/**
 * Derives `LobbyScreen`'s conditional sections from store state (S2.5.3,
 * extended S2.5.2) — pure, so the branching is unit-tested WITHOUT a React
 * render. This is deliberate, not incidental: zustand v5's `useStore` feeds
 * `useSyncExternalStore` a `getServerSnapshot` backed by `getInitialState()`
 * (`zustand/vanilla.js`), which stays frozen at the store's FIRST snapshot
 * forever — `renderToStaticMarkup` (the ONLY render path this codebase's
 * component tests use, no jsdom) therefore can NEVER observe a `setState()`
 * call made after module load, so testing this branching by mutating the
 * store then rendering the component is a dead end. Extracting it here keeps
 * the logic itself fully forcing-testable (mirrors `hud/trade.ts`'s existing
 * "pure helper, separately tested" split).
 */
export function deriveLobbyViewState(
  state: Pick<LobbyStore, 'joinMode' | 'roomCode'>,
  connectedRoomId: string | null,
  host: LobbyHostState = NOT_CONNECTED_HOST_STATE,
): LobbyViewState {
  const connected = connectedRoomId !== null;
  return {
    showRuleSelectors: state.joinMode !== 'joinByCode',
    showInvite: state.joinMode === 'createPrivate' && connected,
    startDisabled: state.joinMode === 'joinByCode' && state.roomCode.trim().length === 0,
    showStartMatchButton: connected && host.isHost && host.isPrivate,
    showWaitingForHost: connected && !host.isHost && host.isPrivate,
    showWaitingForPlayers: connected && !host.isPrivate,
  };
}
