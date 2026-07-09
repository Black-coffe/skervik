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
 * PUBLIC VP per player at the match's "midpoint" — the state the FIRST time
 * `GameState.turn` (the real per-turn counter `reduce.ts` advances on
 * `turn.ended`, distinct from `SimResult.turns`'s applied-step count) reaches
 * `ceil(finalState.turn / 2)`. `SimResult` carries no per-turn snapshots (and
 * this story must not add any), so this folds the persisted `events` a SECOND
 * time via core's `reduce` — cheap for an already-completed log. Never reads
 * hidden VP (`computePublicVictoryPoints` is the public-VP helper).
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

/** Players tied for LAST place by the supplied VP map (handles ties — story's documented rule). */
export function lastPlacePlayers(
  vp: ReadonlyMap<PlayerId, number>,
  playerIds: readonly PlayerId[],
): readonly PlayerId[] {
  const values = playerIds.map((id) => vp.get(id) ?? 0);
  const min = Math.min(...values);
  return playerIds.filter((id) => (vp.get(id) ?? 0) === min);
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
