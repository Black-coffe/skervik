// @skervik/core — S1.2.4: turn FSM (phases, explicit turn order, phase
// guards). Consolidates the ad-hoc phase transitions S1.2.1-S1.2.3 shipped
// into one coherent, guard-checked machine: `roll -> main`, clockwise
// rotation off an explicit seat order, and per-turn marker resets on
// `turn.ended`. Exercises the full multi-turn intent -> validate -> events
// -> reduce pipeline (rolls, a build, a dev-card buy+play across turns,
// endTurn, rotation, marker resets), one negative test per guard, and the
// explicit-seat-order decoupling this story introduces.

import { describe, expect, it } from 'vitest';

import {
  type BoardTopology,
  buildTopology,
  type EdgeTopology,
  findEdge,
  findVertex,
  type VertexTopology,
} from './board.js';
import { reduce } from './reduce.js';
import type { GameEvent, GameState, PlayerState, TurnEndedEvent } from './types.js';
import { validate } from './validate.js';

// The turn FSM never draws from the PRNG itself (guards/rotation are
// deterministic) — SEED only satisfies the fixed `validate` signature (plan
// §1) and, via `shuffledDevDeck`, is chosen so DECK[0] is 'yearOfPlenty' (a
// non-knight, immediately-playable-next-turn kind — see the round-2 play
// below).
const SEED = 'skervik-turn-fsm-seed-1';

const topology = buildTopology();

/**
 * A 3-vertex chain `A - B - C` (same fixture shape as `build.test.ts`'s):
 * `vertexA`/`edgeAB` become player-1's setup-phase anchor; `edgeBC` is the
 * free edge player-1 builds during round 1's main phase.
 */
function findChain(topo: BoardTopology): {
  vertexA: VertexTopology;
  edgeAB: EdgeTopology;
  vertexB: VertexTopology;
  edgeBC: EdgeTopology;
} {
  const vertexB = topo.vertices.find((v) => v.edgeIds.length >= 2);
  if (!vertexB) throw new Error('fixture bug: no vertex with >=2 edges found');
  const edgeAB = findEdge(topo, vertexB.edgeIds[0] as string) as EdgeTopology;
  const edgeBC = findEdge(topo, vertexB.edgeIds[1] as string) as EdgeTopology;
  const vertexA = findVertex(
    topo,
    edgeAB.vertexIds.find((id) => id !== vertexB.id) as string,
  ) as VertexTopology;
  return { vertexA, edgeAB, vertexB, edgeBC };
}

const { vertexA, edgeAB, edgeBC } = findChain(topology);

const RICH_RESOURCES = { timber: 5, clay: 5, fleece: 5, barley: 5, iron: 5 };

function makePlayer(id: string): PlayerState {
  return { id, name: id, victoryPoints: 0, resources: { ...RICH_RESOURCES } };
}

