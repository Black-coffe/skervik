// @skervik/core — the adaptive-duration calculator (S2.1.3, M2 config platform).
//
// Turns the LOCKED product rule — "60 min is a hard ceiling for synchronous
// online play; the lobby computes the profile from player count × mode to fit
// the target window, and if a config risks exceeding it the engine lowers VP
// / tightens timers and warns in the lobby" (CLAUDE.md · roadmap principle 4)
// — into a real, pure decision function. Given a base mode and a player
// count, it estimates the match length and, if the estimate exceeds the
// ceiling, lowers the ONE lever the engine already honors — `victory.vpToWin`
// (S2.1.1) — step by step until it fits (or a floor is hit).
//
// Only the vpToWin lever is live: the engine has no turn timers (S2.1.4), no
// parallel phases (S2.1.5), and no variable board (S2.1.6) yet, so emitting
// adjustments for those knobs would be dead config (VULYK Law 2). The
// `AdaptiveAdjustment.knob` union grows as those mechanics land.
//
// A pure core helper — it does NOT touch `reduce`/`validate`/`verify`/
// `GameState`/events, so it carries no determinism or fairness risk; Classic/
// Balanced/Blitz play is byte-unchanged. Structured `warningCode` only, never
// a localized string (ADR-0008) — the lobby (S2.5.4) maps codes + numbers to
// RU/UA/EN copy.
//
// Zero runtime deps (ADR-0003): pure data + pure functions.

import { loadRuleProfile, type RuleProfile, type RuleProfileId } from './ruleProfile.js';

/** The ≤60-min synchronous-play ceiling (CLAUDE.md principle 4). */
export const ADAPTIVE_CEILING_MINUTES = 60;

/** Player-count range this calculator supports (matches the lobby's seat range). */
export const ADAPTIVE_MIN_PLAYERS = 2;
export const ADAPTIVE_MAX_PLAYERS = 6;

/**
 * Never recommend a game shorter than this many VP — Blitz already sits at 8;
 * a floor below that would make the "adaptive" recommendation feel punitive
 * rather than helpful. v1 estimate — revisit once real telemetry exists.
 */
export const ADAPTIVE_VP_FLOOR = 5;

/** Fixed overhead: lobby countdown + initial settlement/road placement. v1 estimate. */
const SETUP_MINUTES = 10;

/** Average minutes a single player spends per "turn" of consequence. v1 estimate. */
const PLAYER_TURN_MINUTES = 1;

/** Rounds (full trips around the table) needed per victory point. v1 estimate. */
const ROUNDS_PER_VP = 1.2;

/**
 * Estimates a match's wall-clock length in minutes for `profile` at
 * `playerCount` seats — a documented, TUNABLE v1 heuristic, NOT a simulation
 * (no real match-length telemetry exists yet; that lands with M3 analytics).
 * Monotonically increasing in both `playerCount` and `profile.victory.vpToWin`
 * by construction (every term is a positive product). Pure, deterministic: no
 * wall-clock, no RNG, no deps.
 */
export function estimateMatchMinutes(profile: RuleProfile, playerCount: number): number {
  return (
    SETUP_MINUTES +
    PLAYER_TURN_MINUTES * playerCount * (profile.victory.vpToWin * ROUNDS_PER_VP)
  );
}

/** The only lever this calculator can adjust today (S2.1.4/.5/.6 add more). */
export type AdaptiveWarningCode = 'exceeds_ceiling_at_vp_floor';

/** One lever change the calculator made to fit the ceiling. */
export interface AdaptiveAdjustment {
  readonly knob: 'vpToWin';
  readonly from: number;
  readonly to: number;
}

/** The calculator's structured, i18n-safe result — the lobby localizes `warningCode`. */
export interface AdaptiveDurationResult {
  readonly profileId: RuleProfileId;
  readonly profile: RuleProfile;
  readonly playerCount: number;
  readonly targetMinutes: number;
  /** Estimate for the UNADJUSTED base profile. */
  readonly baselineMinutes: number;
  /** Estimate for the RETURNED profile (equals `baselineMinutes` when unchanged). */
  readonly estimatedMinutes: number;
  readonly withinCeiling: boolean;
  readonly adjustments: readonly AdaptiveAdjustment[];
  /** Set only when even {@link ADAPTIVE_VP_FLOOR} still exceeds `targetMinutes`. */
  readonly warningCode?: AdaptiveWarningCode;
}

/**
 * Resolves `baseProfileId` to a `RuleProfile` sized for `playerCount` so the
 * estimated match length fits `targetMinutes` (default {@link
 * ADAPTIVE_CEILING_MINUTES}). If the base profile already fits, it is
 * returned UNCHANGED (empty `adjustments`). Otherwise `victory.vpToWin` is
 * lowered one point at a time — re-estimating each step — until the estimate
 * fits or {@link ADAPTIVE_VP_FLOOR} is reached; if the floor still doesn't
 * fit, `warningCode: 'exceeds_ceiling_at_vp_floor'` is set and `withinCeiling`
 * is `false` (the lobby notes that timers/parallel phases — S2.1.4/.5 — are
 * needed to fit). Pure, deterministic. Throws a typed error on an
 * out-of-range `playerCount`, mirroring `loadRuleProfile`'s loud-fail rather
 * than silently clamping.
 */
export function computeAdaptiveDuration(
  baseProfileId: RuleProfileId,
  playerCount: number,
  targetMinutes: number = ADAPTIVE_CEILING_MINUTES,
): AdaptiveDurationResult {
  if (playerCount < ADAPTIVE_MIN_PLAYERS || playerCount > ADAPTIVE_MAX_PLAYERS) {
    throw new Error(
      `playerCount out of range [${ADAPTIVE_MIN_PLAYERS}, ${ADAPTIVE_MAX_PLAYERS}]: ${playerCount}`,
    );
  }

  const base = loadRuleProfile(baseProfileId);
  const baselineMinutes = estimateMatchMinutes(base, playerCount);

  if (baselineMinutes <= targetMinutes) {
    return {
      profileId: baseProfileId,
      profile: base,
      playerCount,
      targetMinutes,
      baselineMinutes,
      estimatedMinutes: baselineMinutes,
      withinCeiling: true,
      adjustments: [],
    };
  }

  let vpToWin = base.victory.vpToWin;
  let profile = base;
  let estimatedMinutes = baselineMinutes;

  while (estimatedMinutes > targetMinutes && vpToWin > ADAPTIVE_VP_FLOOR) {
    vpToWin -= 1;
    profile = { ...base, victory: { ...base.victory, vpToWin } };
    estimatedMinutes = estimateMatchMinutes(profile, playerCount);
  }

  const withinCeiling = estimatedMinutes <= targetMinutes;
  const adjustments: readonly AdaptiveAdjustment[] =
    vpToWin === base.victory.vpToWin
      ? []
      : [{ knob: 'vpToWin', from: base.victory.vpToWin, to: vpToWin }];

  return {
    profileId: baseProfileId,
    profile,
    playerCount,
    targetMinutes,
    baselineMinutes,
    estimatedMinutes,
    withinCeiling,
    adjustments,
    ...(withinCeiling ? {} : { warningCode: 'exceeds_ceiling_at_vp_floor' as const }),
  };
}
