// @skervik/core — S2.2.3: the `finalRound` (Splendor-style round-to-end-of-
// circle) + `hiddenVp` (dev-card VP excluded from the win/trigger threshold
// until the final round) catch-up flags. Exercises the win-check `thresholdVp`
// branch and the turn-end terminal branch through the FINAL_ROUND / HIDDEN_VP /
// combined internal test profiles (the S2.1.5/S2.2.1/S2.2.2 liveness-proof
// precedent — both flags stay `false` on every shipping preset). Also proves
// `finalRound:false`+`hiddenVp:false` (Classic et al.) is byte-identical to M1:
// the win check ends the game instantly, no `game.finalRoundStarted` fires, and
// `state.finalRound` never appears.

import { describe, expect, it } from 'vitest';

import { buildTopology, type EdgeId, type VertexId } from './board.js';
import { reduce } from './reduce.js';
import {
  FINAL_ROUND_HIDDEN_VP_TEST_PROFILE_ID,
  FINAL_ROUND_TEST_PROFILE_ID,
  HIDDEN_VP_TEST_PROFILE_ID,
  type RuleProfileId,
} from './ruleProfile.js';
import type {
  GameEndedEvent,
  GameEvent,
  GameFinalRoundStartedEvent,
  GameState,
  PlayerState,
} from './types.js';
import { validate } from './validate.js';

// Final round + hidden VP are DETERMINISTIC (no PRNG) — the seed is passed only
// to satisfy the fixed `validate` signature. No draw happens (build/endTurn).
const SEED = 'skervik-final-round-seed-1';

const FINAL_ROUND = FINAL_ROUND_TEST_PROFILE_ID as RuleProfileId;
const HIDDEN_VP = HIDDEN_VP_TEST_PROFILE_ID as RuleProfileId;
const FINAL_ROUND_HIDDEN_VP = FINAL_ROUND_HIDDEN_VP_TEST_PROFILE_ID as RuleProfileId;

const topology = buildTopology();
const RICH = { timber: 9, clay: 9, fleece: 9, barley: 9, iron: 9 };

function makePlayer(id: string, resources: Record<string, number> = {}): PlayerState {
  return { id, name: id, victoryPoints: 0, resources };
}

/** The edge joining two adjacent vertices (test topology lookup). */
function edgeBetween(a: VertexId, b: VertexId): EdgeId {
  const edge = topology.edges.find(
    (e) => e.vertexIds.includes(a) && e.vertexIds.includes(b),
  );
  if (!edge) throw new Error(`no edge between ${a} and ${b}`);
  return edge.id;
}

function ok(result: ReturnType<typeof validate>): { ok: true; events: GameEvent[] } {
  if (!result.ok) throw new Error(`expected ok result, got ${result.reason}`);
  return result;
}

// A target vertex to build a settlement onto (own road attached), 4 city
// vertices and 1 extra settlement vertex all well clear of it (never adjacent,
// so the distance rule is quiet). player-1 pre-holds 4 cities (8 VP) + 1
// settlement (1 VP) = 9 PUBLIC VP; building the settlement on `target` reaches
// exactly 10 — the crossing under test.
const target = topology.vertices[0] as {
  id: string;
  adjacentVertexIds: readonly string[];
};
const roadEdge = edgeBetween(target.id, target.adjacentVertexIds[0] as VertexId);
const excluded = new Set<string>([target.id, ...target.adjacentVertexIds]);
const clearVertices = topology.vertices
  .filter((v) => !excluded.has(v.id))
  .map((v) => v.id);
const cityVertices = clearVertices.slice(0, 4);
const extraSettlementVertex = clearVertices[4] as string;

/**
 * player-1 at 9 PUBLIC VP (4 cities + 1 settlement), one own road to build a
 * settlement onto `target` (→ 10). 3 seats so a final round has intermediate
 * turns. `devCards`/`profileId`/extra overrides tune each scenario.
 */
