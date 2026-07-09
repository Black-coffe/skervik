// S2.2.5 — pure metric helpers for the balance-sim sweep. No RNG, no
// wall-clock: every function here is a deterministic fold over an already-
// simulated match's `events` + `finalState`.
import {
  computePublicVictoryPoints,
  type GameEvent,
  type GameState,
  type PlayerId,
  reduce,
} from '@skervik/core';

/** Rebuilds the pre-genesis lobby `GameState` a persisted event log folds onto, reading only `events[0]`. */
function genesisStateFromEvents(events: readonly GameEvent[]): GameState {
  const first = events[0];
  const matchId = first?.type === 'match.started' ? first.matchId : 'unknown';
  const seedHash = first?.type === 'match.started' ? first.seedHash : 'unknown-seed-hash';
  return {
    matchId,
    phase: 'lobby',
    turn: 0,
    currentPlayerId: '',
    players: [],
    eventIndex: 0,
    seedHash,
  };
}

/**
 * S2.2.5a — the SENSITIVITY metric's anchor, retained only as a robustness
 * check against {@link anchorSnapshot}. PUBLIC VP per player at the match's
 * "midpoint": the state the FIRST time `GameState.turn` (the real per-turn
 * counter `reduce.ts` advances on `turn.ended`, distinct from
 * `SimResult.turns`'s applied-step count) reaches `ceil(finalState.turn / 2)`.
 *
 * This anchor is ENDOGENOUS — half the *realized* match length, a quantity the
 * outcome itself determines — which is precisely why S2.2.5's primary metric
 * built on it was confounded with `vpToWin` (see the story's `## Retraction`).
 * It survives ONLY as the sensitivity outcome, and only with ties DROPPED
 * (see {@link soleLastPlacePlayer}), never with the tie-inclusive
 * {@link lastPlacePlayers} rule that caused the defect.
 *
 * `SimResult` carries no per-turn snapshots (and this story must not add any),
 * so this folds the persisted `events` a SECOND time via core's `reduce` —
 * cheap for an already-completed log. Never reads hidden VP.
 */
export function midpointPublicVp(
  events: readonly GameEvent[],
  finalState: GameState,
  playerIds: readonly PlayerId[],
): ReadonlyMap<PlayerId, number> {
  const target = Math.ceil(finalState.turn / 2);
  let state = genesisStateFromEvents(events);
  for (const event of events) {
    state = reduce(state, event);
    if (state.turn >= target) break;
  }
  const vp = new Map<PlayerId, number>();
  for (const id of playerIds) {
    vp.set(id, computePublicVictoryPoints(state, id));
  }
  return vp;
}

/**
 * Players tied for LAST place by the supplied VP map.
 *
 * @deprecated S2.2.5a — this is the DEFECTIVE rule, kept ONLY so the forcing
 * test in `metrics.test.ts` can demonstrate the defect it caused, and so the
 * sensitivity outcome can count the ties it drops. It must never again feed a
 * comeback numerator: it returns EVERY player tied at the minimum, so a
 * four-way tie makes any winner a "comeback" (probability 1) in a match with
 * no leader to come back from — and because a lower `vpToWin` shortens the
 * match, moves the midpoint earlier and compresses midpoint VPs, it ENLARGES
 * the tie set, so the metric moved with the treatment. Use
 * {@link trailingPlayers} against {@link anchorSnapshot}.
 */
export function lastPlacePlayers(
  vp: ReadonlyMap<PlayerId, number>,
  playerIds: readonly PlayerId[],
): readonly PlayerId[] {
  const values = playerIds.map((id) => vp.get(id) ?? 0);
  const min = Math.min(...values);
  return playerIds.filter((id) => (vp.get(id) ?? 0) === min);
}

/**
 * The UNIQUE last-place player, or `null` when two or more players tie at the
 * minimum. The sensitivity outcome's denominator drops the `null`s (and counts
 * how many it dropped) rather than crediting a tie to every tied player.
 */
export function soleLastPlacePlayer(
  vp: ReadonlyMap<PlayerId, number>,
  playerIds: readonly PlayerId[],
): PlayerId | null {
  const min = Math.min(...playerIds.map((id) => vp.get(id) ?? 0));
  const atMin = playerIds.filter((id) => (vp.get(id) ?? 0) === min);
  return atMin.length === 1 ? (atMin[0] ?? null) : null;
}

/**
 * S2.2.5a — the two VP-threshold-relative cuts that make the corrected
 * comeback metric INVARIANT to the treatment variable (`vpToWin`). Both scale
 * with `V`, so neither moves when `V` moves.
 *
 * - `anchorVp = ceil(V/2)` — the leader's public VP that DEFINES the anchor
 *   turn `T*` (exogenous: a fixed point in the *race*, not in realized time).
 * - `deficitThreshold = ceil(V/4)` — how far behind the leader a player must
 *   be at `T*` to count as trailing.
 */
export interface AnchorThresholds {
  readonly anchorVp: number;
  readonly deficitThreshold: number;
}

export function anchorThresholds(vpToWin: number): AnchorThresholds {
  return {
    anchorVp: Math.ceil(vpToWin / 2),
    deficitThreshold: Math.ceil(vpToWin / 4),
  };
}

/**
 * Players trailing by a STRICT deficit: `leaderVp - publicVp(p) >=
 * deficitThreshold`. Unlike {@link lastPlacePlayers}, a tie is not a numerator
 * — when everyone is level the result is EMPTY, because nobody is behind.
 */
