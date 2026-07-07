// S2.1.6 — boot-free proof that the 2-PLAYER mode plays a full match to victory
// under the `twoPlayer` profile with NEUTRAL/phantom blockers on the standard
// board. Reuses the S1.7.2 scripted driver (`decideAction`, the same "what a
// client does" logic) — the driver already respects neutral settlements because
// it only emits validate-legal intents (neutral buildings occupy vertices and
// trip the distance rule, exactly as core enforces). This is the FAST logic
// gate (pure core `validate`/`reduce`, no sockets/FS): it proves victory is
// reachable, the log replays byte-identically, the fair-RNG verifier passes
// UNCHANGED (Classic board, non-seed placement), and every neutral EXCLUSION
// holds across a real match (production/robber/trade/VP never credit the
// neutral, which never takes a turn).

import {
  buildTopology,
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  generateBoard,
  loadRuleProfile,
  type MatchStartedEvent,
  NEUTRAL_OWNER_ID,
  neutralPlacementEvents,
  type PlayerId,
  reduce,
  replay,
  type Seed,
  validate,
  verifyMatchRandomness,
} from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { decideAction } from './scriptedDriver.js';

// A fixed seed whose board+rolls the smart-greedy driver drives to a real
// 10-VP win in ~172 steps (chosen by search, the same practice as the S1.7.2
// 3p E2E's `E2E_SEED`: the driver terminates for MOST seeds but not all — a
// known driver limitation, [[e2e-scripted-driver-expansion]] — so the E2E pins
// a proven-terminating one rather than relying on every seed).
const SEED: Seed = 'skervik-2p-10';

/** The two seated players (N=2). */
const PLAYER_IDS: readonly PlayerId[] = ['alpha', 'bravo'];

/** A safety cap — the chosen seed finishes in ~172 steps, well under this. */
const STEP_CAP = 2000;

/** The lobby `GameState` the genesis batch folds onto (mirrors GameRoom.onCreate). */
function lobbyState(): GameState {
  return {
    matchId: 'e2e-2p',
    phase: 'lobby',
    turn: 0,
    currentPlayerId: '',
    players: [],
    eventIndex: 0,
    seedHash: 'e2e-2p-hash',
  };
}

/**
 * The genesis batch a real `twoPlayer` `GameRoom` emits (match.started with the
 * profile + board.generated + the deterministic neutral placements). Mirrors
 * `GameRoom.#startMatch` exactly, so this in-core proof pins the same log the
 * socket path would produce.
 */
function genesisEvents(seed: Seed, playerIds: readonly PlayerId[]): GameEvent[] {
  const profile = loadRuleProfile('twoPlayer');
  const topology = buildTopology();
  const matchStarted: MatchStartedEvent = {
    type: 'match.started',
    index: 0,
    matchId: 'e2e-2p',
    seedHash: 'e2e-2p-hash',
    playerIds: [...playerIds],
    profileId: 'twoPlayer',
  };
  const layout = generateBoard(seed, topology, profile.board);
  const boardGenerated: GameEvent = {
    type: 'board.generated',
    index: 1,
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: layout.robberTileId,
  };
  const neutrals = neutralPlacementEvents(
    layout,
    profile.neutralSettlements ?? 0,
    2,
    topology,
  );
  return [matchStarted, boardGenerated, ...neutrals];
}

interface SimResult {
  readonly finalState: GameState;
  readonly events: GameEvent[];
  readonly steps: number;
  readonly ended: GameEndedEvent | null;
}

function simulate(seed: Seed, playerIds: readonly PlayerId[]): SimResult {
  const genesis = genesisEvents(seed, playerIds);
  let state = genesis.reduce((s, e) => reduce(s, e), lobbyState());
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
    throw new Error(`2p driver did not reach game.ended within ${STEP_CAP} steps`);
  }
  return { finalState: state, events, steps, ended };
}

describe('2-player mode — full match under `twoPlayer` (S2.1.6, boot-free)', () => {
  it('places exactly the profile-configured neutral blockers at genesis', () => {
    const genesis = genesisEvents(SEED, PLAYER_IDS);
    const neutrals = genesis.filter((e) => e.type === 'neutral.placed');
    expect(neutrals).toHaveLength(loadRuleProfile('twoPlayer').neutralSettlements ?? 0);
    // Contiguous indices right after match.started(0) + board.generated(1).
    expect(neutrals.map((e) => e.index)).toEqual([2, 3]);
  });

  it('reaches game.ended with a real winner at >= 10 VP', () => {
    const { finalState, ended, steps } = simulate(SEED, PLAYER_IDS);
    expect(ended).not.toBeNull();
    const winnerId = ended?.winnerId as PlayerId;
    expect(PLAYER_IDS).toContain(winnerId);
    expect(ended?.finalStandings[winnerId]).toBeGreaterThanOrEqual(10);
    expect(finalState.phase).toBe('finished');
    expect(steps).toBeLessThan(STEP_CAP);
  });

  it('is deterministic — the identical run twice yields deep-equal state + log', () => {
    const a = simulate(SEED, PLAYER_IDS);
    const b = simulate(SEED, PLAYER_IDS);
    expect(a.finalState).toEqual(b.finalState);
    expect(a.events).toEqual(b.events);
  });

  it('the collected event log replays byte-identically to the final state', () => {
    const { finalState, events } = simulate(SEED, PLAYER_IDS);
    expect(replay(lobbyState(), events)).toEqual(finalState);
  });

  it('the fair-RNG verifier passes UNCHANGED (Classic board, non-seed placement)', () => {
    const { events } = simulate(SEED, PLAYER_IDS);
    const verdict = verifyMatchRandomness(SEED, events);
    expect(verdict.ok).toBe(true);
    expect(verdict.mismatches).toEqual([]);
  });

  it('excludes the neutral from every per-player tally (turns/production/robber/trade/VP)', () => {
    const { finalState, events } = simulate(SEED, PLAYER_IDS);

    // Turns: the neutral is never a player and never in the seat order.
    expect(finalState.players.map((p) => p.id)).not.toContain(NEUTRAL_OWNER_ID);
    expect(finalState.playerOrder ?? []).not.toContain(NEUTRAL_OWNER_ID);

    // The neutral DOES sit on the board as a blocker (proving it existed, so the
    // exclusions below are meaningful — not vacuously true on an empty board).
    const neutralOnBoard = Object.values(
      finalState.buildings?.settlements ?? {},
    ).includes(NEUTRAL_OWNER_ID);
    expect(neutralOnBoard).toBe(true);

    for (const event of events) {
      // Production: no grant is ever keyed to the neutral owner.
      if (event.type === 'resources.produced') {
        expect(event.grants[NEUTRAL_OWNER_ID]).toBeUndefined();
      }
      // Robber: the neutral is never the victim of a steal.
      if (event.type === 'robber.moved') {
        expect(event.stolenFrom).not.toBe(NEUTRAL_OWNER_ID);
      }
      // Trade: the neutral is never an offer target.
      if (event.type === 'trade.offered') {
        expect(event.targets).not.toContain(NEUTRAL_OWNER_ID);
      }
      // VP: the neutral never appears in the final standings.
      if (event.type === 'game.ended') {
        expect(Object.keys(event.finalStandings)).not.toContain(NEUTRAL_OWNER_ID);
      }
    }
  });
});