function nearWinGenesis(overrides: Partial<GameState> = {}): GameState {
  const cities: Record<string, string> = {};
  for (const vertexId of cityVertices) cities[vertexId] = 'player-1';
  return {
    matchId: 'm-final-round',
    phase: 'main',
    turn: 20,
    currentPlayerId: 'player-1',
    playerOrder: ['player-1', 'player-2', 'player-3'],
    players: [
      makePlayer('player-1', { ...RICH }),
      makePlayer('player-2'),
      makePlayer('player-3'),
    ],
    eventIndex: 80,
    seedHash: 'deadbeef',
    buildings: {
      settlements: { [extraSettlementVertex]: 'player-1' },
      roads: { [roadEdge]: 'player-1' },
      cities,
    },
    ...overrides,
  };
}

/** Build a settlement on `target` (the +1 that reaches 10) for the current player. */
function buildToWin(state: GameState) {
  return validate(
    state,
    {
      type: 'intent.buildSettlement',
      playerId: state.currentPlayerId,
      vertexId: target.id,
    },
    state.currentPlayerId,
    SEED,
  );
}

/** End the current player's turn (phase must be 'main'). */
function endTurn(state: GameState) {
  return validate(
    state,
    { type: 'intent.endTurn', playerId: state.currentPlayerId },
    state.currentPlayerId,
    SEED,
  );
}

describe('finalRound trigger (S2.2.3)', () => {
  it('crossing vpToWin emits game.finalRoundStarted, NOT game.ended; play continues', () => {
    const genesis = nearWinGenesis({ profileId: FINAL_ROUND });
    const result = ok(buildToWin(genesis));

    expect(result.events[0]).toMatchObject({ type: 'settlement.built' });
    const started = result.events.find((e) => e.type === 'game.finalRoundStarted') as
      GameFinalRoundStartedEvent | undefined;
    expect(started).toMatchObject({
      type: 'game.finalRoundStarted',
      triggeredBy: 'player-1',
      triggeredOnTurn: 20,
    });
    expect(result.events.some((e) => e.type === 'game.ended')).toBe(false);

    const next = result.events.reduce(reduce, genesis);
    expect(next.finalRound).toEqual({ triggeredBy: 'player-1', triggeredOnTurn: 20 });
    expect(next.phase).toBe('main'); // NOT 'finished' — the game did not end
  });

  it('a SECOND crossing while the final round is already running emits nothing', () => {
    // player-2 also crosses vpToWin during the final round — no re-trigger, no
    // early end (the round only ends when the turn returns to the trigger).
    const genesis = nearWinGenesis({
      profileId: FINAL_ROUND,
      currentPlayerId: 'player-2',
      finalRound: { triggeredBy: 'player-1', triggeredOnTurn: 20 },
      // player-2 mirrors player-1's 9 public VP, ready to cross to 10.
      buildings: {
        settlements: { [extraSettlementVertex]: 'player-2' },
        roads: { [roadEdge]: 'player-2' },
        cities: Object.fromEntries(cityVertices.map((v) => [v, 'player-2'])),
      },
      players: [
        makePlayer('player-1'),
        makePlayer('player-2', { ...RICH }),
        makePlayer('player-3'),
      ],
    });
    const result = ok(buildToWin(genesis));

    expect(result.events[0]).toMatchObject({ type: 'settlement.built' });
    expect(result.events.some((e) => e.type === 'game.finalRoundStarted')).toBe(false);
    expect(result.events.some((e) => e.type === 'game.ended')).toBe(false);
    expect(result.events).toHaveLength(1); // just the settlement.built
  });
});

