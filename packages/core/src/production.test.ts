// @skervik/core — S1.2.1: resource production on roll + the gameplay RNG
// stream scheme. Exercises the full `intent.rollDice` -> `validate` ->
// events -> `reduce` pipeline: dice determinism, Classic production math
// (settlement payout, multi-owner tiles, robber block, bank exhaustion),
// the 7 short-circuit (no production — robber resolution itself is S1.3.1,
// see `robber.test.ts`), and phase/turn-order legality.

import { describe, expect, it } from 'vitest';

import { type BoardTopology, buildTopology, type TileTopology } from './board.js';
import { reduce } from './reduce.js';
import { gameplayStreamIndex, rollDie } from './rng.js';
import type {
  BoardState,
  BuildingsState,
  DiceRolledEvent,
  GameState,
  PlayerState,
  ResourcesProducedEvent,
} from './types.js';
import { validate } from './validate.js';

// A match's secret PRNG seed (revealed post-match) — chosen so this file's
// fixed `eventIndex` values below land on known totals (verified against
// `rollDie`/`gameplayStreamIndex` in the tests themselves, not just
// asserted): eventIndex 1 -> 6, eventIndex 4 -> 11, eventIndex 6 -> 7.
// Passed as `validate`'s 4th param only, never stored in state (A1).
const SEED = 'skervik-production-seed-1';

const topology = buildTopology();

function makePlayers(ids: readonly string[]): PlayerState[] {
  return ids.map((id) => ({ id, name: id, victoryPoints: 0, resources: {} }));
}

/** Two tiles that share no corner, so placing buildings on one can never silently collide with the other's vertex ids (unlike two real neighbors, which always share exactly 2 corners). */
function findDisjointTilePair(topo: BoardTopology): [TileTopology, TileTopology] {
  for (const a of topo.tiles) {
    for (const b of topo.tiles) {
      if (a.id === b.id) continue;
      if (!a.vertexIds.some((v) => b.vertexIds.includes(v))) return [a, b];
    }
  }
  throw new Error('fixture bug: no disjoint tile pair found');
}

// tileA (token 6, timber) carries the settlements under test; tileB (token
// 11, ore) hosts the robber, so its matching token 11 never actually pays
// out (S1.2.1 "robber blocks the tile" rule) even when a roll hits it.
const [tileA, tileB] = findDisjointTilePair(topology);

function makeBoard(): BoardState {
  const tileKinds: Record<string, string> = {};
  for (const tile of topology.tiles) {
    tileKinds[tile.id] =
      tile.id === tileA.id ? 'timber' : tile.id === tileB.id ? 'ore' : 'desert';
  }
  return {
    tileKinds,
    tileTokens: { [tileA.id]: 6, [tileB.id]: 11 },
    portContents: [],
    robberTileId: tileB.id,
  };
}

const board = makeBoard();
const vertexP1 = tileA.vertexIds[0] as string;
const vertexP2 = tileA.vertexIds[1] as string;

function makeBuildings(): BuildingsState {
  return { settlements: { [vertexP1]: 'player-1', [vertexP2]: 'player-2' }, roads: {} };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    matchId: 'match-production-1',
    // S1.2.4: rollDice is only legal from 'roll' (this story's mandatory
    // turn-FSM first step) — was 'main' pre-S1.2.4.
    phase: 'roll',
    turn: 1,
    currentPlayerId: 'player-1',
    players: makePlayers(['player-1', 'player-2', 'player-3']),
    eventIndex: 1, // resolves to total 6 with SEED (see the file-header table)
    seedHash: 'deadbeef',
    board,
    buildings: makeBuildings(),
    ...overrides,
  };
}

