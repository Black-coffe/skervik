// @skervik/core — S1.3.2: player<->player trade (offer / counter / accept,
// atomic swap). Exercises the full `intent.proposeTrade` / `acceptTrade` /
// `rejectTrade` / `counterTrade` / `cancelTrade` -> `validate` -> events ->
// `reduce` pipeline: the one-open-offer state slot, the ATOMIC swap (both
// hands move in a single `trade.executed` event, conservation asserted),
// the bounded counter-offer (depth 0 -> 1, no further chaining), the
// non-current-player carve-out for responses, and one negative test per new
// S1.3.2 reject reason.

import { describe, expect, it } from 'vitest';

import { reduce } from './reduce.js';
import type { RuleProfileId } from './ruleProfile.js';
import { PARALLEL_TRADE_TEST_PROFILE_ID } from './ruleProfile.js';
import type { GameEvent, GameState, PlayerState, TradeExecutedEvent } from './types.js';
import { validate } from './validate.js';

// No RNG in this story (pure resource logic) — passed only as `validate`'s
// 4th param, per the engine contract (A1).
const SEED = 'skervik-trade-seed-1';

function makePlayer(id: string, resources: Record<string, number> = {}): PlayerState {
  return { id, name: id, victoryPoints: 0, resources };
}

/**
 * Genesis for trade tests: 3 players in the main phase, `player-1` current.
 * `player-1` holds `timber`/`clay` to give; `player-2` holds `ore`,
 * `player-3` holds `fleece` — enough for both sides of a trade to be
 * exercised without touching the bank (this story is pure player<->player).
 */
function makeTradeState(overrides: Partial<GameState> = {}): GameState {
  return {
    matchId: 'match-trade-1',
    phase: 'main',
    turn: 3,
    currentPlayerId: 'player-1',
    players: [
      makePlayer('player-1', { timber: 3, clay: 1 }),
      makePlayer('player-2', { ore: 2 }),
      makePlayer('player-3', { fleece: 1 }),
    ],
    playerOrder: ['player-1', 'player-2', 'player-3'],
    eventIndex: 10,
    seedHash: 'deadbeef',
    ...overrides,
  };
}

/** Total resource-card count across every player — the conservation measure. */
function totalResources(state: GameState): number {
  return state.players.reduce(
    (sum, player) =>
      sum +
      Object.values(player.resources).reduce((lineSum, amount) => lineSum + amount, 0),
    0,
  );
}

