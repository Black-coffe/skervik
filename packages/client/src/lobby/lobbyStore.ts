// Lobby UI-state (S2.5.4) — a SEPARATE zustand slice from `hud/store.ts`'s
// `UiStore`: lobby selections (which preset, how many bots) exist BEFORE a
// room does, so they never belong on `gameState` (which only exists once a
// server assigns one). `App.tsx` renders `<LobbyScreen>` while `started` is
// false and `<GameScreen>` once it flips — either because the human pressed
// Start, or because `main.tsx` detected a resumable match on a cold load and
// skipped the lobby entirely (S2.3.2a resume-first, never re-applying a pick).
import type { RuleProfileId } from '@skervik/core';
import { create } from 'zustand';

import type {
  BotDifficulty,
  JoinMode,
  LobbyJoinFields,
  WsClientHandle,
} from '../net/wsClient.js';

/** Mirrors the server's wire-level cap (`JoinLobbySelectionSchema.bots`, protocol/src/messages.ts) — a 4-seat Classic room around at least one human. */
export const MAX_LOBBY_BOTS = 3;

/**
 * Bot difficulty tuning is explicitly OUT OF SCOPE for this story's UI (only
 * bot COUNT is selectable) — every lobby-filled bot takes this single default.
 */
const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'medium';

/** The lobby's join-mode pick (S2.5.3) — mirrors `JoinMode`'s three kinds, minus the code payload (that lives in `roomCode` below, entered separately). */
export type LobbyJoinModeChoice = 'quickMatch' | 'createPrivate' | 'joinByCode';

export interface LobbyStore {
  readonly profileId: RuleProfileId;
  /** 0..{@link MAX_LOBBY_BOTS} — clamped on every write. */
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

export const useLobbyStore = create<LobbyStore>((set) => ({
  profileId: 'classic',
  botCount: 0,
  joinMode: 'quickMatch',
  roomCode: '',
  started: false,
  setProfileId: (profileId) => set({ profileId }),
  setBotCount: (count) => set({ botCount: Math.max(0, Math.min(MAX_LOBBY_BOTS, count)) }),
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

/** The `connect()` `joinMode` argument for a FRESH join (S2.5.3) — the pasted code is trimmed here, once, at the read boundary. */
export function selectJoinMode(state: LobbyStore): JoinMode {
  if (state.joinMode === 'createPrivate') return { kind: 'createPrivate' };
  if (state.joinMode === 'joinByCode') {
    return { kind: 'joinByCode', roomId: state.roomCode.trim() };
  }
  return { kind: 'quickMatch' };
}

/**
 * Whether a Start-initiated `connect()` attempt should flip the lobby to the
 * game screen (S2.5.4a) — bound to the terminal observable (a live handle),
 * NOT to the click itself: `connect()` never throws, it resolves `null` on
 * any failure (expired resume, rejected join, absent server), and a failed
 * attempt must leave the user on `<LobbyScreen>` rather than a blank
 * `<GameScreen>`. Pure so the decision is directly unit-testable without a
 * React render (mirrors {@link deriveLobbyViewState}).
 */
export function shouldStartAfterConnect(handle: WsClientHandle | null): boolean {
  return handle !== null;
}

export interface LobbyViewState {
  /** Show the rule-preset + bot-count radiogroups (a joiner inherits the host's rules, never picks their own). */
  readonly showRuleSelectors: boolean;
  /** Show the invite code/link section (only once a `createPrivate` join has actually connected). */
  readonly showInvite: boolean;
  /** Disable Start (a `joinByCode` attempt with no code entered can never resolve). */
  readonly startDisabled: boolean;
}

/**
 * Derives `LobbyScreen`'s three conditional sections from store state (S2.5.3)
 * — pure, so the branching is unit-tested WITHOUT a React render. This is
 * deliberate, not incidental: zustand v5's `useStore` feeds
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
): LobbyViewState {
  return {
    showRuleSelectors: state.joinMode !== 'joinByCode',
    showInvite: state.joinMode === 'createPrivate' && connectedRoomId !== null,
    startDisabled: state.joinMode === 'joinByCode' && state.roomCode.trim().length === 0,
  };
}
