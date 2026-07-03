import { describe, expect, it } from 'vitest';

import type {
  BoardGeneratedEvent,
  BuildCityIntent,
  BuildRoadIntent,
  BuildSettlementIntent,
  BuyDevCardIntent,
  CityBuiltEvent,
  DevCardBoughtEvent,
  DiceRolledEvent,
  EndTurnIntent,
  GameEvent,
  GameState,
  MatchStartedEvent,
  MonopolyPlayedEvent,
  PlaceRoadIntent,
  PlaceSettlementIntent,
  PlayerIntent,
  PlayerState,
  PlayKnightIntent,
  PlayMonopolyIntent,
  PlayRoadBuildingIntent,
  PlayYearOfPlentyIntent,
  RejectReason,
  ResourcesProducedEvent,
  RoadBuildingPlayedEvent,
  RoadBuiltEvent,
  RoadPlacedEvent,
  RollDiceIntent,
  SettlementBuiltEvent,
  SettlementPlacedEvent,
  TurnEndedEvent,
  YearOfPlentyPlayedEvent,
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
    {
      type: 'board.generated',
      index: 1,
      tileKinds: { '0,0': 'desert' },
      tileTokens: {},
      portContents: [{ kind: 'generic', rate: 3 }],
      robberTileId: '0,0',
    },
    { type: 'dice.rolled', index: 2, playerId: 'player-1', dieA: 5, dieB: 3, total: 8 },
    {
      type: 'resources.produced',
      index: 3,
      grants: { 'player-1': { timber: 1 } },
      bank: { timber: 18 },
    },
    { type: 'turn.ended', index: 4, playerId: 'player-1', nextPlayerId: 'player-2' },
    {
      type: 'settlement.placed',
      index: 5,
      playerId: 'player-1',
      vertexId: 'vertex-1',
      payout: { timber: 1 },
    },
    {
      type: 'road.placed',
      index: 6,
      playerId: 'player-1',
      edgeId: 'edge-1',
      nextPlayerId: 'player-2',
      nextPhase: 'setup',
    },
    {
      type: 'road.built',
      index: 7,
      playerId: 'player-1',
      edgeId: 'edge-1',
      cost: { timber: 1, clay: 1 },
    },
    {
      type: 'settlement.built',
      index: 8,
      playerId: 'player-1',
      vertexId: 'vertex-1',
      cost: { timber: 1, clay: 1, fleece: 1, barley: 1 },
    },
    {
      type: 'city.built',
      index: 9,
      playerId: 'player-1',
      vertexId: 'vertex-1',
      cost: { iron: 3, barley: 2 },
    },
    {
      type: 'devCard.bought',
      index: 10,
      playerId: 'player-1',
      card: 'knight',
      cost: { fleece: 1, barley: 1, iron: 1 },
      deckRemaining: 24,
    },
    {
      type: 'devCard.roadBuildingPlayed',
      index: 11,
      playerId: 'player-1',
      edgeIds: ['edge-1', 'edge-2'],
    },
    {
      type: 'devCard.yearOfPlentyPlayed',
      index: 12,
      playerId: 'player-1',
      resources: { timber: 2 },
      bank: { timber: 17 },
    },
    {
      type: 'devCard.monopolyPlayed',
      index: 13,
      playerId: 'player-1',
      resource: 'timber',
      transfers: { 'player-2': 3 },
    },
  ];

  it('discriminates on `type` and narrows exhaustively per variant', () => {
    for (const event of events) {
      switch (event.type) {
        case 'match.started': {
          const e: MatchStartedEvent = event;
          expect(e.playerIds).toContain('player-1');
          break;
        }
        case 'board.generated': {
          const e: BoardGeneratedEvent = event;
          expect(e.robberTileId).toBe('0,0');
          break;
        }
        case 'dice.rolled': {
          const e: DiceRolledEvent = event;
          expect(e.total).toBe(8);
          break;
        }
        case 'resources.produced': {
          const e: ResourcesProducedEvent = event;
          expect(e.grants).toEqual({ 'player-1': { timber: 1 } });
          break;
        }
        case 'turn.ended': {
          const e: TurnEndedEvent = event;
          expect(e.nextPlayerId).toBe('player-2');
          break;
        }
        case 'settlement.placed': {
          const e: SettlementPlacedEvent = event;
          expect(e.payout).toEqual({ timber: 1 });
          break;
        }
        case 'road.placed': {
          const e: RoadPlacedEvent = event;
          expect(e.nextPhase).toBe('setup');
          break;
        }
        case 'road.built': {
          const e: RoadBuiltEvent = event;
          expect(e.cost).toEqual({ timber: 1, clay: 1 });
          break;
        }
        case 'settlement.built': {
          const e: SettlementBuiltEvent = event;
          expect(e.vertexId).toBe('vertex-1');
          break;
        }
        case 'city.built': {
          const e: CityBuiltEvent = event;
          expect(e.cost).toEqual({ iron: 3, barley: 2 });
          break;
        }
        case 'devCard.bought': {
          const e: DevCardBoughtEvent = event;
          expect(e.card).toBe('knight');
          break;
        }
        case 'devCard.roadBuildingPlayed': {
          const e: RoadBuildingPlayedEvent = event;
          expect(e.edgeIds).toEqual(['edge-1', 'edge-2']);
          break;
        }
        case 'devCard.yearOfPlentyPlayed': {
          const e: YearOfPlentyPlayedEvent = event;
          expect(e.resources).toEqual({ timber: 2 });
          break;
        }
        case 'devCard.monopolyPlayed': {
          const e: MonopolyPlayedEvent = event;
          expect(e.transfers).toEqual({ 'player-2': 3 });
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
    { type: 'intent.placeSettlement', playerId: 'player-1', vertexId: 'vertex-1' },
    { type: 'intent.placeRoad', playerId: 'player-1', edgeId: 'edge-1' },
    { type: 'intent.buildRoad', playerId: 'player-1', edgeId: 'edge-1' },
    { type: 'intent.buildSettlement', playerId: 'player-1', vertexId: 'vertex-1' },
    { type: 'intent.buildCity', playerId: 'player-1', vertexId: 'vertex-1' },
    { type: 'intent.buyDevCard', playerId: 'player-1' },
    { type: 'intent.playDevCard', playerId: 'player-1', card: 'knight' },
    {
      type: 'intent.playDevCard',
      playerId: 'player-1',
      card: 'roadBuilding',
      edgeIds: ['edge-1'],
    },
    {
      type: 'intent.playDevCard',
      playerId: 'player-1',
      card: 'yearOfPlenty',
      resources: ['timber', 'clay'],
    },
    {
      type: 'intent.playDevCard',
      playerId: 'player-1',
      card: 'monopoly',
      resource: 'timber',
    },
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
        case 'intent.placeSettlement': {
          const i: PlaceSettlementIntent = intent;
          expect(i.vertexId).toBe('vertex-1');
          break;
        }
        case 'intent.placeRoad': {
          const i: PlaceRoadIntent = intent;
          expect(i.edgeId).toBe('edge-1');
          break;
        }
        case 'intent.buildRoad': {
          const i: BuildRoadIntent = intent;
          expect(i.edgeId).toBe('edge-1');
          break;
        }
        case 'intent.buildSettlement': {
          const i: BuildSettlementIntent = intent;
          expect(i.vertexId).toBe('vertex-1');
          break;
        }
        case 'intent.buildCity': {
          const i: BuildCityIntent = intent;
          expect(i.vertexId).toBe('vertex-1');
          break;
        }
        case 'intent.buyDevCard': {
          const i: BuyDevCardIntent = intent;
          expect(i.playerId).toBe('player-1');
          break;
        }
        case 'intent.playDevCard': {
          switch (intent.card) {
            case 'knight': {
              const i: PlayKnightIntent = intent;
              expect(i.card).toBe('knight');
              break;
            }
            case 'roadBuilding': {
              const i: PlayRoadBuildingIntent = intent;
              expect(i.edgeIds).toContain('edge-1');
              break;
            }
            case 'yearOfPlenty': {
              const i: PlayYearOfPlentyIntent = intent;
              expect(i.resources).toEqual(['timber', 'clay']);
              break;
            }
            case 'monopoly': {
              const i: PlayMonopolyIntent = intent;
              expect(i.resource).toBe('timber');
              break;
            }
            default: {
              const exhaustive: never = intent;
              throw new Error(
                `unhandled playDevCard card kind: ${JSON.stringify(exhaustive)}`,
              );
            }
          }
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
      'OCCUPIED',
      'DISTANCE_VIOLATION',
      'DETACHED_ROAD',
      'WRONG_PHASE',
      'CANNOT_AFFORD',
      'NOT_CONNECTED',
      'NOT_OWN_SETTLEMENT',
      'SUPPLY_EXHAUSTED',
      'DECK_EMPTY',
      'CARD_NOT_HELD',
      'BOUGHT_THIS_TURN',
      'DEV_CARD_ALREADY_PLAYED',
      'KNIGHT_DEFERRED',
      'BANK_EXHAUSTED',
      'ALREADY_ROLLED',
      'MUST_ROLL_FIRST',
    ];
    for (const reason of reasons) {
      expect(typeof reason).toBe('string');
    }
  });
});
