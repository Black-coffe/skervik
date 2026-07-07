// @skervik/core — S2.2.1: the `friendlyRobber` catch-up flag. Exercises the
// profile-gated eligible-victim gate inside `resolveRobberMove` (shared by
// both `intent.moveRobber` and the knight's `intent.playDevCard` branch): a
// player at/below `friendlyRobberVpCeiling` PUBLIC VP can't be named/stolen
// from, using the internal `FRIENDLY_ROBBER_TEST_PROFILE` (the S2.1.5
// liveness-proof precedent — the flag itself stays `false` on every shipping
// preset). Also proves `friendlyRobber:false` (Classic et al.) is byte-
// identical to the pre-S2.2.1 M1 behavior (see `robber.test.ts`, untouched).
//
// NOTE: when EVERY adjacent card-holder is protected, `resolveRobberMove`
// takes the blanket "nobody stealable" no-op path regardless of the named
// `victimId` (mirrors M1's "nobody has cards" no-op). So the tests below that
// specifically exercise the NAMED-victim `VICTIM_PROTECTED` reject always
// keep a second, unprotected, card-holding candidate adjacent too — otherwise
// they'd silently hit the blanket no-op instead of the per-victim check.

import { describe, expect, it } from 'vitest';

import { buildTopology, type TileTopology } from './board.js';
import { reduce } from './reduce.js';
import { FRIENDLY_ROBBER_TEST_PROFILE_ID, type RuleProfileId } from './ruleProfile.js';
import type { BoardState, GameState, PlayerState, RobberMovedEvent } from './types.js';
import { validate } from './validate.js';

const SEED = 'skervik-friendly-robber-seed-1';
const FRIENDLY = FRIENDLY_ROBBER_TEST_PROFILE_ID as RuleProfileId;

const topology = buildTopology();
const tileR = topology.tiles[0] as TileTopology; // robber's current tile
const tileT = topology.tiles[1] as TileTopology; // relocation target
const tileX = topology.tiles[2] as TileTopology; // elsewhere on the board — VP-boosting only, never adjacent to tileT

function makePlayer(id: string, resources: Record<string, number> = {}): PlayerState {
  return { id, name: id, victoryPoints: 0, resources };
}

function makeBoard(robberTileId: string): BoardState {
  return { tileKinds: {}, tileTokens: {}, portContents: [], robberTileId };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    matchId: 'match-friendly-robber-1',
    phase: 'robber',
    turn: 3,
    profileId: FRIENDLY,
    currentPlayerId: 'player-1',
    players: [
      makePlayer('player-1'),
      makePlayer('player-2', { timber: 3 }),
      makePlayer('player-3', { iron: 2 }),
    ],
    eventIndex: 20,
    seedHash: 'deadbeef',
    board: makeBoard(tileR.id),
    buildings: {
      settlements: { [tileT.vertexIds[0] as string]: 'player-2' },
      roads: {},
      cities: { [tileT.vertexIds[1] as string]: 'player-3' },
    },
    ...overrides,
  };
}

