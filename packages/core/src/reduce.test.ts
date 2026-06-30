import { describe, expect, it } from 'vitest';

import { reduce, replay } from './reduce.js';
import type { GameEvent, GameState, PlayerState } from './types.js';
import { validate } from './validate.js';

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
    expect(next.eventIndex).toBe(1);
  });

  it('applies dice.rolled: state changes (advances the event-stream index)', () => {
    const event: GameEvent = {
      type: 'dice.rolled',
      index: mainState.eventIndex,
      playerId: alice.id,
      value: 8,
    };

    const next = reduce(mainState, event);

    expect(next).not.toBe(mainState);
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
    expect(next.eventIndex).toBe(mainState.eventIndex + 1);
  });
});

describe('validate', () => {
  it('rejects MALFORMED_INTENT when intent.playerId does not match the acting playerId', () => {
    const result = validate(
      mainState,
      { type: 'intent.endTurn', playerId: alice.id },
      bob.id,
    );

    expect(result).toEqual({ ok: false, reason: 'MALFORMED_INTENT' });
  });

  it('rejects UNKNOWN_PLAYER for a playerId not in the match', () => {
    const result = validate(
      mainState,
      { type: 'intent.endTurn', playerId: 'ghost' },
      'ghost',
    );

    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_PLAYER' });
  });

  it('rejects INVALID_PHASE outside the main phase', () => {
    const setupState: GameState = { ...mainState, phase: 'setup' };

    const result = validate(
      setupState,
      { type: 'intent.rollDice', playerId: alice.id },
      alice.id,
    );

    expect(result).toEqual({ ok: false, reason: 'INVALID_PHASE' });
  });

  it('rejects NOT_YOUR_TURN when acting out of turn order', () => {
    const result = validate(
      mainState,
      { type: 'intent.endTurn', playerId: bob.id },
      bob.id,
    );

    expect(result).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
  });

  it('never throws for an expected rejection', () => {
    expect(() =>
      validate(mainState, { type: 'intent.endTurn', playerId: bob.id }, bob.id),
    ).not.toThrow();
  });

  it('validates intent.rollDice into a deterministic dice.rolled event', () => {
    const result = validate(
      mainState,
      { type: 'intent.rollDice', playerId: alice.id },
      alice.id,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ type: 'dice.rolled', playerId: alice.id });

    // Same state in -> same value out (no ambient randomness, ADR-0003).
    const again = validate(
      mainState,
      { type: 'intent.rollDice', playerId: alice.id },
      alice.id,
    );
    expect(again).toEqual(result);
  });

  it('validates intent.endTurn end-to-end: events apply via reduce and state changes', () => {
    const result = validate(
      mainState,
      { type: 'intent.endTurn', playerId: alice.id },
      alice.id,
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
      { type: 'dice.rolled', index: 1, playerId: alice.id, value: 6 },
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
