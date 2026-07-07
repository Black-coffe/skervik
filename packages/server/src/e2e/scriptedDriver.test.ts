// S1.7.2 Phase B — boot-free proof that the scripted driver drives a full
// Classic match to `game.ended` deterministically. This is the FAST logic gate
// (pure core `validate`/`reduce`, no sockets/FS): it pins the fixed seed the
// socket E2E reuses, proves victory is reachable, and cross-checks that the
// collected event log replays to the identical state. If this fails, the socket
// E2E can't pass either — so the driver bug surfaces here, cheaply.
import {
  type BoardGeneratedEvent,
  buildTopology,
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  generateBoard,
  type MatchStartedEvent,
  type PlayerId,
  reduce,
  replay,
  type Seed,
  validate,
} from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { decideAction } from './scriptedDriver.js';

/** The fixed seed the whole E2E pins — reproducible board + rolls (proven to reach 10 VP below). */
export const E2E_SEED: Seed = 'skervik-s1.7.2-e2e-match-seed';

/** The seated players for the E2E (N=3 Classic). Ids are plain here; the socket run uses sessionIds. */
export const E2E_PLAYER_IDS: readonly PlayerId[] = ['alpha', 'bravo', 'charlie'];

/** A safety cap on total applied events — fails loudly if the driver can't terminate. */
const STEP_CAP = 6000;

/** The genesis batch a real `GameRoom` emits on seats-full (match.started + board.generated). */
export function genesisEvents(seed: Seed, playerIds: readonly PlayerId[]): GameEvent[] {
  const matchStarted: MatchStartedEvent = {
    type: 'match.started',
    index: 0,
    matchId: 'e2e-match',
    seedHash: 'e2e-seed-hash', // opaque here; the socket run uses the room's real hash
    playerIds: [...playerIds],
  };
  const layout = generateBoard(seed, buildTopology());
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

export interface SimResult {
  readonly finalState: GameState;
  readonly events: GameEvent[];
  readonly steps: number;
  readonly ended: GameEndedEvent | null;
}

/**
 * Runs the driver to completion in-core: on each step the first seat (players'
 * order) with a non-null {@link decideAction} plays it; the produced events are
 * folded and recorded. Mirrors what the socket run does — the server there just
 * serializes the same intents through its `#queue`. Throws loudly on an
 * unexpected reject (a driver bug) or if the step cap is hit (no termination).
 */
export function simulateMatch(seed: Seed, playerIds: readonly PlayerId[]): SimResult {
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
    throw new Error(`driver did not reach game.ended within ${STEP_CAP} steps`);
  }
  return { finalState: state, events, steps, ended };
}

/** The pre-match lobby `GameState` the genesis batch folds onto (mirrors GameRoom.onCreate). */
export function lobbyState(): GameState {
  return {
    matchId: 'e2e-match',
    phase: 'lobby',
    turn: 0,
    currentPlayerId: '',
    players: [],
    eventIndex: 0,
    seedHash: 'e2e-seed-hash',
  };
}

describe('scripted driver — full Classic match (S1.7.2 Phase B, boot-free)', () => {
  it('drives a complete match to game.ended with a winner at >= 10 VP', () => {
    const { finalState, ended, steps } = simulateMatch(E2E_SEED, E2E_PLAYER_IDS);

    expect(ended).not.toBeNull();
    const winnerId = ended?.winnerId as PlayerId;
    expect(ended?.finalStandings[winnerId]).toBeGreaterThanOrEqual(10);
    expect(finalState.phase).toBe('finished');
    // Sanity: it terminated well within the cap.
    expect(steps).toBeLessThan(STEP_CAP);
  });

  it('exercises at least one trade (the product heart) somewhere in the run', () => {
    const { events } = simulateMatch(E2E_SEED, E2E_PLAYER_IDS);
    expect(events.some((e) => e.type === 'bank.trade')).toBe(true);
  });

  it('is deterministic — the identical run twice yields deep-equal final state', () => {
    const a = simulateMatch(E2E_SEED, E2E_PLAYER_IDS);
    const b = simulateMatch(E2E_SEED, E2E_PLAYER_IDS);
    expect(a.finalState).toEqual(b.finalState);
    expect(a.events).toEqual(b.events);
  });

  it('the collected event log replays to the identical final state', () => {
    const { finalState, events } = simulateMatch(E2E_SEED, E2E_PLAYER_IDS);
    expect(replay(lobbyState(), events)).toEqual(finalState);
  });
});