describe('finalRound completion → game.ended (S2.2.3)', () => {
  // player-1 has already reached 10 (4 cities + 2 settlements) when the round is
  // running — the trigger crossing happened on a prior turn.
  const cities: Record<string, string> = {};
  for (const vertexId of cityVertices) cities[vertexId] = 'player-1';
  const atThresholdBuildings = {
    settlements: { [extraSettlementVertex]: 'player-1', [target.id]: 'player-1' },
    roads: { [roadEdge]: 'player-1' },
    cities,
  };

  /** Final round already running (triggered by player-1, who sits at 10 full VP). */
  function inFinalRound(overrides: Partial<GameState> = {}): GameState {
    return nearWinGenesis({
      profileId: FINAL_ROUND,
      finalRound: { triggeredBy: 'player-1', triggeredOnTurn: 20 },
      buildings: atThresholdBuildings,
      ...overrides,
    });
  }

  it('does NOT end while an intermediate player still owes their final turn', () => {
    // player-2 ends turn → next is player-3, NOT the trigger player-1 → play on.
    const state = inFinalRound({ currentPlayerId: 'player-2' });
    const result = ok(endTurn(state));
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'turn.ended',
      nextPlayerId: 'player-3',
    });
    expect(result.events.some((e) => e.type === 'game.ended')).toBe(false);
  });

  it('ends precisely when the turn returns to the trigger player; trigger gets no 2nd turn', () => {
    // player-3 (the last seat) ends turn → next WOULD be player-1 (trigger) →
    // game.ended. player-1 never takes a second turn.
    const state = inFinalRound({ currentPlayerId: 'player-3' });
    const result = ok(endTurn(state));

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      type: 'turn.ended',
      playerId: 'player-3',
      nextPlayerId: 'player-1',
    });
    const ended = result.events[1] as GameEndedEvent;
    expect(ended.type).toBe('game.ended');
    // player-1 = highest full VP (10, the only player with buildings here).
    expect(ended.winnerId).toBe('player-1');
    expect(ended.finalStandings['player-1']).toBe(10);

    const finished = result.events.reduce(reduce, state);
    expect(finished.phase).toBe('finished');
  });

  it('a trailing player who OVERTAKES on their final turn wins (winner recomputed at end)', () => {
    // The trigger (player-1) sits at 10 full VP, but player-2 built up to 11
    // full VP during the round. When player-3 (last seat) ends, the winner is
    // recomputed from CURRENT full VP — player-2, not the trigger.
    const cities: Record<string, string> = {};
    for (const vertexId of cityVertices) cities[vertexId] = 'player-1';
    // player-2: 5 buildings worth 11 VP (4 cities = 8 + 3 settlements = 3).
    const p2Cities = clearVertices.slice(5, 9);
    const p2Settlements = clearVertices.slice(9, 12);
    for (const v of p2Cities) cities[v] = 'player-2';
    // player-1 at 10 (4 cities + 2 settlements) — the trigger, now overtaken.
    const settlements: Record<string, string> = {
      [extraSettlementVertex]: 'player-1',
      [target.id]: 'player-1',
    };
    for (const v of p2Settlements) settlements[v] = 'player-2';

    const state = inFinalRound({
      currentPlayerId: 'player-3',
      buildings: { settlements, roads: { [roadEdge]: 'player-1' }, cities },
    });
    const result = ok(endTurn(state));
    const ended = result.events[1] as GameEndedEvent;
    expect(ended.type).toBe('game.ended');
    expect(ended.winnerId).toBe('player-2'); // 11 full VP > player-1's 10
    expect(ended.finalStandings['player-2']).toBe(11);
    expect(ended.finalStandings['player-1']).toBe(10);
  });

  it('tie-break: equal full VP → FEWEST buildings wins', () => {
    // player-1: 10 VP from 4 cities (8) + 2 settlements (2) = 6 buildings.
    // player-2: 10 VP from 5 cities (10) = 5 buildings → fewer, so player-2 wins
    // despite player-1 being the trigger.
    const cities: Record<string, string> = {};
    for (const vertexId of cityVertices) cities[vertexId] = 'player-1';
    const p1SecondSettlement = clearVertices[5] as string;
    const settlements: Record<string, string> = {
      [extraSettlementVertex]: 'player-1',
      [p1SecondSettlement]: 'player-1',
    };
    const p2Cities = clearVertices.slice(6, 11); // 5 cities = 10 VP, 5 buildings
    for (const v of p2Cities) cities[v] = 'player-2';

    const state = inFinalRound({
      currentPlayerId: 'player-3',
      buildings: { settlements, roads: { [roadEdge]: 'player-1' }, cities },
    });
    const result = ok(endTurn(state));
    const ended = result.events[1] as GameEndedEvent;
    expect(ended.finalStandings['player-1']).toBe(10);
    expect(ended.finalStandings['player-2']).toBe(10);
    expect(ended.winnerId).toBe('player-2'); // same VP, fewer buildings
  });

  it('tie-break: equal full VP AND buildings → EARLIEST seat in playerOrder', () => {
    // Both players: 5 cities (10 VP, 5 buildings). player-1 is earlier in
    // playerOrder → wins the final fallback.
    const cities: Record<string, string> = {};
    const p1Cities = clearVertices.slice(0, 5);
    const p2Cities = clearVertices.slice(5, 10);
    for (const v of p1Cities) cities[v] = 'player-1';
    for (const v of p2Cities) cities[v] = 'player-2';

    const state = inFinalRound({
      currentPlayerId: 'player-3',
      buildings: { settlements: {}, roads: {}, cities },
    });
    const result = ok(endTurn(state));
    const ended = result.events[1] as GameEndedEvent;
    expect(ended.finalStandings['player-1']).toBe(10);
    expect(ended.finalStandings['player-2']).toBe(10);
    expect(ended.winnerId).toBe('player-1'); // earliest seat
  });

  it('forced-action no-hang: the forced default (endTurn) stays legal all round and completes it', () => {
    // A timed-out turn during the final round forces `intent.endTurn` (the
    // 'main'-phase default, `forcedAction.ts`). finalRound changes NO per-action
    // legality, so the forced endTurn is never rejected — the intermediate turn
    // validates ok, and the completing turn validates ok AND ends the game
    // (no re-arm watchdog needed, [[turn-timer-forced-action-hang-risk]]).
    const intermediate = inFinalRound({ currentPlayerId: 'player-2' });
    expect(ok(endTurn(intermediate)).events.some((e) => e.type === 'game.ended')).toBe(
      false,
    );

    const completing = inFinalRound({ currentPlayerId: 'player-3' });
    const forced = endTurn(completing);
    expect(forced.ok).toBe(true); // NEVER rejected — no hang
    expect(ok(forced).events.some((e) => e.type === 'game.ended')).toBe(true);
  });
});

