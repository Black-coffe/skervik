// S2.2.5 — the fixed set of rule profiles the balance-sim sweep measures.
// Every id here already exists in `@skervik/core`'s `PROFILE_REGISTRY`
// (shipping presets + the S2.1.5-S2.2.4 internal `*_TEST_PROFILE_ID`
// measurement ids, grouped since S2.2.5 as `EXPERIMENTAL_PROFILE_IDS`). This
// module adds NO profile, changes NO preset — it only names which existing
// ids the sweep runs and what each one isolates (for the report header).
import { EXPERIMENTAL_PROFILE_IDS } from '@skervik/core';

/** One row of the sweep set — resolves via `loadRuleProfile(id)`. */
export interface ProfileSweepSpec {
  /** The registry key `loadRuleProfile` resolves — a shipping id or an `EXPERIMENTAL_PROFILE_IDS` value. */
  readonly id: string;
  /** Report column label. */
  readonly label: string;
  /** What this profile isolates vs. Classic (documents the delta being measured). */
  readonly isolates: string;
}

/**
 * The twelve profiles to sweep (story table): the ten of the original S2.2.5
 * set plus the two `vp9` measurement fixtures added for H3 (`f05605e`).
 * `twoPlayer` is DELIBERATELY excluded — it needs `neutralSettlements` phantom
 * placement, a different player count, and a different genesis path (out of
 * scope, Law 3).
 */
export const SWEEP_PROFILES: readonly ProfileSweepSpec[] = [
  { id: 'classic', label: 'classic', isolates: 'baseline' },
  { id: 'balanced', label: 'balanced', isolates: "randomness: 'balanced_deck'" },
  {
    id: 'blitz',
    label: 'blitz',
    isolates: 'vpToWin: 8 (timers are inert in the sim — Constraint 5)',
  },
  {
    id: EXPERIMENTAL_PROFILE_IDS.friendlyRobber,
    label: 'friendlyRobberTest',
    isolates: 'catchUp: friendlyRobber',
  },
  {
    id: EXPERIMENTAL_PROFILE_IDS.robinHood,
    label: 'robinHoodTest',
    isolates: 'catchUp: robinHood',
  },
  {
    id: EXPERIMENTAL_PROFILE_IDS.finalRound,
    label: 'finalRoundTest',
    isolates: 'catchUp: finalRound',
  },
  {
    id: EXPERIMENTAL_PROFILE_IDS.hiddenVp,
    label: 'hiddenVpTest',
    isolates: 'catchUp: hiddenVp',
  },
  {
    id: EXPERIMENTAL_PROFILE_IDS.finalRoundHiddenVp,
    label: 'finalRoundHiddenVpTest',
    isolates: 'catchUp: finalRound + hiddenVp',
  },
  {
    id: EXPERIMENTAL_PROFILE_IDS.eventTiles,
    label: 'eventTilesTest',
    isolates:
      'catchUp: eventTiles (interval 2 — test profile, NOT the preset interval 3)',
  },
  {
    id: EXPERIMENTAL_PROFILE_IDS.eventTilesRobinHood,
    label: 'eventTilesRobinHoodTest',
    isolates: 'catchUp: eventTiles + robinHood (interval 2)',
  },
  {
    id: EXPERIMENTAL_PROFILE_IDS.vp9,
    label: '__vp9_test__',
    isolates: 'victory.vpToWin: 9 (S2.2.5 H3 measurement profile)',
  },
  {
    id: EXPERIMENTAL_PROFILE_IDS.balancedVp9,
    label: '__balanced_vp9_test__',
    isolates:
      "randomness: 'balanced_deck' + victory.vpToWin: 9 (S2.2.5 H3 candidate preset)",
  },
];