describe('intent.proposeTrade (S1.3.2)', () => {
  it('opens an offer targeting all other players, at depth 0', () => {
    const state = makeTradeState();
    const result = validate(
      state,
      {
        type: 'intent.proposeTrade',
        playerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
      },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toEqual([
      {
        type: 'trade.offered',
        index: state.eventIndex,
        proposerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
        targets: ['player-2', 'player-3'],
        depth: 0,
      },
    ]);

    const next = reduce(state, result.events[0] as GameEvent);
    expect(next.openTradeOffer).toEqual({
      proposerId: 'player-1',
      give: { timber: 1 },
      get: { ore: 1 },
      targets: ['player-2', 'player-3'],
      depth: 0,
    });
  });

  it('rejects NOT_YOUR_TURN when a non-current player proposes', () => {
    const result = validate(
      makeTradeState(),
      {
        type: 'intent.proposeTrade',
        playerId: 'player-2',
        give: { ore: 1 },
        get: { timber: 1 },
      },
      'player-2',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
  });

  it('rejects CANNOT_AFFORD when the proposer cannot cover give', () => {
    const result = validate(
      makeTradeState(),
      {
        type: 'intent.proposeTrade',
        playerId: 'player-1',
        give: { iron: 1 },
        get: { ore: 1 },
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'CANNOT_AFFORD' });
  });

  it('rejects MALFORMED_INTENT for an empty bundle', () => {
    const result = validate(
      makeTradeState(),
      { type: 'intent.proposeTrade', playerId: 'player-1', give: {}, get: { ore: 1 } },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'MALFORMED_INTENT' });
  });

  it('rejects MALFORMED_INTENT for a non-positive amount', () => {
    const result = validate(
      makeTradeState(),
      {
        type: 'intent.proposeTrade',
        playerId: 'player-1',
        give: { timber: 0 },
        get: { ore: 1 },
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'MALFORMED_INTENT' });
  });

  it('rejects TRADE_OFFER_ALREADY_OPEN when one is already open', () => {
    const state = makeTradeState({
      openTradeOffer: {
        proposerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
        targets: ['player-2', 'player-3'],
        depth: 0,
      },
    });
    const result = validate(
      state,
      {
        type: 'intent.proposeTrade',
        playerId: 'player-1',
        give: { clay: 1 },
        get: { fleece: 1 },
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'TRADE_OFFER_ALREADY_OPEN' });
  });

  it('rejects MUST_ROLL_FIRST from the roll phase (trades are main-phase only)', () => {
    const result = validate(
      makeTradeState({ phase: 'roll' }),
      {
        type: 'intent.proposeTrade',
        playerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'MUST_ROLL_FIRST' });
  });
});

describe('intent.acceptTrade — atomic swap (S1.3.2)', () => {
  const offerState = (): GameState =>
    makeTradeState({
      openTradeOffer: {
        proposerId: 'player-1',
        give: { timber: 2 },
        get: { ore: 1 },
        targets: ['player-2', 'player-3'],
        depth: 0,
      },
    });

  it('emits ONE trade.executed event carrying both concrete bundles + both party ids', () => {
    const state = offerState();
    const result = validate(
      state,
      { type: 'intent.acceptTrade', playerId: 'player-2' },
      'player-2',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toEqual([
      {
        type: 'trade.executed',
        index: state.eventIndex,
        proposerId: 'player-1',
        accepterId: 'player-2',
        give: { timber: 2 },
        get: { ore: 1 },
      },
    ]);
  });

  it('applies both hands in the single reduce step — no half-applied mid-state, offer closes, conservation holds', () => {
    const state = offerState();
    const event: TradeExecutedEvent = {
      type: 'trade.executed',
      index: state.eventIndex,
      proposerId: 'player-1',
      accepterId: 'player-2',
      give: { timber: 2 },
      get: { ore: 1 },
    };

    const next = reduce(state, event);

    expect(next.players.find((p) => p.id === 'player-1')?.resources).toEqual({
      timber: 1,
      clay: 1,
      ore: 1,
    });
    expect(next.players.find((p) => p.id === 'player-2')?.resources).toEqual({
      ore: 1,
      timber: 2,
    });
    expect(next.players.find((p) => p.id === 'player-3')?.resources).toEqual({
      fleece: 1,
    }); // untouched
    expect(next.openTradeOffer).toBeUndefined();

    // Conservation (S1.3.2 spec): the swap moves cards, never creates/destroys any.
    expect(totalResources(next)).toBe(totalResources(state));
  });

  it('never mutates its input state', () => {
    const state = offerState();
    const before: GameState = JSON.parse(JSON.stringify(state)) as GameState;
    const event: TradeExecutedEvent = {
      type: 'trade.executed',
      index: state.eventIndex,
      proposerId: 'player-1',
      accepterId: 'player-2',
      give: { timber: 2 },
      get: { ore: 1 },
    };

    reduce(state, event);

    expect(state).toEqual(before);
  });

  it('rejects CANNOT_AFFORD when the accepter cannot cover get', () => {
    const result = validate(
      offerState(),
      { type: 'intent.acceptTrade', playerId: 'player-3' }, // player-3 holds no ore
      'player-3',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'CANNOT_AFFORD' });
  });

  it('rejects CANNOT_AFFORD when the proposer can no longer cover give (spent since the offer opened)', () => {
    const state = offerState();
    const poorProposer: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.id === 'player-1' ? { ...p, resources: {} } : p,
      ),
    };
    const result = validate(
      poorProposer,
      { type: 'intent.acceptTrade', playerId: 'player-2' },
      'player-2',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'CANNOT_AFFORD' });
  });

  it('rejects NOT_A_TRADE_TARGET for a player not named in targets', () => {
    const state = makeTradeState({
      openTradeOffer: {
        proposerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
        targets: ['player-2'], // player-3 excluded
        depth: 0,
      },
    });
    const result = validate(
      state,
      { type: 'intent.acceptTrade', playerId: 'player-3' },
      'player-3',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_A_TRADE_TARGET' });
  });

  it('rejects NO_OPEN_TRADE_OFFER when nothing is open', () => {
    const result = validate(
      makeTradeState(),
      { type: 'intent.acceptTrade', playerId: 'player-2' },
      'player-2',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NO_OPEN_TRADE_OFFER' });
  });

  it('is legal for a non-current player (a target) — the top-level currentPlayer guard is carved out', () => {
    const result = validate(
      offerState(),
      { type: 'intent.acceptTrade', playerId: 'player-2' },
      'player-2',
      SEED,
    );
    expect(result.ok).toBe(true);
  });
});

