// S2.1.7b-07 — the boot-free 5-6 player `expanded` proof (ADR-0013's "2-6
// players" acceptance evidence). Mirrors `twoPlayerMatch.e2e.test.ts`'s shape
// exactly: pure core `validate`/`reduce`, no sockets/FS, driven by the SAME
// deterministic `decideAction` (v0) the socket E2E suites use — "what a
// client does" and "what this proof exercises" stay the same seam. This is
// the FAST logic gate for the 37-tile radius-3 board: a full 6-seat match
// terminates, replays deterministically alongside a CLASSIC match run in
// between (proving the per-radius topology memo doesn't leak across
// profiles), and its event log re-verifies through the exact recompute
// `routes/matchVerify.ts` uses (`verifyMatchRandomness`, core-side).
import {
  type BoardGeneratedEvent,
  computeAdaptiveDuration,
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  generateBoard,
  loadRuleProfile,
  type MatchStartedEvent,
  type PlayerId,
  reduce,
  type RuleProfileId,
  type Seed,
  topologyForRadius,
  validate,
  verifyMatchRandomness,
} from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { decideAction } from './scriptedDriver.js';

/**
 * The pinned seed story 02 (`packages/bots/src/harness.test.ts`) reports as
 * terminating for a 6-player `expanded` match via `simulateMatch` + the v1
 * `medium` bot brain (winner `p5`, 354 turns). Reused here, driven instead by
 * the SAME `decideAction` (v0) the server's socket E2E suites use — a
 * DIFFERENT brain, so the story's own contingency applies ("reuse the seed
 * story 02 reports if it terminates here too; otherwise pin a new one and say
 * so"): confirmed by a local run, `'grand-chart'` also terminates under v0
 * (a different winner — the brains diverge, the seed still drives a legal,
 * terminating game either way). Re-measured at the adaptive threshold this
 * proof now plays to (m2-gate-08): 230 steps, winner `p2` at 8 VP. See
 * `## Implementation notes` in the story file for the exact run stats.
 */
const SEED: Seed = 'grand-chart';

/**
 * The S1.7.2 socket E2E's own pinned Classic seed (`fullMatch.e2e.test.ts`)
 * — duplicated as a literal, not imported (importing a `*.test.ts` module
 * would re-register its `describe` blocks here). Used ONLY to interleave a
 * real Classic (radius-2) run between the two expanded runs below, proving
 * the per-radius topology memo (`topologyForRadius`) keeps the two boards
 * isolated in the same process.
 */
const CLASSIC_SEED: Seed = 'skervik-s1.7.2-e2e-match-seed';

/** The six seated players for the expanded proof (N=6, the profile's `maxSeats`). */
const SIX_PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

/** The interleaved Classic run's three seats (matches `fullMatch.e2e.test.ts`'s N_SEATS=3). */
const CLASSIC_PLAYER_IDS: readonly PlayerId[] = ['a', 'b', 'c'];

/** A generous safety cap — the 6p expanded run terminates well under this (~230-450 steps observed). */
const STEP_CAP = 3000;

/** The lobby `GameState` a genesis batch folds onto (mirrors `GameRoom.onCreate`). */
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
 * The adaptive victory threshold a real room would fix at genesis for this
 * table, or `undefined` when the profile constant already fits the ceiling —
 * the same verdict `GameRoom.#adaptiveVpToWinOverride` reaches, expressed
 * against the same pure calculator. Kept as a tiny local mirror rather than an
 * import because `#startMatch`'s copy is private to the room; the two are held
 * together by `GameRoom.test.ts`'s genesis legs, which pin the room's own
 * output for every profile this file drives.
 */
function adaptiveOverrideFor(
  profileId: RuleProfileId,
  seatCount: number,
): number | undefined {
  const constant = loadRuleProfile(profileId).victory.vpToWin;
  const adaptive = computeAdaptiveDuration(profileId, seatCount).profile.victory.vpToWin;
  return adaptive === constant ? undefined : adaptive;
}

/**
 * The genesis batch a real `GameRoom` emits for `profileId` (mirrors
 * `GameRoom.#startMatch`): `match.started` + `board.generated`, with the
 * topology resolved from the SAME profile as the board (S2.1.7b D2) — never
 * a hardcoded Classic pairing.
 *
 * `vpToWinOverride` is spread on the SAME conditional terms the room uses
 * (m2-gate-08): absent when the profile constant fits, present otherwise. Until
 * this file computed it, every 6-seat expanded run here played to 10 VP — a
 * configuration production stopped producing the moment S2.1.3 went live at
 * genesis, so the whole proof (termination, determinism, verify) was gated on
 * a match no player can start.
 */
