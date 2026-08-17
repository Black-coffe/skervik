import { describe, expect, it } from 'vitest';

import { buildTopology } from './board.js';
import { reduce, replay } from './reduce.js';
import { gameplayStreamIndex, rollDie } from './rng.js';
import type { GameEvent, GameState, PlayerState } from './types.js';
import { validate } from './validate.js';

// A match's secret PRNG seed (revealed post-match). Passed into `validate`
// rather than stored in GameState — see the `validate` docstring / A1.
const SEED = 'skervik-golden-seed-3';

const alice: PlayerState = {
  id: 'player-1',
  name: 'Alice',
  victoryPoints: 0,
  resources: { timber: 1, ore: 0 },
};

const bob: PlayerState = {
  id: 'player-2',
  name: 'Bob',
  victoryPoints: 0,
  resources: { timber: 0, ore: 1 },
};

const lobbyState: GameState = {
  matchId: 'match-1',
  phase: 'lobby',
  turn: 0,
  currentPlayerId: alice.id,
  players: [],
  eventIndex: 0,
  seedHash: 'deadbeef',
};

const mainState: GameState = {
  matchId: 'match-1',
  phase: 'main',
  turn: 1,
  currentPlayerId: alice.id,
  players: [alice, bob],
  eventIndex: 5,
  seedHash: 'deadbeef',
};

const setupState: GameState = {
  matchId: 'match-1',
  phase: 'setup',
  turn: 1,
  currentPlayerId: alice.id,
  players: [alice, bob],
  eventIndex: 5,
  seedHash: 'deadbeef',
};

// S1.2.4: rollDice is only legal from 'roll' — `mainState` above now
// represents the post-roll main phase, so `intent.rollDice` tests need this
// dedicated fixture instead.
const rollState: GameState = { ...mainState, phase: 'roll' };

