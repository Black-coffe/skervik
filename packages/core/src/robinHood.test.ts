// @skervik/core — S2.2.2: the `robinHood` catch-up flag (Option A,
// self-compensation poverty tokens). Exercises the full accrual path
// (`intent.rollDice` -> zero production for a TRAILING player -> the
// system-emitted `poverty.tokensGranted` event) and the discounted bank-trade
// spend, using the internal `ROBIN_HOOD_TEST_PROFILE` (the S2.1.5/S2.2.1
// liveness-proof precedent — the flag itself stays `false` on every shipping
// preset). Also proves `robinHood:false` (Classic et al.) never even computes
// this path — `povertyTokens` never appears, existing roll/bank-trade events
// stay byte-identical to M1/S1.3.3.

import { describe, expect, it } from 'vitest';

import { type BoardTopology, buildTopology, type TileTopology } from './board.js';
import { reduce } from './reduce.js';
import { ROBIN_HOOD_TEST_PROFILE_ID, type RuleProfileId } from './ruleProfile.js';
import type {
  BankTradedEvent,
  BoardState,
  DiceRolledEvent,
  GameState,
  PlayerState,
  PovertyTokensGrantedEvent,
  ResourcesProducedEvent,
} from './types.js';
import { validate } from './validate.js';

const SEED = 'skervik-robin-hood-seed-1';
const ROBIN_HOOD = ROBIN_HOOD_TEST_PROFILE_ID as RuleProfileId;

const topology = buildTopology();

/** N mutually disjoint tiles (no shared vertex) — buildings on one never collide with another's vertex ids. */
function findDisjointTiles(topo: BoardTopology, count: number): TileTopology[] {
  const chosen: TileTopology[] = [];
  for (const candidate of topo.tiles) {
    if (
      chosen.every((tile) => !tile.vertexIds.some((v) => candidate.vertexIds.includes(v)))
    ) {
      chosen.push(candidate);
      if (chosen.length === count) return chosen;
    }
  }
  throw new Error(`fixture bug: could not find ${count} disjoint tiles`);
}

// tileA (token 6, timber) is the sole producing tile under test; tileL/tileM
// host extra (non-producing, desert) settlements purely to shape public VP;
// tileR hosts the robber (never touched by the roll under test).
const [tileA, tileL, tileM, tileR] = findDisjointTiles(topology, 4) as [
  TileTopology,
  TileTopology,
  TileTopology,
  TileTopology,
];

function makePlayer(id: string, resources: Record<string, number> = {}): PlayerState {
  return { id, name: id, victoryPoints: 0, resources };
}

function makeBoard(): BoardState {
  const tileKinds: Record<string, string> = {};
  for (const tile of topology.tiles) {
    tileKinds[tile.id] = tile.id === tileA.id ? 'timber' : 'desert';
  }
  return {
    tileKinds,
    tileTokens: { [tileA.id]: 6 },
    portContents: [],
    robberTileId: tileR.id,
  };
}

const board = makeBoard();
const vertexLeaderProd = tileA.vertexIds[0] as string; // leader's producing settlement
const vertexLeaderExtra = tileL.vertexIds[0] as string; // leader's 2nd settlement (VP only)
const vertexP3 = tileM.vertexIds[0] as string; // player-3's 1-VP settlement (VP only, no production)

/**
 * Genesis: player-2 is the LEADER (2 public VP: settlement on the producing
 * tile + one elsewhere); player-1 is TRAILING (0 public VP, gap 2: 0 <= 2-2);
 * player-3 sits exactly at the trailing boundary's edge (1 public VP: NOT
 * trailing, 1 > 2-2=0) — the "non-trailing gains nothing" control. Rolling
 * total 6 pays ONLY player-2 (the sole owner adjacent to tileA); player-1 and
 * player-3 both get zero from this roll.
 */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    matchId: 'match-robin-hood-1',
    phase: 'roll',
    turn: 1,
    profileId: ROBIN_HOOD,
    currentPlayerId: 'player-1',
    players: [makePlayer('player-1'), makePlayer('player-2'), makePlayer('player-3')],
    eventIndex: 2, // resolves to total 6 with SEED (verified below)
    seedHash: 'deadbeef',
    board,
    buildings: {
      settlements: {
        [vertexLeaderProd]: 'player-2',
        [vertexLeaderExtra]: 'player-2',
        [vertexP3]: 'player-3',
      },
      roads: {},
    },
    ...overrides,
  };
}

