// m2-gate-01 — the boot-free `blitz` full-match proof. Before this story Blitz
// had only PRESET-RESOLUTION tests (`loadRuleProfile('blitz').victory.vpToWin
// === 8` and friends): they pinned the config VALUE but never proved a real
// match ends on it, so the shipping gate "Classic/Balanced/Blitz all playable +
// seed-verifiable" had no per-profile full-match evidence for Blitz.
//
// Mirrors `twoPlayerMatch.e2e.test.ts` / `expandedMatch.e2e.test.ts` exactly:
// pure core `validate`/`reduce`, no sockets/FS, driven by the SAME deterministic
// `decideAction` (v0) the socket E2E suites use. Boot-free is the pattern
// `twoPlayer` set and it satisfies the gate; the socket path is covered by
// classic + expanded.
//
// DELIBERATELY NO fairness-verify leg here (unlike `balancedMatch.e2e.test.ts`).
// `BLITZ_PROFILE` spreads `CLASSIC_PROFILE` changing only `victory.vpToWin` and
// `timers` — its randomness IS Classic's (`randomness: 'dice'`, the same board,
// dev-deck and roll streams), which `core/src/verify.test.ts` and the Classic
// socket E2E already verify. A Blitz verify test would re-assert the Classic
// recompute under a different label and add no coverage.
//
// The turn timers Blitz also tightens are SERVER-CONSUMED ONLY (the Colyseus
// room arms `this.clock` from them; `reduce`/`validate` never read them), so
// they are out of reach of — and irrelevant to — a boot-free logic proof.
import {
  type BoardGeneratedEvent,
  CLASSIC_PROFILE,
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
} from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { decideAction } from './scriptedDriver.js';

/**
 * A seed the v0 driver drives to a real win under `blitz` in 200 steps, with
 * the winner finishing on EXACTLY 8 VP — the discriminating case this proof
 * needs (a seed whose winner happened to reach 10 would be satisfied by Classic
 * rules too and could not tell the two thresholds apart). Pinned by search, the
 * same practice as `twoPlayerMatch`'s `E2E_SEED`: the driver terminates for
 * MOST seeds but not all (a known driver limitation), so the E2E pins a
 * proven-terminating one rather than relying on every seed.
 */
const SEED: Seed = 'skervik-blitz-2';

/** Four seats — `blitz` inherits Classic's `maxSeats: 4`, so this is a full lobby. */
const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4'];

/** A generous safety cap — the pinned seed finishes in 200 steps under Blitz, 325 under Classic. */
const STEP_CAP = 3000;

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
 * topology resolved from the SAME profile as the board. `blitz` sets no
 * `neutralSettlements`, so (unlike `twoPlayer`) there are no `neutral.placed`
 * events here.
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
 * parameterized by `profileId` so the Classic contrast below runs through the
 * identical driver and differs ONLY in the profile the log carries.
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

describe('blitz — full match under `profileId: "blitz"` (m2-gate-01, boot-free)', () => {
  it("reaches game.ended with a real winner at >= the profile's vpToWin", () => {
    const run = runToWinner(SEED, PLAYER_IDS, 'blitz', 'e2e-blitz');

    expect(run.finalState.phase).toBe('finished');
    expect(run.ended).not.toBeNull();
    expect(run.finalState.players).toHaveLength(PLAYER_IDS.length);
    // The log carries the profile it was played under — so every assertion
    // below is genuinely about Blitz, not a mislabeled Classic run.
    expect(run.finalState.profileId).toBe('blitz');

    const winnerId = run.ended?.winnerId as PlayerId;
    expect(PLAYER_IDS).toContain(winnerId);
    // Read the threshold from the profile, not a literal: this survives a
    // rebalance of `blitz.victory.vpToWin` and still fails if a match ever
    // ends below its own profile's threshold.
    const { vpToWin } = loadRuleProfile('blitz').victory;
    expect(run.ended?.finalStandings[winnerId]).toBeGreaterThanOrEqual(vpToWin);
    expect(run.steps).toBeLessThan(STEP_CAP);
  });

  it("vpToWin 8 is in force — the winner takes the match BELOW Classic's 10-VP threshold", () => {
    const run = runToWinner(SEED, PLAYER_IDS, 'blitz', 'e2e-blitz');
    const winnerId = run.ended?.winnerId as PlayerId;
    const winnerVp = run.ended?.finalStandings[winnerId] as number;

    // Pin the config the rest of this leg reasons about: Blitz's threshold is
    // genuinely lower than Classic's, so "reached 8 but not 10" is a
    // meaningful distinction rather than a coincidence of two equal numbers.
    expect(loadRuleProfile('blitz').victory.vpToWin).toBe(8);
    expect(loadRuleProfile('blitz').victory.vpToWin).toBeLessThan(
      CLASSIC_PROFILE.victory.vpToWin,
    );

    // The discriminating assertion: the match ENDED with its winner short of
    // Classic's 10 VP. Under Classic rules this state would not have been a
    // win at all, so the Classic win condition is demonstrably NOT required
    // here — `vpToWin: 8` is what terminated the game.
    expect(winnerVp).toBeGreaterThanOrEqual(8);
    expect(winnerVp).toBeLessThan(CLASSIC_PROFILE.victory.vpToWin);
  });

  it('the SAME seed and seats under `classic` run LONGER and need the full 10 VP — the only difference is the threshold', () => {
    const blitz = runToWinner(SEED, PLAYER_IDS, 'blitz', 'e2e-blitz');
    const classic = runToWinner(
      SEED,
      PLAYER_IDS,
      'classic',
      'e2e-blitz-classic-contrast',
    );

    const classicWinner = classic.ended?.winnerId as PlayerId;
    expect(classic.finalState.phase).toBe('finished');
    expect(classic.ended?.finalStandings[classicWinner]).toBeGreaterThanOrEqual(
      CLASSIC_PROFILE.victory.vpToWin,
    );

    // Same board, same dice stream, same driver — the Blitz match is strictly
    // shorter because its race ends sooner. This is the differential that a
    // single-profile assertion cannot give: if `vpToWin` ever stopped being
    // read from the profile, both runs would end identically and this fails.
    expect(blitz.steps).toBeLessThan(classic.steps);
  });

  it('is deterministic — the identical seed replays to deep-equal state + events twice', () => {
    const runA = runToWinner(SEED, PLAYER_IDS, 'blitz', 'e2e-blitz');
    const runB = runToWinner(SEED, PLAYER_IDS, 'blitz', 'e2e-blitz');

    // Fixed matchId + fixed playerIds on both sides (no random socket labels
    // here, unlike the multi-client E2E) — a direct deep-equal is the
    // determinism proof, no canonicalization needed.
    expect(runB.finalState).toEqual(runA.finalState);
    expect(runB.events).toEqual(runA.events);
    expect(runB.steps).toBe(runA.steps);
  });

  it('the collected event log replays byte-identically to the final state', () => {
    const run = runToWinner(SEED, PLAYER_IDS, 'blitz', 'e2e-blitz');
    expect(replay(lobbyState('e2e-blitz'), run.events)).toEqual(run.finalState);
  });
});
