// m2-gate-01 — the boot-free `balanced` full-match proof. Before this story
// Balanced had only a LIVENESS probe (`packages/bots/src/sim/liveness.test.ts`,
// "a match runs"); nothing drove it to a real winner, so the shipping gate
// "Classic/Balanced/Blitz all playable + seed-verifiable" had no per-profile
// full-match evidence for Balanced.
//
// Mirrors `twoPlayerMatch.e2e.test.ts` / `expandedMatch.e2e.test.ts` exactly:
// pure core `validate`/`reduce`, no sockets/FS, driven by the SAME deterministic
// `decideAction` (v0) the socket E2E suites use — "what a client does" and "what
// this proof exercises" stay the same seam. Boot-free is the pattern `twoPlayer`
// set and it satisfies the gate; the socket path is covered by classic +
// expanded.
//
// What makes this Balanced-specific rather than a Classic run with a different
// label: Balanced's ONLY divergence from Classic is
// `randomness: 'balanced_deck'` (S2.1.2) — production numbers are drawn WITHOUT
// REPLACEMENT from the 36-outcome 2d6 deck. Two legs below pin that, and both
// would fail if the engine silently fell back to independent 2d6 dice:
//   - the deck leg: every COMPLETE 36-draw cycle in the real match log is a
//     permutation of `BALANCED_ROLL_DECK` (independent dice repeat pairs long
//     before 36 distinct ones accumulate),
//   - the verify leg: `verifyMatchRandomness` recomputes each roll through
//     `drawBalancedRoll` precisely because the folded `state.profileId` resolves
//     to `randomness: 'balanced_deck'`; a log of classic dice under a Balanced
//     profile (or vice versa) is FLAGGED, not accepted.
import {
  BALANCED_ROLL_DECK,
  type BoardGeneratedEvent,
  type DiceRolledEvent,
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  generateBoard,
  loadRuleProfile,
  type MatchStartedEvent,
  type PlayerId,
  reduce,
  replay,
  type RuleProfileId,
  type Seed,
  topologyForRadius,
  validate,
  verifyMatchRandomness,
} from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { decideAction } from './scriptedDriver.js';

/**
 * A seed the v0 driver drives to a real 10-VP win under `balanced` in 280 steps
 * / 88 rolls — enough rolls to contain TWO complete 36-draw deck cycles, which
 * the deck leg below needs (a shorter match would make that assertion vacuous).
 * Pinned by search, the same practice as `twoPlayerMatch`'s `E2E_SEED`: the
 * driver terminates for MOST seeds but not all (a known driver limitation), so
 * the E2E pins a proven-terminating one rather than relying on every seed.
 */
const SEED: Seed = 'skervik-balanced-0';

/** Four seats — `balanced` inherits Classic's `maxSeats: 4`, so this is a full lobby. */
const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4'];

/** A generous safety cap — the pinned seed finishes in 280 steps. */
const STEP_CAP = 3000;

/** The balanced deck's cycle length: the 36 equiprobable 2d6 outcome pairs. */
const DECK_CYCLE = BALANCED_ROLL_DECK.length;

/** The lobby `GameState` the genesis batch folds onto (mirrors `GameRoom.onCreate`). */
function lobbyState(matchId: string): GameState {
  return {
    matchId,
    phase: 'lobby',
    turn: 0,
    currentPlayerId: '',
    players: [],
    eventIndex: 0,
    seedHash: `${matchId}-hash`,
  };
}

/**
 * The genesis batch a real `GameRoom` emits for `profileId` (mirrors
 * `GameRoom.#startMatch`): `match.started` + `board.generated`, with the
 * topology resolved from the SAME profile as the board — never a hardcoded
 * Classic pairing. `balanced` sets no `neutralSettlements`, so (unlike
 * `twoPlayer`) there are no `neutral.placed` events here.
 */