describe('intent.rejectTrade (S1.3.2)', () => {
  const offerState = (): GameState =>
    makeTradeState({
      openTradeOffer: {
        proposerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
        targets: ['player-2', 'player-3'],
        depth: 0,
      },
    });

  it('narrows targets, leaving the offer open while a target remains', () => {
    const state = offerState();
    const result = validate(
      state,
      { type: 'intent.rejectTrade', playerId: 'player-2' },
      'player-2',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    const next = reduce(state, result.events[0] as GameEvent);
    expect(next.openTradeOffer?.targets).toEqual(['player-3']);
  });

  it('closes the offer once every target has rejected', () => {
    let state = offerState();

    const first = validate(
      state,
      { type: 'intent.rejectTrade', playerId: 'player-2' },
      'player-2',
      SEED,
    );
    if (!first.ok) throw new Error('expected ok result');
    state = reduce(state, first.events[0] as GameEvent);

    const second = validate(
      state,
      { type: 'intent.rejectTrade', playerId: 'player-3' },
      'player-3',
      SEED,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('expected ok result');
    state = reduce(state, second.events[0] as GameEvent);

    expect(state.openTradeOffer).toBeUndefined();
  });

  it('rejects NOT_A_TRADE_TARGET for the proposer trying to reject their own offer', () => {
    const result = validate(
      offerState(),
      { type: 'intent.rejectTrade', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_A_TRADE_TARGET' });
  });
});

describe('intent.counterTrade — bounded (S1.3.2)', () => {
  const offerState = (): GameState =>
    makeTradeState({
      openTradeOffer: {
        proposerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 2 },
        targets: ['player-2', 'player-3'],
        depth: 0,
      },
    });

  it('opens a swapped-role offer at depth 1, targeting only the original proposer', () => {
    const state = offerState();
    const result = validate(
      state,
      {
        type: 'intent.counterTrade',
        playerId: 'player-2',
        give: { ore: 1 },
        get: { timber: 1 },
      },
      'player-2',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toEqual([
      {
        type: 'trade.offered',
        index: state.eventIndex,
        proposerId: 'player-2',
        give: { ore: 1 },
        get: { timber: 1 },
        targets: ['player-1'],
        depth: 1,
      },
    ]);

    const next = reduce(state, result.events[0] as GameEvent);
    expect(next.openTradeOffer).toEqual({
      proposerId: 'player-2',
      give: { ore: 1 },
      get: { timber: 1 },
      targets: ['player-1'],
      depth: 1,
    });
  });

  it('rejects TRADE_COUNTER_LIMIT_REACHED for a second counter (depth 1 -> 2)', () => {
    const countered = makeTradeState({
      openTradeOffer: {
        proposerId: 'player-2',
        give: { ore: 1 },
        get: { timber: 1 },
        targets: ['player-1'],
        depth: 1,
      },
    });
    const result = validate(
      countered,
      {
        type: 'intent.counterTrade',
        playerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'TRADE_COUNTER_LIMIT_REACHED' });
  });

  it("rejects NOT_A_TRADE_TARGET for the current offer's own proposer trying to counter it", () => {
    const result = validate(
      offerState(),
      {
        type: 'intent.counterTrade',
        playerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_A_TRADE_TARGET' });
  });

  it('rejects CANNOT_AFFORD when the counterer cannot cover their own give', () => {
    const result = validate(
      offerState(),
      {
        type: 'intent.counterTrade',
        playerId: 'player-3',
        give: { iron: 1 },
        get: { timber: 1 },
      },
      'player-3',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'CANNOT_AFFORD' });
  });
});

describe('intent.cancelTrade (S1.3.2)', () => {
  it("the offer's own proposer may cancel while open", () => {
    const state = makeTradeState({
      openTradeOffer: {
        proposerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
        targets: ['player-2', 'player-3'],
        depth: 0,
      },
    });
    const result = validate(
      state,
      { type: 'intent.cancelTrade', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    const next = reduce(state, result.events[0] as GameEvent);
    expect(next.openTradeOffer).toBeUndefined();
  });

  it('a counter-offer is cancellable by the countering (non-current) player', () => {
    const state = makeTradeState({
      openTradeOffer: {
        proposerId: 'player-2', // countered — this offer's proposer is a non-current player
        give: { ore: 1 },
        get: { timber: 1 },
        targets: ['player-1'],
        depth: 1,
      },
    });
    const result = validate(
      state,
      { type: 'intent.cancelTrade', playerId: 'player-2' },
      'player-2',
      SEED,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects NOT_TRADE_PROPOSER for a non-proposer — even the current player', () => {
    const state = makeTradeState({
      openTradeOffer: {
        proposerId: 'player-2',
        give: { ore: 1 },
        get: { timber: 1 },
        targets: ['player-1'],
        depth: 1,
      },
    });
    const result = validate(
      state,
      { type: 'intent.cancelTrade', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_TRADE_PROPOSER' });
  });

  it('rejects NO_OPEN_TRADE_OFFER when nothing is open', () => {
    const result = validate(
      makeTradeState(),
      { type: 'intent.cancelTrade', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NO_OPEN_TRADE_OFFER' });
  });
});

describe('turn.ended implicitly closes any open offer (S1.3.2)', () => {
  it('drops openTradeOffer when the turn ends', () => {
    const state = makeTradeState({
      openTradeOffer: {
        proposerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
        targets: ['player-2', 'player-3'],
        depth: 0,
      },
    });
    const next = reduce(state, {
      type: 'turn.ended',
      index: state.eventIndex,
      playerId: 'player-1',
      nextPlayerId: 'player-2',
    });
    expect(next.openTradeOffer).toBeUndefined();
  });
});

describe('full scripted flow: propose -> counter -> accept, with replay determinism (S1.3.2)', () => {
  it('offer -> counter -> accept resolves the atomic swap and replays byte-for-byte', () => {
    const genesis = makeTradeState();
    let state = genesis;
    const events: GameEvent[] = [];
    function apply(playerId: string, intent: Parameters<typeof validate>[1]): void {
      const result = validate(state, intent, playerId, SEED);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected ok result for ${intent.type}`);
      state = result.events.reduce(reduce, state);
      events.push(...result.events);
    }

    apply('player-1', {
      type: 'intent.proposeTrade',
      playerId: 'player-1',
      give: { timber: 2 },
      get: { ore: 2 },
    });
    expect(state.openTradeOffer?.depth).toBe(0);

    apply('player-2', {
      type: 'intent.counterTrade',
      playerId: 'player-2',
      give: { ore: 1 },
      get: { timber: 1 },
    });
    expect(state.openTradeOffer).toEqual({
      proposerId: 'player-2',
      give: { ore: 1 },
      get: { timber: 1 },
      targets: ['player-1'],
      depth: 1,
    });

    apply('player-1', { type: 'intent.acceptTrade', playerId: 'player-1' });
    expect(state.openTradeOffer).toBeUndefined();
    expect(state.players.find((p) => p.id === 'player-1')?.resources).toEqual({
      timber: 2,
      clay: 1,
      ore: 1,
    });
    expect(state.players.find((p) => p.id === 'player-2')?.resources).toEqual({
      ore: 1,
      timber: 1,
    });
    expect(totalResources(state)).toBe(totalResources(genesis));

    // Replay: folding the exact same recorded events from genesis reproduces
    // this final state byte-for-byte — no re-derivation, no ambient state.
    const replayed = events.reduce(reduce, genesis);
    expect(replayed).toEqual(state);
  });
});

// S2.1.5 — parallel phases: concurrent trade offers, gated by the
// `parallelTrade` profile flag. Driven under the internal, NON-shipping
// `PARALLEL_TRADE_TEST_PROFILE` (Classic + `parallelTrade: true`) — no shipping
// preset enables the flag until the client multi-offer HUD lands, so this
// proves the config path without shipping the mode (the S2.1.1 precedent). The
// M1 single-offer suites above stay behaviorally UNCHANGED — the byte-freeze
// proof that the flag-off path is untouched.
describe('parallel trade — concurrent offers (S2.1.5, parallelTrade:true)', () => {
  // Cast: `profileId` is typed `RuleProfileId`, which deliberately EXCLUDES this
  // internal test-only id — the registry key still resolves it via `loadRuleProfile`.
  const PARALLEL = PARALLEL_TRADE_TEST_PROFILE_ID as RuleProfileId;

  function makeParallelState(overrides: Partial<GameState> = {}): GameState {
    return makeTradeState({ profileId: PARALLEL, ...overrides });
  }

  /** Drive validate -> reduce, mutating a local `state` (mirrors the M1 scripted flow). */
  function makeApply(getState: () => GameState, setState: (s: GameState) => void) {
    return function apply(
      playerId: string,
      intent: Parameters<typeof validate>[1],
    ): void {
      const result = validate(getState(), intent, playerId, SEED);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected ok result for ${intent.type}`);
      setState(result.events.reduce(reduce, getState()));
    };
  }

  it('proposeTrade populates openTradeOffers (not the singular field), one per proposer', () => {
    const state = makeParallelState();
    const result = validate(
      state,
      {
        type: 'intent.proposeTrade',
        playerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
      },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    const next = result.events.reduce(reduce, state);

    // The parallel field carries it; the singular (client-read) field stays absent.
    expect(next.openTradeOffer).toBeUndefined();
    expect(next.openTradeOffers).toEqual([
      {
        proposerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
        targets: ['player-2', 'player-3'],
        depth: 0,
      },
    ]);
  });

  it('rejects TRADE_OFFER_ALREADY_OPEN only when the SAME proposer already has an open offer', () => {
    const state = makeParallelState({
      openTradeOffers: [
        {
          proposerId: 'player-1',
          give: { timber: 1 },
          get: { ore: 1 },
          targets: ['player-2', 'player-3'],
          depth: 0,
        },
      ],
    });
    // player-1 already has one open -> rejected (per-proposer cap).
    const again = validate(
      state,
      {
        type: 'intent.proposeTrade',
        playerId: 'player-1',
        give: { clay: 1 },
        get: { fleece: 1 },
      },
      'player-1',
      SEED,
    );
    expect(again).toEqual({ ok: false, reason: 'TRADE_OFFER_ALREADY_OPEN' });
  });

  it('holds TWO concurrent offers from different proposers; accepting ONE swaps atomically and leaves the OTHER intact', () => {
    let state = makeParallelState();
    const apply = makeApply(
      () => state,
      (s) => {
        state = s;
      },
    );

    // player-1 (current) proposes offer A; player-2 counters -> offer B. Two
    // proposers now hold concurrent open offers (A survives the counter).
    apply('player-1', {
      type: 'intent.proposeTrade',
      playerId: 'player-1',
      give: { timber: 1 },
      get: { ore: 1 },
    });
    apply('player-2', {
      type: 'intent.counterTrade',
      playerId: 'player-2',
      offerProposerId: 'player-1',
      give: { ore: 1 },
      get: { timber: 1 },
    });
    expect(state.openTradeOffers?.map((o) => o.proposerId)).toEqual([
      'player-1',
      'player-2',
    ]);

    const before = totalResources(state);

    // player-1 accepts offer B (the counter) -> atomic swap between player-2
    // (proposer) and player-1 (accepter). Offer A must survive untouched.
    apply('player-1', {
      type: 'intent.acceptTrade',
      playerId: 'player-1',
      offerProposerId: 'player-2',
    });

    expect(state.players.find((p) => p.id === 'player-1')?.resources).toEqual({
      timber: 2,
      clay: 1,
      ore: 1,
    });
    expect(state.players.find((p) => p.id === 'player-2')?.resources).toEqual({
      ore: 1,
      timber: 1,
    });
    expect(state.players.find((p) => p.id === 'player-3')?.resources).toEqual({
      fleece: 1,
    });
    // Offer A alone remains, byte-identical to when it opened.
    expect(state.openTradeOffers).toEqual([
      {
        proposerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
        targets: ['player-2', 'player-3'],
        depth: 0,
      },
    ]);
    // Conservation across the swap: cards move, none created/destroyed.
    expect(totalResources(state)).toBe(before);
  });

  it('applies the per-offer counter-depth bound INDEPENDENTLY per offer', () => {
    // Two offers: A at depth 0 (still counterable), B at depth 1 (bound reached).
    const state = makeParallelState({
      players: [
        makePlayer('player-1', { timber: 3, clay: 1 }),
        makePlayer('player-2', { ore: 2 }),
        makePlayer('player-3', { fleece: 1 }),
      ],
      openTradeOffers: [
        {
          proposerId: 'player-1',
          give: { timber: 1 },
          get: { ore: 1 },
          targets: ['player-2', 'player-3'],
          depth: 0,
        },
        {
          proposerId: 'player-2',
          give: { ore: 1 },
          get: { timber: 1 },
          targets: ['player-1'],
          depth: 1,
        },
      ],
    });

    // Countering offer A (depth 0) is allowed — player-3 becomes a new proposer.
    const counterA = validate(
      state,
      {
        type: 'intent.counterTrade',
        playerId: 'player-3',
        offerProposerId: 'player-1',
        give: { fleece: 1 },
        get: { timber: 1 },
      },
      'player-3',
      SEED,
    );
    expect(counterA.ok).toBe(true);

    // Countering offer B (already depth 1) hits the bound — per offer, not global.
    const counterB = validate(
      state,
      {
        type: 'intent.counterTrade',
        playerId: 'player-1',
        offerProposerId: 'player-2',
        give: { timber: 1 },
        get: { ore: 1 },
      },
      'player-1',
      SEED,
    );
    expect(counterB).toEqual({ ok: false, reason: 'TRADE_COUNTER_LIMIT_REACHED' });
  });

  it('an offer made unaffordable by an intervening swap fails to execute (no stale swap)', () => {
    let state = makeParallelState({
      players: [
        makePlayer('player-1', { timber: 3, clay: 1 }),
        makePlayer('player-2', { ore: 2 }),
        makePlayer('player-3', { fleece: 1 }),
      ],
      openTradeOffers: [
        // A: player-1 wants 2 ore for 1 timber, offered to everyone.
        {
          proposerId: 'player-1',
          give: { timber: 1 },
          get: { ore: 2 },
          targets: ['player-2', 'player-3'],
          depth: 0,
        },
        // B: player-2 will give BOTH their ore (2) for 1 timber.
        {
          proposerId: 'player-2',
          give: { ore: 2 },
          get: { timber: 1 },
          targets: ['player-1'],
          depth: 1,
        },
      ],
    });
    const apply = makeApply(
      () => state,
      (s) => {
        state = s;
      },
    );

    // player-1 accepts B: player-2 spends BOTH ore (-> ore: 0). Offer A, which
    // needs the ACCEPTER to pay 2 ore, is now unaffordable for player-2.
    apply('player-1', {
      type: 'intent.acceptTrade',
      playerId: 'player-1',
      offerProposerId: 'player-2',
    });
    // `subtractResources` leaves a 0 entry rather than deleting the key (the
    // debit convention every other event follows) — player-2 now holds no ore.
    expect(state.players.find((p) => p.id === 'player-2')?.resources).toEqual({
      ore: 0,
      timber: 1,
    });

    const snapshot = totalResources(state);
    const stale = validate(
      state,
      { type: 'intent.acceptTrade', playerId: 'player-2', offerProposerId: 'player-1' },
      'player-2',
      SEED,
    );
    expect(stale).toEqual({ ok: false, reason: 'CANNOT_AFFORD' });
    // No swap emitted, so nothing moved — conservation intact, offer A still open.
    expect(totalResources(state)).toBe(snapshot);
    expect(state.openTradeOffers?.map((o) => o.proposerId)).toEqual(['player-1']);
  });

  it('rejectTrade narrows only the named offer; the others are untouched', () => {
    const state = makeParallelState({
      openTradeOffers: [
        {
          proposerId: 'player-1',
          give: { timber: 1 },
          get: { ore: 1 },
          targets: ['player-2', 'player-3'],
          depth: 0,
        },
        {
          proposerId: 'player-2',
          give: { ore: 1 },
          get: { timber: 1 },
          targets: ['player-1', 'player-3'],
          depth: 0,
        },
      ],
    });
    const result = validate(
      state,
      { type: 'intent.rejectTrade', playerId: 'player-3', offerProposerId: 'player-1' },
      'player-3',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    const next = result.events.reduce(reduce, state);
    // Offer A lost player-3 from its targets; offer B is unchanged.
    expect(next.openTradeOffers).toEqual([
      {
        proposerId: 'player-1',
        give: { timber: 1 },
        get: { ore: 1 },
        targets: ['player-2'],
        depth: 0,
      },
      {
        proposerId: 'player-2',
        give: { ore: 1 },
        get: { timber: 1 },
        targets: ['player-1', 'player-3'],
        depth: 0,
      },
    ]);
  });

  it('cancelTrade withdraws only the canceller’s own offer', () => {
    const state = makeParallelState({
      openTradeOffers: [
        {
          proposerId: 'player-1',
          give: { timber: 1 },
          get: { ore: 1 },
          targets: ['player-2', 'player-3'],
          depth: 0,
        },
        {
          proposerId: 'player-2',
          give: { ore: 1 },
          get: { timber: 1 },
          targets: ['player-1'],
          depth: 1,
        },
      ],
    });
    const result = validate(
      state,
      { type: 'intent.cancelTrade', playerId: 'player-2', offerProposerId: 'player-2' },
      'player-2',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    const next = result.events.reduce(reduce, state);
    expect(next.openTradeOffers?.map((o) => o.proposerId)).toEqual(['player-1']);
  });

  it('turn.ended clears ALL open offers (both fields)', () => {
    const state = makeParallelState({
      openTradeOffers: [
        {
          proposerId: 'player-1',
          give: { timber: 1 },
          get: { ore: 1 },
          targets: ['player-2', 'player-3'],
          depth: 0,
        },
        {
          proposerId: 'player-2',
          give: { ore: 1 },
          get: { timber: 1 },
          targets: ['player-1'],
          depth: 1,
        },
      ],
    });
    const next = reduce(state, {
      type: 'turn.ended',
      index: state.eventIndex,
      playerId: 'player-1',
      nextPlayerId: 'player-2',
    });
    expect(next.openTradeOffers).toBeUndefined();
    expect(next.openTradeOffer).toBeUndefined();
  });
});