describe('resource production on roll (S1.2.1)', () => {
  it('is deterministic: same state+seed -> same dice + same payout, no re-draw on replay', () => {
    const state = makeState();

    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const again = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    expect(again).toEqual(result);

    const diceEvent = result.events[0] as DiceRolledEvent;
    expect(diceEvent).toMatchObject({
      dieA: rollDie(SEED, gameplayStreamIndex(state.eventIndex, 0)),
      dieB: rollDie(SEED, gameplayStreamIndex(state.eventIndex, 1)),
      total: 6,
    });

    // Replay: folding the exact same recorded events through `reduce` from
    // the same genesis twice reproduces the same state — no re-draw, no
    // recomputed payout, just facts being applied.
    const first = result.events.reduce(reduce, state);
    const second = result.events.reduce(reduce, state);
    expect(first).toEqual(second);
  });

  it('golden dice-draw regression guard for the gameplay RNG scheme (K=8, slot 0 = die A, slot 1 = die B)', () => {
    // Hard-coded so a future change to K, the slot map, or the derivation
    // algorithm is caught as a regression, not silently shipped (mirrors
    // rng.test.ts's `deriveValue`/`rollDie` golden tests).
    expect(gameplayStreamIndex(1, 0)).toBe(8);
    expect(gameplayStreamIndex(1, 1)).toBe(9);
    expect(rollDie(SEED, gameplayStreamIndex(1, 0))).toBe(1);
    expect(rollDie(SEED, gameplayStreamIndex(1, 1))).toBe(5);
  });

  it('headroom guard: gameplayStreamIndex throws before it could ever collide with the board-gen reserved band', () => {
    // K=8: 124_999*8 + 8 = 1_000_000 (last safe eventIndex); 125_000 trips it.
    expect(() => gameplayStreamIndex(124_999, 7)).not.toThrow();
    expect(() => gameplayStreamIndex(125_000, 0)).toThrow(/headroom exceeded/);
  });

  it('pays 1 resource per producing settlement, splitting a shared tile across its owners', () => {
    const state = makeState();

    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    const produced = result.events[1] as ResourcesProducedEvent;

    expect(produced.grants).toEqual({
      'player-1': { timber: 1 },
      'player-2': { timber: 1 },
    });
  });

  it('robber on a tile blocks its production even when the roll matches its token', () => {
    // eventIndex 4 resolves to total 11 (tileB's token) with SEED.
    const stateWithTileBSettlement: GameState = {
      ...makeState({ eventIndex: 4 }),
      buildings: {
        settlements: {
          ...makeBuildings().settlements,
          [tileB.vertexIds[0] as string]: 'player-3',
        },
        roads: {},
      },
    };

    const result = validate(
      stateWithTileBSettlement,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect((result.events[0] as DiceRolledEvent).total).toBe(11);
    const produced = result.events[1] as ResourcesProducedEvent;
    expect(produced.grants).toEqual({}); // the only tile bearing token 11 has the robber on it
  });

  it('bank exhaustion is all-or-nothing per resource: if it cannot pay everyone in full, nobody gets it', () => {
    const state = makeState({ bank: { timber: 1 } }); // 2 owed (2 settlements), only 1 available

    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    const produced = result.events[1] as ResourcesProducedEvent;

    expect(produced.grants).toEqual({});
    expect(produced.bank).toEqual({ timber: 1 }); // untouched — the whole point of all-or-nothing
  });

  it('a total of 7 emits only dice.rolled (with playersToDiscard), no resources.produced — robber resolution itself is S1.3.1, see robber.test.ts', () => {
    const state = makeState({ eventIndex: 6 }); // resolves to total 7 with SEED

    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'dice.rolled',
      total: 7,
      playersToDiscard: [], // makeState's players all start with empty hands
    });
  });

  it('advances state correctly end-to-end via reduce: eventIndex bumps by 2, phase stays main, resources + bank land', () => {
    const state = makeState();

    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    const next = result.events.reduce(reduce, state);

    // S1.2.4 formalized the dedicated 'roll' phase (state starts there, see
    // makeState) — `dice.rolled`'s own reduce case lands it on 'main' once
    // resolved, ready for build/buy/play/endTurn.
    expect(next.phase).toBe('main');
    expect(next.eventIndex).toBe(state.eventIndex + 2); // dice.rolled + resources.produced
    expect(next.players.find((p) => p.id === 'player-1')?.resources).toEqual({
      timber: 1,
    });
    expect(next.players.find((p) => p.id === 'player-2')?.resources).toEqual({
      timber: 1,
    });
    expect(next.players.find((p) => p.id === 'player-3')?.resources).toEqual({});
    expect(next.bank).toEqual({ timber: 17 }); // Classic default 19 per resource, minus 2 owed
  });

  it('never mutates input state through the full rollDice -> events -> reduce pipeline', () => {
    const state = makeState();
    const before: GameState = JSON.parse(JSON.stringify(state)) as GameState;

    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    result.events.reduce(reduce, state);

    expect(state).toEqual(before);
  });

  it('rejects NOT_YOUR_TURN and INVALID_PHASE for rollDice like every other phase-guarded intent', () => {
    const state = makeState();

    const wrongTurn = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-2' },
      'player-2',
      SEED,
    );
    expect(wrongTurn).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });

    const wrongPhase = validate(
      { ...state, phase: 'setup' },
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    expect(wrongPhase).toEqual({ ok: false, reason: 'INVALID_PHASE' });
  });
});