function genesisEvents(
  seed: Seed,
  playerIds: readonly PlayerId[],
  profileId: RuleProfileId,
  matchId: string,
): GameEvent[] {
  const profile = loadRuleProfile(profileId);
  const matchStarted: MatchStartedEvent = {
    type: 'match.started',
    index: 0,
    matchId,
    seedHash: `${matchId}-hash`,
    playerIds: [...playerIds],
    profileId,
  };
  const topology = topologyForRadius(profile.board.radius, profile.board.ports.length);
  const layout = generateBoard(seed, topology, profile.board);
  const boardGenerated: BoardGeneratedEvent = {
    type: 'board.generated',
    index: 1,
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: layout.robberTileId,
  };
  return [matchStarted, boardGenerated];
}

interface RunResult {
  readonly finalState: GameState;
  readonly events: GameEvent[];
  readonly steps: number;
  readonly ended: GameEndedEvent | null;
}

/**
 * Drives a full match to `game.ended` in-process via `decideAction` (v0) +
 * `validate`/`reduce` — the exact pattern `twoPlayerMatch.e2e.test.ts` uses,
 * parameterized by `profileId` so every knob the run exercises comes from the
 * profile the log itself carries.
 */
function runToWinner(
  seed: Seed,
  playerIds: readonly PlayerId[],
  profileId: RuleProfileId,
  matchId: string,
): RunResult {
  const genesis = genesisEvents(seed, playerIds, profileId, matchId);
  let state = genesis.reduce((s, e) => reduce(s, e), lobbyState(matchId));
  const events: GameEvent[] = [...genesis];
  let steps = 0;
  let ended: GameEndedEvent | null = null;

  while (state.phase !== 'finished' && steps < STEP_CAP) {
    let acted = false;
    for (const player of state.players) {
      const intent = decideAction(state, player.id);
      if (!intent) continue;
      const result = validate(state, intent, player.id, seed);
      if (!result.ok) {
        throw new Error(
          `driver produced an ILLEGAL intent (${intent.type} by ${player.id}) ` +
            `rejected ${result.reason} at step ${steps}, phase=${state.phase}`,
        );
      }
      for (const event of result.events) {
        state = reduce(state, event);
        events.push(event);
        if (event.type === 'game.ended') ended = event;
      }
      acted = true;
      steps += 1;
      break;
    }
    if (!acted) {
      throw new Error(
        `driver DEADLOCKED at step ${steps}: no seat has a legal move, phase=${state.phase}`,
      );
    }
  }
  if (state.phase !== 'finished') {
    throw new Error(
      `match did not reach game.ended within ${STEP_CAP} steps (profile=${profileId})`,
    );
  }
  return { finalState: state, events, steps, ended };
}

/** Every `dice.rolled` event in the log, in fold order. */
function diceRolls(events: readonly GameEvent[]): DiceRolledEvent[] {
  return events.filter((e): e is DiceRolledEvent => e.type === 'dice.rolled');
}