describe('hiddenVp threshold (S2.2.3)', () => {
  it('a player at 10 FULL VP but only 8 PUBLIC (2 hidden cards) does NOT cross', () => {
    // 4 cities (8 public) + 2 hidden VP cards (full = 10). Under hiddenVp the
    // threshold reads PUBLIC (8) — building a VP-neutral road must NOT end the
    // game (hidden excluded from the trigger, no leak).
    const cities: Record<string, string> = {};
    for (const vertexId of cityVertices) cities[vertexId] = 'player-1';
    const roadTarget = topology.edges.find(
      (e) =>
        e.id !== roadEdge && e.vertexIds.includes(target.adjacentVertexIds[0] as string),
    );
    if (!roadTarget) throw new Error('fixture bug: no second road edge');
    const genesis = nearWinGenesis({
      profileId: HIDDEN_VP,
      buildings: { settlements: {}, roads: { [roadEdge]: 'player-1' }, cities },
      devCards: { 'player-1': { held: { victoryPoint: 2 }, boughtThisTurn: {} } },
    });
    const result = ok(
      validate(
        genesis,
        { type: 'intent.buildRoad', playerId: 'player-1', edgeId: roadTarget.id },
        'player-1',
        SEED,
      ),
    );
    expect(result.events.some((e) => e.type === 'game.ended')).toBe(false);
    expect(result.events.some((e) => e.type === 'game.finalRoundStarted')).toBe(false);
  });

  it('the same player crossing 10 PUBLIC VP wins instantly; standings reveal full VP', () => {
    // 4 cities (8) + 1 settlement (9 public) + 1 hidden VP card. Build a
    // settlement on target → 10 PUBLIC → instant game.ended (hiddenVp, finalRound
    // OFF). finalStandings reveal FULL VP (10 public + 1 hidden = 11).
    const genesis = nearWinGenesis({
      profileId: HIDDEN_VP,
      devCards: { 'player-1': { held: { victoryPoint: 1 }, boughtThisTurn: {} } },
    });
    const result = ok(buildToWin(genesis));
    const ended = result.events.find((e) => e.type === 'game.ended') as
      GameEndedEvent | undefined;
    expect(ended).toMatchObject({ type: 'game.ended', winnerId: 'player-1' });
    expect(ended?.finalStandings['player-1']).toBe(11); // hidden revealed at the end
  });
});