function genesisEvents(
  seed: Seed,
  playerIds: readonly PlayerId[],
  profileId: RuleProfileId,
  matchId: string,
): GameEvent[] {
  const profile = loadRuleProfile(profileId);
  const vpToWinOverride = adaptiveOverrideFor(profileId, playerIds.length);
  const matchStarted: MatchStartedEvent = {
    type: 'match.started',
    index: 0,
    matchId,
    seedHash: `${matchId}-hash`,
    playerIds: [...playerIds],
    profileId,
    ...(vpToWinOverride === undefined ? {} : { vpToWinOverride }),
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
 * generalized over `profileId` so the same driver proves both the expanded
 * board and (for the interleave) a plain Classic match.
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

describe('expanded (5-6p, radius-3) boot-free match — a real winner on the 37-tile board (S2.1.7b-07)', () => {
  it('reaches game.ended with a real winner across all 6 seats on a 37-tile board', () => {
    const run = runToWinner(SEED, SIX_PLAYER_IDS, 'expanded', 'e2e-expanded');

    const boardGenerated = run.events.find((e) => e.type === 'board.generated');
    expect(boardGenerated?.type).toBe('board.generated');
    expect(
      boardGenerated?.type === 'board.generated'
        ? Object.keys(boardGenerated.tileKinds).length
        : -1,
    ).toBe(37); // radius-3 tile count (3*3^2 + 3*3 + 1) — impossible under the pre-fix radius-2/radius-3 mismatch.

    expect(run.finalState.phase).toBe('finished');
    expect(run.ended).not.toBeNull();
    expect(run.finalState.players).toHaveLength(6);
    const winnerId = run.ended?.winnerId as PlayerId;
    expect(SIX_PLAYER_IDS).toContain(winnerId);

    // The overridden path is the one under test (m2-gate-08): a 6-seat expanded
    // genesis carries the adaptive threshold, `reduce` folds it onto the state,
    // and the win check ends the match there — two points below the profile's
    // own 10, which is what this proof used to (wrongly) play to.
    const constant = loadRuleProfile('expanded').victory.vpToWin;
    const vpToWin = computeAdaptiveDuration('expanded', SIX_PLAYER_IDS.length).profile
      .victory.vpToWin;
    expect(vpToWin).toBeLessThan(constant);
    const started = run.events[0] as MatchStartedEvent;
    expect(started.type).toBe('match.started');
    expect(started.vpToWinOverride).toBe(vpToWin);
    expect(run.finalState.vpToWinOverride).toBe(vpToWin);
    expect(run.ended?.finalStandings[winnerId]).toBeGreaterThanOrEqual(vpToWin);
    expect(run.steps).toBeLessThan(STEP_CAP);
  });

  it(
    'is deterministic — the identical seed replays to deep-equal state + events twice, ' +
      'with a Classic match run in between (the per-radius memo does not leak topology either way)',
    () => {
      const runA = runToWinner(SEED, SIX_PLAYER_IDS, 'expanded', 'e2e-expanded');

      // A real Classic (radius-2) match, run BETWEEN the two expanded runs —
      // if `topologyForRadius`'s memo (or any module-level topology) ever
      // leaked state across profiles, either this run or runB below would
      // silently pick up the wrong radius.
      const classicRun = runToWinner(
        CLASSIC_SEED,
        CLASSIC_PLAYER_IDS,
        'classic',
        'e2e-classic',
      );
      const classicBoard = classicRun.events.find((e) => e.type === 'board.generated');
      expect(classicRun.finalState.phase).toBe('finished');
      // The interleaved Classic run stays byte-frozen: 3 seats fit the ceiling,
      // so the conditional spread emits NO override key at all — the same
      // absence a real Classic room produces.
      expect('vpToWinOverride' in (classicRun.events[0] as MatchStartedEvent)).toBe(
        false,
      );
      expect(JSON.stringify(classicRun.events)).not.toContain('vpToWinOverride');
      expect(
        classicBoard?.type === 'board.generated'
          ? Object.keys(classicBoard.tileKinds).length
          : -1,
      ).toBe(19); // Classic stayed radius-2 — not contaminated by the interleaved expanded run.

      const runB = runToWinner(SEED, SIX_PLAYER_IDS, 'expanded', 'e2e-expanded');
      const boardB = runB.events.find((e) => e.type === 'board.generated');
      expect(
        boardB?.type === 'board.generated' ? Object.keys(boardB.tileKinds).length : -1,
      ).toBe(37); // runB stayed radius-3 — not contaminated by the interleaved Classic run.

      // Fixed matchId + fixed playerIds on both sides (no random socket
      // labels here, unlike the multi-client E2E) — a direct deep-equal is
      // the determinism proof, no canonicalization needed.
      expect(runB.finalState).toEqual(runA.finalState);
      expect(runB.events).toEqual(runA.events);
      expect(runB.steps).toBe(runA.steps);
    },
  );

  it(
    'verify leg — the expanded log re-verifies clean through the SAME recompute ' +
      'routes/matchVerify.ts uses, and a corrupted layout is flagged',
    () => {
      const run = runToWinner(SEED, SIX_PLAYER_IDS, 'expanded', 'e2e-expanded');

      // Direction 1: an honest expanded log verifies clean — the same
      // `verifyMatchRandomness(seed, events)` call `matchVerify.ts` makes,
      // which resolves `board.generated`'s recompute from `state.profileId`
      // (`loadRuleProfile('expanded').board`), never a hardcoded Classic board.
      const clean = verifyMatchRandomness(SEED, run.events);
      expect(clean.ok).toBe(true);
      expect(clean.mismatches).toEqual([]);

      // Direction 2: a deliberately corrupted expanded `board.generated` (the
      // robber's starting tile relabeled to a DIFFERENT real radius-3 tile) is
      // FLAGGED — the fairness guarantee, not a smoke test (mirrors core's own
      // S2.1.7a board-leg proof, `verify.test.ts`).
      const profile = loadRuleProfile('expanded');
      const topology = topologyForRadius(
        profile.board.radius,
        profile.board.ports.length,
      );
      const boardIndex = run.events.findIndex((e) => e.type === 'board.generated');
      const board = run.events[boardIndex] as BoardGeneratedEvent;
      const corrupted: GameEvent[] = [...run.events];
      corrupted[boardIndex] = {
        ...board,
        robberTileId: topology.tiles.find((t) => t.id !== board.robberTileId)!.id,
      };

      const flagged = verifyMatchRandomness(SEED, corrupted);
      expect(flagged.ok).toBe(false);
      expect(
        flagged.mismatches.some(
          (m) => m.type === 'board.generated' && m.field === 'robberTileId',
        ),
      ).toBe(true);
    },
  );
});