describe('balanced — full match under `profileId: "balanced"` (m2-gate-01, boot-free)', () => {
  it("reaches game.ended with a real winner at >= the profile's vpToWin", () => {
    const run = runToWinner(SEED, PLAYER_IDS, 'balanced', 'e2e-balanced');

    expect(run.finalState.phase).toBe('finished');
    expect(run.ended).not.toBeNull();
    expect(run.finalState.players).toHaveLength(PLAYER_IDS.length);
    // The log carries the profile it was played under — so every assertion
    // below is genuinely about Balanced, not a mislabeled Classic run.
    expect(run.finalState.profileId).toBe('balanced');

    const winnerId = run.ended?.winnerId as PlayerId;
    expect(PLAYER_IDS).toContain(winnerId);
    // Read the threshold from the profile, not a literal: this survives a
    // rebalance of `balanced.victory.vpToWin` and still fails if a match ever
    // ends below its own profile's threshold.
    const { vpToWin } = loadRuleProfile('balanced').victory;
    expect(run.ended?.finalStandings[winnerId]).toBeGreaterThanOrEqual(vpToWin);
    expect(run.steps).toBeLessThan(STEP_CAP);
  });

  it('draws production numbers from the balanced deck WITHOUT replacement — every complete 36-draw cycle is a permutation of the deck', () => {
    const run = runToWinner(SEED, PLAYER_IDS, 'balanced', 'e2e-balanced');
    const rolls = diceRolls(run.events);

    // Guard the guard: with fewer than one full cycle the per-cycle assertion
    // below would pass vacuously, so pin that this match really is long enough.
    expect(rolls.length).toBeGreaterThanOrEqual(DECK_CYCLE);

    const canonical = (pair: readonly [number, number]): string =>
      `${pair[0]},${pair[1]}`;
    const wholeDeck = [...BALANCED_ROLL_DECK].map(canonical).sort();

    const completeCycles = Math.floor(rolls.length / DECK_CYCLE);
    for (let cycle = 0; cycle < completeCycles; cycle += 1) {
      const drawn = rolls
        .slice(cycle * DECK_CYCLE, (cycle + 1) * DECK_CYCLE)
        .map((e) => canonical([e.dieA, e.dieB]));
      // Sorted-multiset equality: every one of the 36 `(dieA, dieB)` pairs
      // appears EXACTLY once per cycle. Independent 2d6 dice (Classic) would
      // repeat a pair long before 36 distinct ones accumulate, so this leg is
      // the structural proof that `randomness: 'balanced_deck'` is in force.
      expect([...drawn].sort()).toEqual(wholeDeck);
    }

    // And the faces are internally consistent with the logged totals.
    for (const roll of rolls) {
      expect(roll.total).toBe(roll.dieA + roll.dieB);
    }
  });

  it('is deterministic — the identical seed replays to deep-equal state + events twice', () => {
    const runA = runToWinner(SEED, PLAYER_IDS, 'balanced', 'e2e-balanced');
    const runB = runToWinner(SEED, PLAYER_IDS, 'balanced', 'e2e-balanced');

    // Fixed matchId + fixed playerIds on both sides (no random socket labels
    // here, unlike the multi-client E2E) — a direct deep-equal is the
    // determinism proof, no canonicalization needed.
    expect(runB.finalState).toEqual(runA.finalState);
    expect(runB.events).toEqual(runA.events);
    expect(runB.steps).toBe(runA.steps);
  });

  it('the collected event log replays byte-identically to the final state', () => {
    const run = runToWinner(SEED, PLAYER_IDS, 'balanced', 'e2e-balanced');
    expect(replay(lobbyState('e2e-balanced'), run.events)).toEqual(run.finalState);
  });

  it('verify leg — the balanced log re-verifies clean through the SAME recompute routes/matchVerify.ts uses, and a forged roll is flagged', () => {
    const run = runToWinner(SEED, PLAYER_IDS, 'balanced', 'e2e-balanced');

    // Direction 1: an honest Balanced log verifies clean. This is NOT a smoke
    // test — `verifyMatchRandomness` resolves each roll's recompute from the
    // folded `state.profileId`, so it only passes because the engine drew
    // through `drawBalancedRoll` and the verifier recomputed the same way. A
    // Classic-dice log under a Balanced profile fails here.
    const clean = verifyMatchRandomness(SEED, run.events);
    expect(clean.ok).toBe(true);
    expect(clean.mismatches).toEqual([]);

    // Direction 2: a deliberately forged `dice.rolled` face is FLAGGED — the
    // fairness guarantee, not a liveness check (mirrors `expandedMatch`'s
    // corrupted-board leg).
    const rollIndex = run.events.findIndex((e) => e.type === 'dice.rolled');
    const roll = run.events[rollIndex] as DiceRolledEvent;
    const forgedDieA = roll.dieA === 1 ? 2 : 1;
    const corrupted: GameEvent[] = [...run.events];
    corrupted[rollIndex] = {
      ...roll,
      dieA: forgedDieA,
      total: forgedDieA + roll.dieB,
    };

    const flagged = verifyMatchRandomness(SEED, corrupted);
    expect(flagged.ok).toBe(false);
    expect(
      flagged.mismatches.some((m) => m.type === 'dice.rolled' && m.field === 'dieA'),
    ).toBe(true);
  });
});