describe('reduce', () => {
  it('never mutates its input state', () => {
    const before: GameState = JSON.parse(JSON.stringify(mainState)) as GameState;
    const event: GameEvent = {
      type: 'turn.ended',
      index: mainState.eventIndex,
      playerId: alice.id,
      nextPlayerId: bob.id,
    };

    reduce(mainState, event);

    expect(mainState).toEqual(before);
  });

  it('applies match.started: initializes players and advances to setup', () => {
    const event: GameEvent = {
      type: 'match.started',
      index: 0,
      matchId: 'match-2',
      seedHash: 'cafebabe',
      playerIds: [alice.id, bob.id],
    };

    const next = reduce(lobbyState, event);

    expect(next).not.toBe(lobbyState);
    expect(next.phase).toBe('setup');
    expect(next.matchId).toBe('match-2');
    expect(next.seedHash).toBe('cafebabe');
    expect(next.currentPlayerId).toBe(alice.id);
    expect(next.players.map((p) => p.id)).toEqual([alice.id, bob.id]);
    // S1.2.4: the fixed seat order is set from the same `playerIds`.
    expect(next.playerOrder).toEqual([alice.id, bob.id]);
    expect(next.eventIndex).toBe(1);
  });

  it('applies dice.rolled: state changes (advances the event-stream index)', () => {
    const event: GameEvent = {
      type: 'dice.rolled',
      index: mainState.eventIndex,
      playerId: alice.id,
      dieA: 5,
      dieB: 3,
      total: 8,
    };

    const next = reduce(mainState, event);

    expect(next).not.toBe(mainState);
    expect(next.eventIndex).toBe(mainState.eventIndex + 1);
  });

  it('applies resources.produced: grants land on players, bank is the new fact, index advances', () => {
    const event: GameEvent = {
      type: 'resources.produced',
      index: mainState.eventIndex,
      grants: { [alice.id]: { ore: 2 } },
      bank: { ore: 17 },
    };

    const next = reduce(mainState, event);

    expect(next).not.toBe(mainState);
    expect(next.players.find((p) => p.id === alice.id)?.resources).toEqual({
      timber: 1,
      ore: 2,
    });
    expect(next.players.find((p) => p.id === bob.id)?.resources).toEqual(bob.resources);
    expect(next.bank).toEqual({ ore: 17 });
    expect(next.eventIndex).toBe(mainState.eventIndex + 1);
  });

  it('applies turn.ended: advances currentPlayerId and turn', () => {
    const event: GameEvent = {
      type: 'turn.ended',
      index: mainState.eventIndex,
      playerId: alice.id,
      nextPlayerId: bob.id,
    };

    const next = reduce(mainState, event);

    expect(next.currentPlayerId).toBe(bob.id);
    expect(next.turn).toBe(mainState.turn + 1);
    // S1.2.4: the next player's turn always starts in 'roll'.
    expect(next.phase).toBe('roll');
    expect(next.eventIndex).toBe(mainState.eventIndex + 1);
  });

  it('applies settlement.placed: records the building, sets pendingRoadVertexId, grants the payout', () => {
    const event: GameEvent = {
      type: 'settlement.placed',
      index: setupState.eventIndex,
      playerId: alice.id,
      vertexId: 'vertex-1',
      payout: { timber: 2 },
    };

    const next = reduce(setupState, event);

    expect(next).not.toBe(setupState);
    expect(next.buildings?.settlements).toEqual({ 'vertex-1': alice.id });
    expect(next.pendingRoadVertexId).toBe('vertex-1');
    expect(next.players.find((p) => p.id === alice.id)?.resources).toEqual({
      timber: 3,
      ore: 0,
    });
    expect(next.eventIndex).toBe(setupState.eventIndex + 1);
  });

  it('applies road.placed: records the road, clears pendingRoadVertexId, advances turn/phase', () => {
    const midTurnState: GameState = {
      ...setupState,
      buildings: { settlements: { 'vertex-1': alice.id }, roads: {} },
      pendingRoadVertexId: 'vertex-1',
    };
    const event: GameEvent = {
      type: 'road.placed',
      index: midTurnState.eventIndex,
      playerId: alice.id,
      edgeId: 'edge-1',
      nextPlayerId: bob.id,
      nextPhase: 'setup',
    };

    const next = reduce(midTurnState, event);

    expect(next).not.toBe(midTurnState);
    expect(next.buildings?.roads).toEqual({ 'edge-1': alice.id });
    expect(next.pendingRoadVertexId).toBeUndefined();
    expect('pendingRoadVertexId' in next).toBe(false);
    expect(next.currentPlayerId).toBe(bob.id);
    expect(next.phase).toBe('setup');
    expect(next.eventIndex).toBe(midTurnState.eventIndex + 1);
  });

  it('never mutates its input state for settlement.placed/road.placed', () => {
    const beforeSettlement: GameState = JSON.parse(
      JSON.stringify(setupState),
    ) as GameState;
    reduce(setupState, {
      type: 'settlement.placed',
      index: setupState.eventIndex,
      playerId: alice.id,
      vertexId: 'vertex-1',
      payout: { timber: 1 },
    });
    expect(setupState).toEqual(beforeSettlement);

    const midTurnState: GameState = {
      ...setupState,
      buildings: { settlements: { 'vertex-1': alice.id }, roads: {} },
      pendingRoadVertexId: 'vertex-1',
    };
    const beforeRoad: GameState = JSON.parse(JSON.stringify(midTurnState)) as GameState;
    reduce(midTurnState, {
      type: 'road.placed',
      index: midTurnState.eventIndex,
      playerId: alice.id,
      edgeId: 'edge-1',
      nextPlayerId: bob.id,
      nextPhase: 'setup',
    });
    expect(midTurnState).toEqual(beforeRoad);
  });
});

