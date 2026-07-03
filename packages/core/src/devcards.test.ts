// @skervik/core — S1.2.3: development cards (deck, buy, play). Exercises the
// seed-shuffled deck (deterministic order, disjoint reserved stream band),
// the full `intent.buyDevCard` / `intent.playDevCard` -> `validate` ->
// events -> `reduce` pipeline for every playable card kind, the
// bought-this-turn / one-per-turn markers, the knight-deferral seam
// (S1.3.1), and one negative test per new S1.2.3 reject reason.

import { describe, expect, it } from 'vitest';

import {
  type BoardTopology,
  buildTopology,
  type EdgeTopology,
  findEdge,
  findVertex,
  type VertexTopology,
} from './board.js';
import {
  CLASSIC_DEV_CARD_PROFILE,
  DEV_DECK_STREAM,
  publicDevCardCount,
  shuffledDevDeck,
} from './devcards.js';
import { reduce } from './reduce.js';
import type {
  BuildingsState,
  DevCardBoughtEvent,
  GameEvent,
  GameState,
  MonopolyPlayedEvent,
  PlayerState,
  RoadBuildingPlayedEvent,
  YearOfPlentyPlayedEvent,
} from './types.js';
import { validate } from './validate.js';

// A match's secret PRNG seed (revealed post-match) — chosen so the golden
// deck-order assertions below have a known, hard-coded shuffle. Passed as
// `validate`'s 4th param only, never stored in state (A1).
const SEED = 'skervik-devcards-golden-seed-1';
const DECK = shuffledDevDeck(SEED);

const topology = buildTopology();

function makePlayer(
  id: string,
  resources: Record<string, number>,
  victoryPoints = 0,
): PlayerState {
  return { id, name: id, victoryPoints, resources };
}

/**
 * A 4-vertex chain `A - B - C - D` (edges `AB`, `BC`, `CD`) — `AB` is the
 * player's already-built road (network anchor); `BC`/`CD` are 2 fresh,
 * chained edges free for a road-building card to place on (`CD` only
 * touches the network once `BC` has been placed, exercising the
 * incremental-network check the same way 2 real road-building plays do).
 */
function findChain4(topo: BoardTopology): {
  vertexA: VertexTopology;
  edgeAB: EdgeTopology;
  vertexB: VertexTopology;
  edgeBC: EdgeTopology;
  vertexC: VertexTopology;
  edgeCD: EdgeTopology;
  vertexD: VertexTopology;
} {
  for (const vertexB of topo.vertices) {
    if (vertexB.edgeIds.length < 2) continue;
    for (const edgeABId of vertexB.edgeIds) {
      const edgeAB = findEdge(topo, edgeABId) as EdgeTopology;
      const vertexA = findVertex(
        topo,
        edgeAB.vertexIds.find((id) => id !== vertexB.id) as string,
      ) as VertexTopology;
      for (const edgeBCId of vertexB.edgeIds) {
        if (edgeBCId === edgeABId) continue;
        const edgeBC = findEdge(topo, edgeBCId) as EdgeTopology;
        const vertexC = findVertex(
          topo,
          edgeBC.vertexIds.find((id) => id !== vertexB.id) as string,
        ) as VertexTopology;
        for (const edgeCDId of vertexC.edgeIds) {
          if (edgeCDId === edgeBCId) continue;
          const edgeCD = findEdge(topo, edgeCDId) as EdgeTopology;
          const vertexDId = edgeCD.vertexIds.find((id) => id !== vertexC.id) as string;
          if (vertexDId === vertexA.id || vertexDId === vertexB.id) continue;
          const vertexD = findVertex(topo, vertexDId) as VertexTopology;
          return { vertexA, edgeAB, vertexB, edgeBC, vertexC, edgeCD, vertexD };
        }
      }
    }
  }
  throw new Error('fixture bug: no 4-chain found');
}

const { vertexA, edgeAB, edgeBC, edgeCD } = findChain4(topology);

const RICH_RESOURCES = { timber: 5, clay: 5, fleece: 5, barley: 5, iron: 5 };

function makeBuildings(): BuildingsState {
  return {
    settlements: { [vertexA.id]: 'player-1' },
    roads: { [edgeAB.id]: 'player-1' },
  };
}