describe('turn FSM: phases, turn order, phase guards (S1.2.4)', () => {
  describe('multi-turn scripted fixture', () => {
    it('replays 2 full rounds (3 players): rolls, a build, a dev-card buy+play across turns, endTurn, correct rotation and per-turn marker resets', () => {
      const playerIds = ['player-1', 'player-2', 'player-3'];
      const genesis: GameState = {
        matchId: 'match-turn-fsm-1',
        phase: 'roll',
        turn: 1,
        currentPlayerId: 'player-1',
        players: playerIds.map(makePlayer),
        playerOrder: playerIds,
        eventIndex: 0,
        seedHash: 'deadbeef',
        buildings: {
          settlements: { [vertexA.id]: 'player-1' },
          roads: { [edgeAB.id]: 'player-1' },
        },
      };

      let state = genesis;
      const events: GameEvent[] = [];
      function apply(playerId: string, intent: Parameters<typeof validate>[1]): void {
        const result = validate(state, intent, playerId, SEED);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(`expected ok result for ${intent.type}`);
        state = result.events.reduce(reduce, state);
        events.push(...result.events);
      }

      // --- Round 1 ---
      // Turn 1 (player-1): roll, build a road, buy a dev card, end turn.
      apply('player-1', { type: 'intent.rollDice', playerId: 'player-1' });
      expect(state.phase).toBe('main'); // roll -> main, automatic production pass-through
      apply('player-1', {
        type: 'intent.buildRoad',
        playerId: 'player-1',
        edgeId: edgeBC.id,
      });
      expect(state.buildings?.roads[edgeBC.id]).toBe('player-1');
      apply('player-1', { type: 'intent.buyDevCard', playerId: 'player-1' });
      // DECK[0] for SEED is 'yearOfPlenty' (see the file-header comment).
      expect(state.devCards?.['player-1']).toEqual({
        held: { yearOfPlenty: 1 },
        boughtThisTurn: { yearOfPlenty: 1 },
      });
      apply('player-1', { type: 'intent.endTurn', playerId: 'player-1' });
      expect(state.currentPlayerId).toBe('player-2');
      expect(state.phase).toBe('roll'); // turn.ended always hands the next player 'roll'
      // Per-turn marker reset: boughtThisTurn clears for EVERY player, held survives.
      expect(state.devCards?.['player-1']).toEqual({
        held: { yearOfPlenty: 1 },
        boughtThisTurn: {},
      });
      expect(state.devCardPlayedThisTurn).toBeUndefined();

      // Turn 2 (player-2): roll, end turn — no build/buy, exercises the plain path.
      apply('player-2', { type: 'intent.rollDice', playerId: 'player-2' });
      apply('player-2', { type: 'intent.endTurn', playerId: 'player-2' });
      expect(state.currentPlayerId).toBe('player-3');
      expect(state.phase).toBe('roll');

      // Turn 3 (player-3): roll, end turn — wraps back to player-1 (round 1 done).
      apply('player-3', { type: 'intent.rollDice', playerId: 'player-3' });
      apply('player-3', { type: 'intent.endTurn', playerId: 'player-3' });
      expect(state.currentPlayerId).toBe('player-1');
      expect(state.phase).toBe('roll');
      expect(state.turn).toBe(4); // genesis turn 1 + 3 endTurns

      // --- Round 2 ---
      // Turn 4 (player-1): roll, then play the card bought last turn — only
      // legal now because `turn.ended` cleared `boughtThisTurn` in between.
      apply('player-1', { type: 'intent.rollDice', playerId: 'player-1' });
      apply('player-1', {
        type: 'intent.playDevCard',
        playerId: 'player-1',
        card: 'yearOfPlenty',
        resources: ['timber', 'clay'],
      });
      expect(state.devCardPlayedThisTurn).toBe(true);
      expect(state.devCards?.['player-1']?.held.yearOfPlenty).toBe(0);
      apply('player-1', { type: 'intent.endTurn', playerId: 'player-1' });
      expect(state.currentPlayerId).toBe('player-2');
      expect(state.devCardPlayedThisTurn).toBeUndefined(); // reset again

      // Turn 5 (player-2), turn 6 (player-3): roll, end turn.
      apply('player-2', { type: 'intent.rollDice', playerId: 'player-2' });
      apply('player-2', { type: 'intent.endTurn', playerId: 'player-2' });
      apply('player-3', { type: 'intent.rollDice', playerId: 'player-3' });
      apply('player-3', { type: 'intent.endTurn', playerId: 'player-3' });

      // Correct rotation across both full rounds: back to player-1, fresh roll.
      expect(state.currentPlayerId).toBe('player-1');
      expect(state.phase).toBe('roll');
      expect(state.turn).toBe(7); // genesis turn 1 + 6 endTurns

      // Determinism: replaying the exact same recorded events from genesis
      // reproduces this final state byte-for-byte.
      const replayed = events.reduce(reduce, genesis);
      expect(replayed).toEqual(state);
    });
  });

  describe('explicit turn order', () => {
    it("rotates by GameState.playerOrder, not by players' incidental array order", () => {
      // `players` is deliberately shuffled relative to `playerOrder` — if
      // `endTurn` still derived "next player" from `players`' array index
      // (the coupling this story removes), it would rotate to 'player-3'
      // instead of the correct 'player-2'.
      const state: GameState = {
        matchId: 'match-turn-fsm-order-1',
        phase: 'main',
        turn: 1,
        currentPlayerId: 'player-1',
        players: [makePlayer('player-1'), makePlayer('player-3'), makePlayer('player-2')],
        playerOrder: ['player-1', 'player-2', 'player-3'],
        eventIndex: 0,
        seedHash: 'deadbeef',
      };

      const result = validate(
        state,
        { type: 'intent.endTurn', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      const event = result.events[0] as TurnEndedEvent;
      expect(event.nextPlayerId).toBe('player-2');
    });
  });

  describe('phase guards: one negative test per rule', () => {
    function makeGuardState(overrides: Partial<GameState> = {}): GameState {
      return {
        matchId: 'match-turn-fsm-guard-1',
        phase: 'roll',
        turn: 1,
        currentPlayerId: 'player-1',
        players: [makePlayer('player-1'), makePlayer('player-2')],
        eventIndex: 0,
        seedHash: 'deadbeef',
        ...overrides,
      };
    }

    it('rejects MUST_ROLL_FIRST when acting (buying a dev card) before rolling', () => {
      const result = validate(
        makeGuardState(),
        { type: 'intent.buyDevCard', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'MUST_ROLL_FIRST' });
    });

    it('rejects ALREADY_ROLLED when rolling a second time this turn', () => {
      const result = validate(
        makeGuardState({ phase: 'main' }),
        { type: 'intent.rollDice', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'ALREADY_ROLLED' });
    });

    it('rejects MUST_ROLL_FIRST when building before rolling', () => {
      const result = validate(
        makeGuardState(),
        { type: 'intent.buildRoad', playerId: 'player-1', edgeId: 'edge-1' },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'MUST_ROLL_FIRST' });
    });

    it('rejects MUST_ROLL_FIRST when ending a turn before rolling', () => {
      const result = validate(
        makeGuardState(),
        { type: 'intent.endTurn', playerId: 'player-1' },
        'player-1',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'MUST_ROLL_FIRST' });
    });

    it('rejects NOT_YOUR_TURN when acting out of turn (correct phase, wrong player)', () => {
      const result = validate(
        makeGuardState({ phase: 'main' }),
        { type: 'intent.endTurn', playerId: 'player-2' },
        'player-2',
        SEED,
      );
      expect(result).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
    });

    it('a rolled 7 still lands the phase on main (robber phase seam documented, not entered — S1.3.1)', () => {
      // eventIndex 6 resolves to total 7 with this seed (documented in
      // production.test.ts's file-header table).
      const SEVEN_SEED = 'skervik-production-seed-1';
      const state = makeGuardState({ eventIndex: 6 });

      const result = validate(
        state,
        { type: 'intent.rollDice', playerId: 'player-1' },
        'player-1',
        SEVEN_SEED,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok result');
      expect(result.events).toHaveLength(1); // dice.rolled only, no resources.produced
      expect(result.events[0]).toMatchObject({ type: 'dice.rolled', total: 7 });

      const next = reduce(state, result.events[0] as GameEvent);
      expect(next.phase).toBe('main');
    });
  });
});
