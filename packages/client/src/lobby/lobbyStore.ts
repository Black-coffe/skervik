// Lobby UI-state (S2.5.4) — a SEPARATE zustand slice from `hud/store.ts`'s
// `UiStore`: lobby selections (which preset, how many bots) exist BEFORE a
// room does, so they never belong on `gameState` (which only exists once a
// server assigns one). `App.tsx` renders `<LobbyScreen>` while `started` is
// false and `<GameScreen>` once it flips — either because the human pressed
// Start, or because `main.tsx` detected a resumable match on a cold load and
// skipped the lobby entirely (S2.3.2a resume-first, never re-applying a pick).
import type { RuleProfileId } from '@skervik/core';
import { create } from 'zustand';

import type { BotDifficulty, LobbyJoinFields } from '../net/wsClient.js';

/** Mirrors the server's wire-level cap (`JoinLobbySelectionSchema.bots`, protocol/src/messages.ts) — a 4-seat Classic room around at least one human. */
export const MAX_LOBBY_BOTS = 3;

/**
 * Bot difficulty tuning is explicitly OUT OF SCOPE for this story's UI (only
 * bot COUNT is selectable) — every lobby-filled bot takes this single default.
 */
const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'medium';

export interface LobbyStore {
  readonly profileId: RuleProfileId;
  /** 0..{@link MAX_LOBBY_BOTS} — clamped on every write. */
  readonly botCount: number;
  /** `true` once the lobby's job is done (Start pressed, or a resume skipped it). */
  readonly started: boolean;
  readonly setProfileId: (id: RuleProfileId) => void;
  readonly setBotCount: (count: number) => void;
  readonly start: () => void;
}

export const useLobbyStore = create<LobbyStore>((set) => ({
  profileId: 'classic',
  botCount: 0,
  started: false,
  setProfileId: (profileId) => set({ profileId }),
  setBotCount: (count) => set({ botCount: Math.max(0, Math.min(MAX_LOBBY_BOTS, count)) }),
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