describe('robinHood poverty tokens — accrual (S2.2.2)', () => {
  it('sanity: eventIndex 2 resolves to total 6 with SEED', () => {
    const result = validate(
      makeState(),
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect((result.events[0] as DiceRolledEvent).total).toBe(6);
  });

  it('a TRAILING player who gets zero from a non-7 roll earns +1 poverty token', () => {
    const state = makeState();
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');

    expect(result.events).toHaveLength(3); // dice.rolled + resources.produced + poverty.tokensGranted
    const produced = result.events[1] as ResourcesProducedEvent;
    expect(produced.grants).toEqual({ 'player-2': { timber: 1 } }); // only the leader produces
    const povertyEvent = result.events[2] as PovertyTokensGrantedEvent;
    expect(povertyEvent.type).toBe('poverty.tokensGranted');
    expect(povertyEvent.grants).toEqual({ 'player-1': 1 }); // ONLY the trailing player-1

    const next = result.events.reduce(reduce, state);
    expect(next.povertyTokens).toEqual({ 'player-1': 1 });
  });

  it('a NON-trailing player who gets zero from the same roll gains NOTHING', () => {
    // player-3 (1 public VP) is NOT trailing (leader 2 - gap 2 = 0; 1 > 0) —
    // it also gets zero production this roll, yet must not appear in grants.
    const state = makeState();
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    const povertyEvent = result.events[2] as PovertyTokensGrantedEvent;
    expect(povertyEvent.grants['player-3']).toBeUndefined();
  });

  it('accrual is capped at robinHoodTokenCap (3) — no further grant once at the cap', () => {
    const state = makeState({ povertyTokens: { 'player-1': 3 } });
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    // player-1 is the only trailing player and is already at the cap — no
    // poverty grants at all this roll, so no 3rd event is emitted.
    expect(result.events).toHaveLength(2);

    const next = result.events.reduce(reduce, state);
    expect(next.povertyTokens).toEqual({ 'player-1': 3 }); // unchanged, never exceeds the cap
  });

  it('uses PUBLIC VP for trailing — a hidden VP dev card does not lift a player out of trailing (no leak)', () => {
    // player-1 still 0 public VP, but holds a hidden VP card (true VP would be
    // 1) — must STILL be judged trailing (leader 2 - gap 2 = 0; 0 <= 0).
    const state = makeState({
      devCards: { 'player-1': { held: { victoryPoint: 1 }, boughtThisTurn: {} } },
    });
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    const povertyEvent = result.events[2] as PovertyTokensGrantedEvent;
    expect(povertyEvent.grants).toEqual({ 'player-1': 1 });
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
});

/** Drops `profileId` entirely (never sets it to `undefined` — `exactOptionalPropertyTypes`) so the state resolves to Classic's default `robinHood:false`. */
function withoutProfileId(state: GameState): GameState {
  const { profileId: _profileId, ...rest } = state;
  return rest;
}

describe('robinHood:false — byte-identical to M1 (S2.2.2)', () => {
  it('the SAME trailing+zero-roll scenario emits NO poverty event and never writes povertyTokens when robinHood is off', () => {
    const state = withoutProfileId(makeState()); // resolves to 'classic', robinHood:false
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(2); // dice.rolled + resources.produced only

    const next = result.events.reduce(reduce, state);
    expect(next.povertyTokens).toBeUndefined();
    expect(Object.keys(next)).not.toContain('povertyTokens');
  });
});

describe('robinHood discounted bank trade — spend (S2.2.2)', () => {
  // `tokens: null` requests a state with NO `povertyTokens` key at all (never
  // `povertyTokens: undefined` — `exactOptionalPropertyTypes` forbids setting
  // an optional property to explicit `undefined`).
  function makeTradeState(
    tokens: Readonly<Record<string, number>> | null = { 'player-1': 1 },
  ): GameState {
    const base = {
      matchId: 'match-robin-hood-trade-1',
      phase: 'main' as const,
      turn: 4,
      profileId: ROBIN_HOOD,
      currentPlayerId: 'player-1',
      players: [
        makePlayer('player-1', { timber: 8, iron: 8 }), // trailing, 0 public VP
        makePlayer('player-2', { timber: 8, iron: 8 }), // leader, 2 public VP
        makePlayer('player-3', { timber: 8, iron: 8 }),
      ],
      eventIndex: 40,
      seedHash: 'deadbeef',
      board,
      buildings: {
        settlements: {
          [vertexLeaderProd]: 'player-2',
          [vertexLeaderExtra]: 'player-2',
        },
        roads: {},
      },
    };
    return tokens ? { ...base, povertyTokens: tokens } : base;
  }

  it('a poverty token enables the discounted rate and is consumed by the trade', () => {
    const state = makeTradeState();
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 2, // robinHoodExchangeRate, not the base 4:1 (no port owned)
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    const event = result.events[0] as BankTradedEvent;
    expect(event.povertyDiscount).toBe(true);
    expect(event.count).toBe(2);

    const next = reduce(state, event);
    expect(next.players.find((p) => p.id === 'player-1')?.resources).toMatchObject({
      timber: 6, // 8 - 2
      iron: 9, // 8 + 1
    });
    expect(next.povertyTokens).toBeUndefined(); // drop-key-if-zero + whole-key-dropped
  });

  it('rejects the discounted rate with 0 tokens', () => {
    const state = makeTradeState(null);
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 2,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'WRONG_RATE_COUNT' });
  });

  it('rejects the discounted rate for a non-trailing player even holding a token', () => {
    // player-2 is the LEADER (2 public VP) — never trailing — even though we
    // hand it a token directly (shouldn't happen via accrual, but the
    // legality gate must still hold defensively).
    const state: GameState = {
      ...makeTradeState({ 'player-2': 1 }),
      currentPlayerId: 'player-2',
    };
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-2',
        give: 'timber',
        count: 2,
        get: 'iron',
      },
      'player-2',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'WRONG_RATE_COUNT' });
  });

  it('normal (non-discounted) bank trade is unaffected by holding a token', () => {
    const state = makeTradeState();
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 4, // base rate — no port owned
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    const event = result.events[0] as BankTradedEvent;
    expect(event.povertyDiscount).toBeUndefined();

    const next = reduce(state, event);
    expect(next.povertyTokens).toEqual({ 'player-1': 1 }); // untouched — no discount used
  });

  it('robinHood:false — the discounted count is simply WRONG_RATE_COUNT (byte-identical to M1)', () => {
    const state = withoutProfileId(makeTradeState(null));
    const result = validate(
      state,
      {
        type: 'intent.bankTrade',
        playerId: 'player-1',
        give: 'timber',
        count: 2,
        get: 'iron',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'WRONG_RATE_COUNT' });
  });
});