describe('friendlyRobber (S2.2.1)', () => {
  it('rejects VICTIM_PROTECTED for a named victim at/below the public-VP ceiling', () => {
    // player-2: 1 settlement on tileT = 1 public VP <= ceiling(2) -> protected.
    // player-3: boosted to 3 public VP (city on tileT + settlement on tileX,
    // elsewhere) so the "everyone protected" blanket no-op does NOT apply —
    // this isolates the per-victim VICTIM_PROTECTED check.
    const state = makeState({
      buildings: {
        settlements: {
          [tileT.vertexIds[0] as string]: 'player-2',
          [tileX.vertexIds[0] as string]: 'player-3',
        },
        roads: {},
        cities: { [tileT.vertexIds[1] as string]: 'player-3' },
      },
    });

    const result = validate(
      state,
      {
        type: 'intent.moveRobber',
        playerId: 'player-1',
        tileId: tileT.id,
        victimId: 'player-2',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'VICTIM_PROTECTED' });
  });

  it('rejects VICTIM_PROTECTED for a victim exactly AT the ceiling (2 public VP, "<=")', () => {
    // player-3: 1 city on tileT = 2 public VP == ceiling(2) -> still protected.
    // player-2: boosted to 3 public VP (settlement on tileT + city on tileX)
    // so the blanket no-op doesn't mask the per-victim check.
    const state = makeState({
      buildings: {
        settlements: { [tileT.vertexIds[0] as string]: 'player-2' },
        roads: {},
        cities: {
          [tileT.vertexIds[1] as string]: 'player-3',
          [tileX.vertexIds[0] as string]: 'player-2',
        },
      },
    });

    const result = validate(
      state,
      {
        type: 'intent.moveRobber',
        playerId: 'player-1',
        tileId: tileT.id,
        victimId: 'player-3',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'VICTIM_PROTECTED' });
  });

  it('clean no-steal (still relocates) when the ONLY adjacent card-holder is protected', () => {
    const state = makeState({
      players: [
        makePlayer('player-1'),
        makePlayer('player-2', { timber: 3 }), // 1 public VP, protected
        makePlayer('player-3'), // no cards -> not even eligibleWithCards
      ],
    });
    const result = validate(
      state,
      { type: 'intent.moveRobber', playerId: 'player-1', tileId: tileT.id },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    const event = result.events[0] as RobberMovedEvent;
    expect(event.stolenFrom).toBeUndefined();
    expect(event.stolenResource).toBeUndefined();

    const next = reduce(state, event);
    expect(next.board?.robberTileId).toBe(tileT.id); // the move itself stays legal
  });

  it('CAN steal from a player above the ceiling (3+ public VP)', () => {
    // player-3: city on tileT (2) + settlement on tileX (1) = 3 public VP,
    // unprotected. player-2 stays protected but is simply not named.
    const state = makeState({
      buildings: {
        settlements: {
          [tileT.vertexIds[0] as string]: 'player-2',
          [tileX.vertexIds[0] as string]: 'player-3',
        },
        roads: {},
        cities: { [tileT.vertexIds[1] as string]: 'player-3' },
      },
    });

    const result = validate(
      state,
      {
        type: 'intent.moveRobber',
        playerId: 'player-1',
        tileId: tileT.id,
        victimId: 'player-3',
      },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    const event = result.events[0] as RobberMovedEvent;
    expect(event.stolenFrom).toBe('player-3');
    expect(event.stolenResource).toBe('iron'); // player-3's whole hand is iron
  });

  it('no leak: a player with 2 public VP + a hidden VP dev card is STILL protected', () => {
    // player-3: 1 city on tileT = 2 public VP (protected) + a hidden
    // `victoryPoint` dev card (true VP would be 3, steal-eligible if the gate
    // leaked hidden VP). player-2 boosted above the ceiling so the blanket
    // no-op doesn't mask the per-victim check.
    const state = makeState({
      buildings: {
        settlements: { [tileT.vertexIds[0] as string]: 'player-2' },
        roads: {},
        cities: {
          [tileT.vertexIds[1] as string]: 'player-3',
          [tileX.vertexIds[0] as string]: 'player-2',
        },
      },
      devCards: {
        'player-3': { held: { victoryPoint: 1 }, boughtThisTurn: {} },
      },
    });

    const result = validate(
      state,
      {
        type: 'intent.moveRobber',
        playerId: 'player-1',
        tileId: tileT.id,
        victimId: 'player-3',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'VICTIM_PROTECTED' });
  });

  it('no eligible victim (nobody adjacent holds cards) -> clean no-steal, same as M1', () => {
    const state = makeState({
      players: [makePlayer('player-1'), makePlayer('player-2'), makePlayer('player-3')],
    });
    const result = validate(
      state,
      { type: 'intent.moveRobber', playerId: 'player-1', tileId: tileT.id },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect((result.events[0] as RobberMovedEvent).stolenFrom).toBeUndefined();
  });

  it('the same gate applies to the knight play (shared resolveRobberMove)', () => {
    const state: GameState = {
      matchId: 'match-friendly-robber-knight-1',
      phase: 'main',
      turn: 5,
      profileId: FRIENDLY,
      currentPlayerId: 'player-1',
      players: [
        makePlayer('player-1'),
        makePlayer('player-2', { timber: 2 }), // 1 public VP, protected
        makePlayer('player-3', { iron: 1 }), // boosted below, unprotected
      ],
      eventIndex: 30,
      seedHash: 'deadbeef',
      board: makeBoard(tileR.id),
      buildings: {
        settlements: {
          [tileT.vertexIds[0] as string]: 'player-2',
          [tileX.vertexIds[0] as string]: 'player-3',
        },
        roads: {},
        cities: { [tileT.vertexIds[1] as string]: 'player-3' },
      },
      devCards: { 'player-1': { held: { knight: 1 }, boughtThisTurn: {} } },
    };

    const result = validate(
      state,
      {
        type: 'intent.playDevCard',
        playerId: 'player-1',
        card: 'knight',
        tileId: tileT.id,
        victimId: 'player-2', // 1 public VP, protected
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'VICTIM_PROTECTED' });
  });
});