describe('validate', () => {
  it('rejects MALFORMED_INTENT when intent.playerId does not match the acting playerId', () => {
    const result = validate(
      mainState,
      { type: 'intent.endTurn', playerId: alice.id },
      bob.id,
      SEED,
    );

    expect(result).toEqual({ ok: false, reason: 'MALFORMED_INTENT' });
  });

  it('rejects UNKNOWN_PLAYER for a playerId not in the match', () => {
    const result = validate(
      mainState,
      { type: 'intent.endTurn', playerId: 'ghost' },
      'ghost',
      SEED,
    );

    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_PLAYER' });
  });

  it('rejects INVALID_PHASE for rollDice outside setup/roll/main entirely', () => {
    const setupState: GameState = { ...mainState, phase: 'setup' };

    const result = validate(
      setupState,
      { type: 'intent.rollDice', playerId: alice.id },
      alice.id,
      SEED,
    );

    expect(result).toEqual({ ok: false, reason: 'INVALID_PHASE' });
  });

  it('rejects NOT_YOUR_TURN when acting out of turn order', () => {
    const result = validate(
      mainState,
      { type: 'intent.endTurn', playerId: bob.id },
      bob.id,
      SEED,
    );

    expect(result).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
  });

  it('never throws for an expected rejection', () => {
    expect(() =>
      validate(mainState, { type: 'intent.endTurn', playerId: bob.id }, bob.id, SEED),
    ).not.toThrow();
  });

  it('validates intent.rollDice into a fair-RNG dice.rolled (+ resources.produced) event', () => {
    // S1.2.4: rollDice is only legal from 'roll' — `rollState`, not `mainState`.
    const result = validate(
      rollState,
      { type: 'intent.rollDice', playerId: alice.id },
      alice.id,
      SEED,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    // SEED @ rollState.eventIndex resolves to a non-7 total, so both
    // `dice.rolled` and `resources.produced` are emitted (S1.2.1 scheme).
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      type: 'dice.rolled',
      playerId: alice.id,
      index: rollState.eventIndex,
    });
    expect(result.events[1]).toMatchObject({
      type: 'resources.produced',
      index: rollState.eventIndex + 1,
      grants: {}, // rollState has no board/buildings — nothing to produce from
    });

    // Provably-fair: each die is exactly what an auditor recomputes from the
    // revealed seed + gameplay stream index (A1 acceptance, S1.2.1 scheme).
    const dieA = rollDie(SEED, gameplayStreamIndex(rollState.eventIndex, 0));
    const dieB = rollDie(SEED, gameplayStreamIndex(rollState.eventIndex, 1));
    expect(result.events[0]).toMatchObject({ dieA, dieB, total: dieA + dieB });

    // Same (state, seed) in -> same events out (no ambient randomness, ADR-0003).
    const again = validate(
      rollState,
      { type: 'intent.rollDice', playerId: alice.id },
      alice.id,
      SEED,
    );
    expect(again).toEqual(result);

    // A different seed derives its own draw from the same stream index — the
    // roll actually depends on the seed now, not on a state-only placeholder.
    // This seed happens to resolve to a 7 at this eventIndex, exercising the
    // no-production seam: only `dice.rolled` is emitted (TODO(S1.3.1)).
    const otherSeed = validate(
      rollState,
      { type: 'intent.rollDice', playerId: alice.id },
      alice.id,
      'skervik-golden-seed-1',
    );
    expect(otherSeed.ok).toBe(true);
    if (!otherSeed.ok) throw new Error('expected ok result');
    expect(otherSeed.events).toHaveLength(1);
    expect(otherSeed.events[0]).toMatchObject({
      dieA: rollDie(
        'skervik-golden-seed-1',
        gameplayStreamIndex(rollState.eventIndex, 0),
      ),
      dieB: rollDie(
        'skervik-golden-seed-1',
        gameplayStreamIndex(rollState.eventIndex, 1),
      ),
      total: 7,
    });
  });

  it('validates intent.endTurn end-to-end: events apply via reduce and state changes', () => {
    const result = validate(
      mainState,
      { type: 'intent.endTurn', playerId: alice.id },
      alice.id,
      SEED,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const next = result.events.reduce(reduce, mainState);

    expect(next.currentPlayerId).toBe(bob.id);
    expect(next.turn).toBe(mainState.turn + 1);
    expect(next).not.toBe(mainState);
  });
});