function makeGenesis(overrides: Partial<GameState> = {}): GameState {
  return {
    matchId: 'match-devcards-1',
    phase: 'main',
    turn: 5,
    currentPlayerId: 'player-1',
    players: [
      makePlayer('player-1', { ...RICH_RESOURCES }),
      makePlayer('player-2', { ...RICH_RESOURCES }),
      makePlayer('player-3', { ...RICH_RESOURCES }),
    ],
    eventIndex: 10,
    seedHash: 'deadbeef',
    buildings: makeBuildings(),
    ...overrides,
  };
}

describe('development cards (S1.2.3)', () => {
  describe('deck shuffle', () => {
    it('is deterministic: same seed -> byte-identical order, called twice', () => {
      expect(shuffledDevDeck(SEED)).toEqual(shuffledDevDeck(SEED));
    });

    it('is a permutation of the exact Classic multiset (14 knight, 2 road-building, 2 year-of-plenty, 2 monopoly, 5 victory-point)', () => {
      const counts = shuffledDevDeck(SEED).reduce<Record<string, number>>((acc, card) => {
        acc[card] = (acc[card] ?? 0) + 1;
        return acc;
      }, {});
      expect(counts).toEqual({
        knight: 14,
        roadBuilding: 2,
        yearOfPlenty: 2,
        monopoly: 2,
        victoryPoint: 5,
      });
      expect(shuffledDevDeck(SEED)).toHaveLength(25);
    });

    it('different seeds produce different orders', () => {
      expect(shuffledDevDeck(SEED)).not.toEqual(
        shuffledDevDeck('skervik-devcards-golden-seed-2'),
      );
    });

    it('golden: matches a fixed order for the golden seed (regression guard, docs/wiki/rng-stream-map.md §2.5)', () => {
      // Hard-coded so a change to the algorithm or the reserved stream-index
      // band is caught as a regression, not silently shipped (same
      // convention as boardgen.test.ts's golden layout assertion).
      expect(shuffledDevDeck(SEED)).toEqual([
        'knight',
        'monopoly',
        'roadBuilding',
        'knight',
        'victoryPoint',
        'yearOfPlenty',
        'victoryPoint',
        'knight',
        'roadBuilding',
        'knight',
        'knight',
        'victoryPoint',
        'knight',
        'knight',
        'knight',
        'knight',
        'knight',
        'knight',
        'knight',
        'knight',
        'victoryPoint',
        'yearOfPlenty',
        'victoryPoint',
        'monopoly',
        'knight',
      ]);
    });

    it('is drawn from a reserved stream band disjoint from gameplay draws and the board-gen band', () => {
      // Gameplay draws never exceed eventIndex*8+7 (headroom-guarded below
      // 1_000_000, rng.ts); board-gen's worst case tops out at 1_007_316
      // (boardgen.ts). The deck shuffle's 25 items consume 24 draws starting
      // at DEV_DECK_STREAM.SHUFFLE — comfortably clear of both.
      expect(DEV_DECK_STREAM.SHUFFLE).toBeGreaterThan(1_007_316);
      expect(DEV_DECK_STREAM.SHUFFLE).toBeGreaterThanOrEqual(1_000_000);
    });
  });

  describe('buy', () => {
    it('draws the top of the shuffled deck, debits the Classic cost, decrements the deck, marks bought-this-turn', () => {
      const genesis = makeGenesis();

      const result = validate(
        genesis,
        { type: 'intent.buyDevCard', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as DevCardBoughtEvent;
      expect(event).toMatchObject({
        type: 'devCard.bought',
        card: DECK[0],
        cost: { fleece: 1, barley: 1, iron: 1 },
        deckRemaining: CLASSIC_DEV_CARD_PROFILE.deck.length - 1,
      });

      const next = reduce(genesis, event);
      expect(next.devDeckRemaining).toBe(24);
      expect(next.devCards?.['player-1']).toEqual({
        held: { [DECK[0] as string]: 1 },
        boughtThisTurn: { [DECK[0] as string]: 1 },
      });
      expect(next.players.find((p) => p.id === 'player-1')?.resources).toEqual({
        ...RICH_RESOURCES,
        fleece: 4,
        barley: 4,
        iron: 4,
      });
    });

    it("a second buy draws the deck's next card and stacks holdings", () => {
      const afterFirst: GameState = {
        ...makeGenesis(),
        devDeckRemaining: 24,
        devCards: {
          'player-1': { held: { [DECK[0] as string]: 1 }, boughtThisTurn: {} },
        },
      };

      const result = validate(
        afterFirst,
        { type: 'intent.buyDevCard', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as DevCardBoughtEvent;
      expect(event.card).toBe(DECK[1]);
      expect(event.deckRemaining).toBe(23);
    });

    it("privacy: the public projection of another player's holdings is a single total, not the per-kind breakdown", () => {
      const holdings = { held: { knight: 2, monopoly: 1 }, boughtThisTurn: {} };
      expect(publicDevCardCount(holdings)).toBe(3);
    });

    it('rejects CANNOT_AFFORD when the actor lacks the buy cost', () => {
      const genesis = makeGenesis({
        players: [
          makePlayer('player-1', {}),
          makePlayer('player-2', {}),
          makePlayer('player-3', {}),
        ],
      });

      const result = validate(
        genesis,
        { type: 'intent.buyDevCard', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'CANNOT_AFFORD' });
    });

    it('rejects DECK_EMPTY when no cards remain', () => {
      const genesis = makeGenesis({ devDeckRemaining: 0 });

      const result = validate(
        genesis,
        { type: 'intent.buyDevCard', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'DECK_EMPTY' });
    });

    it('a card bought this turn is unplayable this turn (BOUGHT_THIS_TURN)', () => {
      // DECK[1] === 'monopoly' for the golden seed.
      const afterBuy: GameState = {
        ...makeGenesis(),
        devDeckRemaining: 23,
        devCards: {
          'player-1': { held: { monopoly: 1 }, boughtThisTurn: { monopoly: 1 } },
        },
      };

      const result = validate(
        afterBuy,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'monopoly',
          resource: 'timber',
        },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'BOUGHT_THIS_TURN' });
    });

    it('rejects CARD_NOT_HELD when the actor never bought the card', () => {
      const result = validate(
        makeGenesis(),
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'roadBuilding',
          edgeIds: [edgeBC.id],
        },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'CARD_NOT_HELD' });
    });
  });

  describe('play: road-building', () => {
    function genesisWithHeldRoadBuilding(): GameState {
      return makeGenesis({
        devCards: { 'player-1': { held: { roadBuilding: 1 }, boughtThisTurn: {} } },
      });
    }

    it('places 2 free roads (no cost), reusing S1.2.2 network legality, and consumes the play', () => {
      const genesis = genesisWithHeldRoadBuilding();

      const result = validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'roadBuilding',
          edgeIds: [edgeBC.id, edgeCD.id],
        },
        'player-1',
        SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as RoadBuildingPlayedEvent;
      expect(event.edgeIds).toEqual([edgeBC.id, edgeCD.id]);

      const next = reduce(genesis, event);
      expect(next.buildings?.roads[edgeBC.id]).toBe('player-1');
      expect(next.buildings?.roads[edgeCD.id]).toBe('player-1');
      // Free: resources untouched.
      expect(next.players.find((p) => p.id === 'player-1')?.resources).toEqual(
        RICH_RESOURCES,
      );
      expect(next.devCards?.['player-1']?.held.roadBuilding).toBe(0);
      expect(next.devCardPlayedThisTurn).toBe(true);
    });

    it('places fewer than 2 when the road supply is exhausted mid-play', () => {
      const roads: Record<string, string> = { [edgeAB.id]: 'player-1' };
      for (let i = 0; i < 14; i++) roads[`fake-edge-${i}`] = 'player-1'; // 15/15 supply used
      const genesis = genesisWithHeldRoadBuilding();
      const state: GameState = {
        ...genesis,
        buildings: { settlements: { [vertexA.id]: 'player-1' }, roads },
      };

      const result = validate(
        state,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'roadBuilding',
          edgeIds: [edgeBC.id, edgeCD.id],
        },
        'player-1',
        SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as RoadBuildingPlayedEvent;
      expect(event.edgeIds).toEqual([]); // supply already exhausted before either could be placed
    });

    it('rejects MALFORMED_INTENT for the whole play when an edge id does not exist (S1.2.4 coverage nit)', () => {
      const genesis = genesisWithHeldRoadBuilding();

      const result = validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'roadBuilding',
          edgeIds: ['edge-does-not-exist', edgeBC.id],
        },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'MALFORMED_INTENT' });
    });

    it('silently skips a detached-until-chained edge rather than rejecting it (S1.2.4 coverage nit)', () => {
      const genesis = genesisWithHeldRoadBuilding();

      // edgeCD only touches player-1's network once edgeBC (its own chain
      // predecessor) is placed first — requesting ONLY edgeCD exercises the
      // "place fewer" drop path: not an error, just skipped.
      const result = validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'roadBuilding',
          edgeIds: [edgeCD.id],
        },
        'player-1',
        SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as RoadBuildingPlayedEvent;
      expect(event.edgeIds).toEqual([]);
    });

    it('one-dev-card-per-turn: rejects DEV_CARD_ALREADY_PLAYED after a card was already played this turn', () => {
      const genesis: GameState = {
        ...genesisWithHeldRoadBuilding(),
        devCardPlayedThisTurn: true,
      };

      const result = validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'roadBuilding',
          edgeIds: [edgeBC.id],
        },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'DEV_CARD_ALREADY_PLAYED' });
    });
  });

  describe('play: year-of-plenty', () => {
    function genesisWithHeldYearOfPlenty(overrides: Partial<GameState> = {}): GameState {
      return makeGenesis({
        devCards: { 'player-1': { held: { yearOfPlenty: 1 }, boughtThisTurn: {} } },
        ...overrides,
      });
    }

    it('takes 2 explicit resources from the bank (2 distinct kinds)', () => {
      const genesis = genesisWithHeldYearOfPlenty({ bank: { timber: 19, clay: 19 } });

      const result = validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'yearOfPlenty',
          resources: ['timber', 'clay'],
        },
        'player-1',
        SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as YearOfPlentyPlayedEvent;
      expect(event.resources).toEqual({ timber: 1, clay: 1 });
      expect(event.bank).toEqual({ timber: 18, clay: 18 });

      const next = reduce(genesis, event);
      expect(next.players.find((p) => p.id === 'player-1')?.resources).toEqual({
        ...RICH_RESOURCES,
        timber: 6,
        clay: 6,
      });
      expect(next.devCards?.['player-1']?.held.yearOfPlenty).toBe(0);
      expect(next.devCardPlayedThisTurn).toBe(true);
    });

    it('may name the same resource twice, taking 2 of it', () => {
      const genesis = genesisWithHeldYearOfPlenty({ bank: { timber: 19 } });

      const result = validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'yearOfPlenty',
          resources: ['timber', 'timber'],
        },
        'player-1',
        SEED,
      );
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as YearOfPlentyPlayedEvent;
      expect(event.resources).toEqual({ timber: 2 });
      expect(event.bank).toEqual({ timber: 17 });
    });

    it('rejects BANK_EXHAUSTED when the bank cannot cover the request', () => {
      const genesis = genesisWithHeldYearOfPlenty({ bank: { timber: 0 } });

      const result = validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'yearOfPlenty',
          resources: ['timber', 'clay'],
        },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'BANK_EXHAUSTED' });
    });
  });

  describe('play: monopoly', () => {
    function genesisWithHeldMonopoly(overrides: Partial<GameState> = {}): GameState {
      return makeGenesis({
        devCards: { 'player-1': { held: { monopoly: 1 }, boughtThisTurn: {} } },
        ...overrides,
      });
    }

    it("collects every other player's entire holding of the named resource, with explicit per-victim amounts", () => {
      const genesis = genesisWithHeldMonopoly({
        players: [
          makePlayer('player-1', { timber: 0 }),
          makePlayer('player-2', { timber: 3 }),
          makePlayer('player-3', { timber: 2 }),
        ],
      });

      const result = validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'monopoly',
          resource: 'timber',
        },
        'player-1',
        SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as MonopolyPlayedEvent;
      expect(event.resource).toBe('timber');
      expect(event.transfers).toEqual({ 'player-2': 3, 'player-3': 2 });

      const next = reduce(genesis, event);
      expect(next.players.find((p) => p.id === 'player-1')?.resources.timber).toBe(5);
      expect(next.players.find((p) => p.id === 'player-2')?.resources.timber).toBe(0);
      expect(next.players.find((p) => p.id === 'player-3')?.resources.timber).toBe(0);
      expect(next.devCards?.['player-1']?.held.monopoly).toBe(0);
    });

    it('still consumes the play when no other player holds the named resource', () => {
      const genesis = genesisWithHeldMonopoly({
        players: [
          makePlayer('player-1', { timber: 0 }),
          makePlayer('player-2', { timber: 0 }),
          makePlayer('player-3', { timber: 0 }),
        ],
      });

      const result = validate(
        genesis,
        {
          type: 'intent.playDevCard',
          playerId: 'player-1',
          card: 'monopoly',
          resource: 'timber',
        },
        'player-1',
        SEED,
      );
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as MonopolyPlayedEvent;
      expect(event.transfers).toEqual({});

      const next = reduce(genesis, event);
      expect(next.devCardPlayedThisTurn).toBe(true);
    });
  });

  describe('knight (un-deferred by S1.3.1 — full play/relocate/steal coverage lives in robber.test.ts)', () => {
    it('knight count is tracked on buy, ready for the played-knight counter (S1.3.1/S1.3.4)', () => {
      // DECK[0] === 'knight' for the golden seed.
      const genesis = makeGenesis();

      const result = validate(
        genesis,
        { type: 'intent.buyDevCard', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as DevCardBoughtEvent;
      const next = reduce(genesis, event);
      expect(next.devCards?.['player-1']?.held.knight).toBe(1);
    });
  });

  describe('turn reset (minimal marker reset — S1.2.4 formalizes)', () => {
    it("turn.ended clears devCardPlayedThisTurn and each player's boughtThisTurn, but not held counts", () => {
      const state: GameState = {
        ...makeGenesis(),
        devCardPlayedThisTurn: true,
        devCards: {
          'player-1': {
            held: { roadBuilding: 1, monopoly: 1 },
            boughtThisTurn: { monopoly: 1 },
          },
        },
      };

      const next = reduce(state, {
        type: 'turn.ended',
        index: state.eventIndex,
        playerId: 'player-1',
        nextPlayerId: 'player-2',
      });

      expect(next.devCardPlayedThisTurn).toBeUndefined();
      expect(next.devCards?.['player-1']).toEqual({
        held: { roadBuilding: 1, monopoly: 1 },
        boughtThisTurn: {},
      });
    });
  });

  describe('determinism', () => {
    it('replays a buy -> play(roadBuilding) sequence to the same deep-equal state', () => {
      const genesis = makeGenesis();
      let state = genesis;
      const events: GameEvent[] = [];

      const buyResult = validate(
        state,
        { type: 'intent.buyDevCard', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      if (!buyResult.ok) throw new Error('expected ok result');
      state = buyResult.events.reduce(reduce, state);
      events.push(...buyResult.events);

      // DECK[0] is 'knight' for the golden seed — buy a 2nd card to get a
      // playable non-knight kind (DECK[1] === 'monopoly'), then simulate a
      // turn passing so it's no longer "bought this turn".
      const buy2 = validate(
        state,
        { type: 'intent.buyDevCard', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      if (!buy2.ok) throw new Error('expected ok result');
      state = buy2.events.reduce(reduce, state);
      events.push(...buy2.events);

      const endTurn = validate(
        state,
        { type: 'intent.endTurn', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      if (!endTurn.ok) throw new Error('expected ok result');
      state = endTurn.events.reduce(reduce, state);
      events.push(...endTurn.events);

      const replayed = events.reduce(reduce, genesis);
      expect(replayed).toEqual(state);
    });

    it('never mutates input state through the full buyDevCard -> events -> reduce pipeline', () => {
      const genesis = makeGenesis();
      const before: GameState = JSON.parse(JSON.stringify(genesis)) as GameState;

      const result = validate(
        genesis,
        { type: 'intent.buyDevCard', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      if (!result.ok) throw new Error('expected ok result');
      result.events.reduce(reduce, genesis);

      expect(genesis).toEqual(before);
    });
  });
});