export function trailingPlayers(
  vp: ReadonlyMap<PlayerId, number>,
  playerIds: readonly PlayerId[],
  deficitThreshold: number,
): readonly PlayerId[] {
  const leaderVp = Math.max(...playerIds.map((id) => vp.get(id) ?? 0));
  return playerIds.filter((id) => leaderVp - (vp.get(id) ?? 0) >= deficitThreshold);
}

/**
 * Event types that can change a player's PUBLIC VP — the only points at which
 * the leader's standing needs recomputing while folding a log. Keeping this
 * set tight (rather than recomputing after every event) is what makes the
 * 5000-seed re-run affordable; it is a superset of `reduce.ts`'s public-VP
 * mutation sites (`settlements`/`cities` maps + the two award holders).
 */
const VP_RELEVANT_EVENTS: ReadonlySet<GameEvent['type']> = new Set([
  'settlement.placed',
  'settlement.built',
  'city.built',
  'award.longestRoad',
  'award.largestArmy',
]);

/** The public-VP standing at the anchor turn `T*`, plus the trailing set derived from it. */
export interface AnchorSnapshot {
  /** `T*` — the first `GameState.turn` at which the LEADER's public VP reaches `ceil(V/2)`. */
  readonly turn: number;
  readonly leaderVp: number;
  readonly vp: ReadonlyMap<PlayerId, number>;
  /** Players at least `ceil(V/4)` public VP behind the leader at `T*`. Empty when all are level. */
  readonly trailing: readonly PlayerId[];
}

/**
 * S2.2.5a's PRIMARY metric anchor. Folds `events` until the leading player's
 * public VP first reaches `ceil(vpToWin/2)`, then reports every player's
 * public VP there and the strict-deficit trailing set.
 *
 * The anchor is EXOGENOUS to the outcome: it is a fixed fraction of the *race*
 * (half the VP needed to win), not a fraction of the realized match length. A
 * shorter match under a lower `vpToWin` reaches the anchor at a proportionally
 * equivalent point rather than at a compressed VP distribution — which is the
 * confound that voided S2.2.5's H2/H3.
 *
 * Returns `null` only if the leader never reaches `ceil(vpToWin/2)`, which a
 * *completed* match cannot do (the winner holds `vpToWin >= ceil(vpToWin/2)`
 * public VP unless hidden VP carried them there — a possibility the caller
 * must count rather than silently drop).
 */
export function anchorSnapshot(
  events: readonly GameEvent[],
  playerIds: readonly PlayerId[],
  vpToWin: number,
): AnchorSnapshot | null {
  const { anchorVp, deficitThreshold } = anchorThresholds(vpToWin);
  let state = genesisStateFromEvents(events);
  for (const event of events) {
    state = reduce(state, event);
    if (!VP_RELEVANT_EVENTS.has(event.type)) continue;

    const vp = new Map<PlayerId, number>();
    let leaderVp = 0;
    for (const id of playerIds) {
      const points = computePublicVictoryPoints(state, id);
      vp.set(id, points);
      if (points > leaderVp) leaderVp = points;
    }
    if (leaderVp < anchorVp) continue;

    return {
      turn: state.turn,
      leaderVp,
      vp,
      trailing: trailingPlayers(vp, playerIds, deficitThreshold),
    };
  }
  return null;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Nearest-rank percentile (p in [0,100]) — fine-grained accuracy isn't the point at small N. */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 rational
 * approximation (max error < 7.5e-8) — no external stats library needed for
 * the McNemar p-value / Wilson interval below.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Two-sided p-value for a 1-degree-of-freedom chi-square statistic: a
 * chi-square(1) variate is Z², so `P(chi2_1 > x) = P(|Z| > sqrt(x)) =
 * 2 * (1 - Phi(sqrt(x)))` — what a McNemar continuity-corrected chi-square is
 * tested against.
 *
 * APPROXIMATE, not exact (S2.2.5a / reviewer finding S-1): {@link normalCdf}
 * is the Abramowitz & Stegun 7.1.26 rational fit (|error| < 7.5e-8), so far
 * into the tail this value is float-grid noise — below ~1e-13 the digits mean
 * nothing, and for chi-square ≳ 70 it underflows to exactly 0, which is not a
 * p-value. Never print the raw number below 1e-6; use `report.ts`'s
 * `formatPValue`, which clamps to `"<1e-6"`. The clamp is far above the noise
 * floor and far below any decision threshold, so no verdict depends on it.
 */
export function chiSquarePValue1df(chiSquare: number): number {
  if (chiSquare <= 0) return 1;
  return 2 * (1 - normalCdf(Math.sqrt(chiSquare)));
}

export interface ProportionInterval {
  readonly point: number;
  readonly low: number;
  readonly high: number;
}

/**
 * Wilson score interval for a binomial proportion — preferred over the plain
 * Wald interval (`p ± z*sqrt(p(1-p)/n)`) because it stays inside [0,1] and
 * is more accurate at the modest n / non-central p this sim reports at.
 */
export function wilsonInterval(
  successes: number,
  n: number,
  z = 1.96,
): ProportionInterval {
  if (n === 0) return { point: 0, low: 0, high: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const halfwidth = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    point: p,
    low: Math.max(0, center - halfwidth),
    high: Math.min(1, center + halfwidth),
  };
}