describe('replay', () => {
  it('folds an event log into the same state as applying reduce manually', () => {
    const events: GameEvent[] = [
      {
        type: 'match.started',
        index: 0,
        matchId: 'match-3',
        seedHash: 'feedface',
        playerIds: [alice.id, bob.id],
      },
      { type: 'dice.rolled', index: 1, playerId: alice.id, dieA: 2, dieB: 4, total: 6 },
      { type: 'turn.ended', index: 2, playerId: alice.id, nextPlayerId: bob.id },
    ];

    const replayed = replay(lobbyState, events);
    const manual = events.reduce(reduce, lobbyState);

    expect(replayed).toEqual(manual);
    expect(replayed.currentPlayerId).toBe(bob.id);
    expect(replayed.turn).toBe(2);
    expect(replayed.eventIndex).toBe(3);
  });

  it('does not mutate the initial state', () => {
    const before: GameState = JSON.parse(JSON.stringify(lobbyState)) as GameState;
    const events: GameEvent[] = [
      {
        type: 'match.started',
        index: 0,
        matchId: 'match-4',
        seedHash: 'feedface',
        playerIds: [alice.id],
      },
    ];

    replay(lobbyState, events);

    expect(lobbyState).toEqual(before);
  });
});

// m2-gate-05 (S2.1.3): `match.started` carries an OPTIONAL per-match victory
// threshold. The fold matters because the log is the only source of truth —
// an override that vanished here would be silently lost on replay, and the
// verifier would resolve a different threshold than the live match used.
describe('match.started folds the per-match vpToWinOverride (S2.1.3)', () => {
  function genesis(vpToWinOverride?: number): GameEvent[] {
    return [
      {
        type: 'match.started',
        index: 0,
        matchId: 'match-5',
        seedHash: 'feedface',
        playerIds: [alice.id, bob.id],
        ...(vpToWinOverride !== undefined ? { vpToWinOverride } : {}),
      },
    ];
  }

  it('carries an event-set override into state, and replay matches the manual fold', () => {
    const events = genesis(6);
    const replayed = replay(lobbyState, events);

    expect(replayed.vpToWinOverride).toBe(6);
    expect(replayed).toEqual(events.reduce(reduce, lobbyState));
  });

  it('a match.started WITHOUT the override leaves the key absent (frozen bytes)', () => {
    const replayed = replay(lobbyState, genesis());

    expect('vpToWinOverride' in replayed).toBe(false);
    expect(JSON.stringify(replayed)).not.toContain('vpToWinOverride');
  });

  it('the folded override is the LIVE threshold: replay ends a match Classic would not', () => {
    // A 7-VP position (3 cities + 1 settlement) one city-upgrade from 8 VP —
    // the same shape `ruleProfile.test.ts` uses for the profile-level branch.
    const topology = buildTopology();
    const [cityA, cityB, cityC, settlementVertex] = topology.vertices
      .slice(0, 4)
      .map((v) => v.id) as [string, string, string, string];
    const rich = { timber: 9, clay: 9, fleece: 9, barley: 9, iron: 9 };
    const nearWin = (state: GameState): GameState => ({
      ...state,
      phase: 'main',
      turn: 12,
      currentPlayerId: alice.id,
      players: state.players.map((p) => ({ ...p, resources: { ...rich } })),
      buildings: {
        settlements: { [settlementVertex]: alice.id },
        roads: {},
        cities: { [cityA]: alice.id, [cityB]: alice.id, [cityC]: alice.id },
      },
    });
    const upgradeToEight = {
      type: 'intent.buildCity' as const,
      playerId: alice.id,
      vertexId: settlementVertex,
    };

    // Replayed WITH the override (6): the 8th VP ends the match.
    const overridden = nearWin(replay(lobbyState, genesis(6)));
    const ended = validate(overridden, upgradeToEight, alice.id, SEED);
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.events.some((e) => e.type === 'game.ended')).toBe(true);

    // Replayed WITHOUT it: the profile constant (10) still governs.
    const plain = nearWin(replay(lobbyState, genesis()));
    const open = validate(plain, upgradeToEight, alice.id, SEED);
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.events.some((e) => e.type === 'game.ended')).toBe(false);
  });
});