describe('finalRound + hiddenVp combined (S2.2.3)', () => {
  it('public threshold starts the round; hidden VP revealed decides the winner', () => {
    // player-1 crosses 10 PUBLIC (hidden excluded from the trigger) → the final
    // round starts. player-2 trails on public VP (8) but holds 3 hidden VP cards
    // (full = 11) — after the round completes, the hidden-revealed full VP makes
    // player-2 the winner over the trigger.
    const trigger = nearWinGenesis({ profileId: FINAL_ROUND_HIDDEN_VP });
    const started = ok(buildToWin(trigger));
    expect(started.events.some((e) => e.type === 'game.finalRoundStarted')).toBe(true);
    expect(started.events.some((e) => e.type === 'game.ended')).toBe(false);
    const afterTrigger = started.events.reduce(reduce, trigger);
    expect(afterTrigger.finalRound).toEqual({
      triggeredBy: 'player-1',
      triggeredOnTurn: 20,
    });

    // Now run to completion with player-2 holding a hidden lead. player-2: 4
    // cities (8 public) + 3 hidden VP cards (full = 11) > player-1's 10 full.
    const cities: Record<string, string> = {};
    for (const vertexId of cityVertices) cities[vertexId] = 'player-1';
    const p2Cities = clearVertices.slice(5, 9);
    for (const v of p2Cities) cities[v] = 'player-2';
    const endState: GameState = {
      ...afterTrigger,
      phase: 'main',
      currentPlayerId: 'player-3',
      buildings: {
        settlements: { [extraSettlementVertex]: 'player-1', [target.id]: 'player-1' },
        roads: { [roadEdge]: 'player-1' },
        cities,
      },
      devCards: { 'player-2': { held: { victoryPoint: 3 }, boughtThisTurn: {} } },
    };
    const result = ok(endTurn(endState));
    const ended = result.events[1] as GameEndedEvent;
    expect(ended.type).toBe('game.ended');
    expect(ended.winnerId).toBe('player-2'); // 11 full (8 public + 3 hidden)
    expect(ended.finalStandings['player-2']).toBe(11);
    expect(ended.finalStandings['player-1']).toBe(10);
  });
});

/** Drops `profileId` entirely so the state resolves to Classic (finalRound:false, hiddenVp:false). */
function withoutProfileId(state: GameState): GameState {
  const { profileId: _profileId, ...rest } = state;
  return rest;
}

describe('finalRound:false + hiddenVp:false — byte-identical to M1 (S2.2.3)', () => {
  it('crossing vpToWin ends the game INSTANTLY (winner = acting player), no finalRoundStarted', () => {
    const genesis = withoutProfileId(nearWinGenesis()); // resolves to 'classic'
    const result = ok(buildToWin(genesis));

    expect(result.events.some((e) => e.type === 'game.finalRoundStarted')).toBe(false);
    const ended = result.events.find((e) => e.type === 'game.ended') as
      GameEndedEvent | undefined;
    expect(ended).toMatchObject({ type: 'game.ended', winnerId: 'player-1' });
    expect(ended?.finalStandings['player-1']).toBe(10);

    const finished = result.events.reduce(reduce, genesis);
    expect(finished.phase).toBe('finished');
  });

  it('the endTurn path never writes finalRound and never ends the game', () => {
    const genesis = withoutProfileId(nearWinGenesis());
    const result = ok(endTurn(genesis));
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'turn.ended',
      nextPlayerId: 'player-2',
    });

    const next = result.events.reduce(reduce, genesis);
    expect(next.finalRound).toBeUndefined();
    expect(Object.keys(next)).not.toContain('finalRound');
  });

  it('never mutates input state through the win pipeline, and replays deep-equal', () => {
    const genesis = withoutProfileId(nearWinGenesis());
    const before = JSON.parse(JSON.stringify(genesis)) as GameState;
    const result = ok(buildToWin(genesis));
    const applied = result.events.reduce(reduce, genesis);
    expect(genesis).toEqual(before);
    expect(result.events.reduce(reduce, genesis)).toEqual(applied);
  });
});
