import { describe, expect, it } from 'vitest';

import type {
  DiceRolledEvent,
  EndTurnIntent,
  GameEvent,
  GameState,
  MatchStartedEvent,
  PlayerIntent,
  PlayerState,
  RejectReason,
  RollDiceIntent,
  TurnEndedEvent,
} from './types.js';

const player: PlayerState = {
  id: 'player-1',
  name: 'Wayfarer',
  victoryPoints: 0,
  resources: { timber: 1, ore: 0 },
};

const state: GameState = {
  matchId: 'match-1',
  phase: 'lobby',
  turn: 0,
  currentPlayerId: player.id,
  players: [player],
  eventIndex: 0,
  seedHash: 'deadbeef',
};

describe('GameState', () => {
  it('is a plain object that round-trips through JSON unchanged', () => {
    const roundTripped = JSON.parse(JSON.stringify(state)) as GameState;
    expect(roundTripped).toEqual(state);
  });

  it('carries no functions or class instances (event-sourceable, deep-comparable)', () => {
    expect(state.constructor).toBe(Object);
    for (const value of Object.values(state)) {
      expect(typeof value).not.toBe('function');
    }
  });
});

describe('GameEvent', () => {
  const events: GameEvent[] = [
    {
      type: 'match.started',
      index: 0,
      matchId: 'match-1',
      seedHash: 'deadbeef',
      playerIds: ['player-1'],
    },
    { type: 'dice.rolled', index: 1, playerId: 'player-1', value: 8 },
    { type: 'turn.ended', index: 2, playerId: 'player-1', nextPlayerId: 'player-2' },
  ];

  it('discriminates on `type` and narrows exhaustively per variant', () => {
    for (const event of events) {
      switch (event.type) {
        case 'match.started': {
          const e: MatchStartedEvent = event;
          expect(e.playerIds).toContain('player-1');
          break;
        }
        case 'dice.rolled': {
          const e: DiceRolledEvent = event;
          expect(e.value).toBe(8);
          break;
        }
        case 'turn.ended': {
          const e: TurnEndedEvent = event;
          expect(e.nextPlayerId).toBe('player-2');
          break;
        }
        default: {
          const exhaustive: never = event;
          throw new Error(`unhandled event type: ${JSON.stringify(exhaustive)}`);
        }
      }
    }
  });

  it('serializes plainly — events are data, not ambient state', () => {
    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
  });
});

describe('PlayerIntent', () => {
  const intents: PlayerIntent[] = [
    { type: 'intent.rollDice', playerId: 'player-1' },
    { type: 'intent.endTurn', playerId: 'player-1' },
  ];

  it('discriminates on `type` and narrows exhaustively per variant', () => {
    for (const intent of intents) {
      switch (intent.type) {
        case 'intent.rollDice': {
          const i: RollDiceIntent = intent;
          expect(i.playerId).toBe('player-1');
          break;
        }
        case 'intent.endTurn': {
          const i: EndTurnIntent = intent;
          expect(i.playerId).toBe('player-1');
          break;
        }
        default: {
          const exhaustive: never = intent;
          throw new Error(`unhandled intent type: ${JSON.stringify(exhaustive)}`);
        }
      }
    }
  });
});

describe('RejectReason', () => {
  it('is an enumerated string-literal union', () => {
    const reasons: RejectReason[] = [
      'NOT_YOUR_TURN',
      'INVALID_PHASE',
      'UNKNOWN_PLAYER',
      'MALFORMED_INTENT',
    ];
    for (const reason of reasons) {
      expect(typeof reason).toBe('string');
    }
  });
});
