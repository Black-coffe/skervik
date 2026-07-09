// @skervik/core — S2.2.4: the `eventTiles` catch-up flag (a deterministic
// poverty-token boost on a SUBSET of 7-rolls, REUSING the S2.2.2 machinery
// verbatim — `computePovertyGrants`, the `poverty.tokensGranted` event/reducer,
// the shared `povertyTokens` pool + `robinHoodTokenCap`). Exercises the cadence
// (`sevensRolled` counter -> `eventStorm` check via
// `EVENT_TILES_ROBIN_HOOD_TEST_PROFILE`, interval 2), grant-to-trailing-only +
// the shared cap, the shared-pool tests below, the forced-roll no-hang
// guarantee, and the `eventTiles:false` byte-freeze — the
// S2.1.5/S2.2.1/S2.2.2/S2.2.3 liveness-proof precedent: both flags stay off on
// every shipping preset. There is no `eventTiles`-alone fixture (S2.2.6,
// guard G2): `eventTiles:true` with `robinHood:false` grants poverty tokens
// nobody can ever spend, so `validateRuleProfile` rejects that combination —
// every test below uses the combined fixture, which does not change the
// GRANT assertions (the storm-cadence grant path is not gated on `robinHood`;
// only SPENDING a token is).

import { describe, expect, it } from 'vitest';

import { reduce } from './reduce.js';
import {
  EVENT_TILES_ROBIN_HOOD_TEST_PROFILE_ID,
  type RuleProfileId,
} from './ruleProfile.js';
import type {
  DiceRolledEvent,
  GameState,
  PlayerState,
  PovertyTokensGrantedEvent,
} from './types.js';
import { validate } from './validate.js';

// A match's secret PRNG seed (revealed post-match) — chosen so eventIndex 0
// resolves to a total of 7 (the SAME seed+index `robber.test.ts` verifies).
// Passed as `validate`'s 4th param only, never stored in state (A1).
const SEED = 'skervik-robber-seed-2';

const EVENT_TILES_ROBIN_HOOD = EVENT_TILES_ROBIN_HOOD_TEST_PROFILE_ID as RuleProfileId; // both on, interval 2

function makePlayer(id: string, resources: Record<string, number> = {}): PlayerState {
  return { id, name: id, victoryPoints: 0, resources };
}

/**
 * Genesis mirrors `robinHood.test.ts`'s trailing setup: player-2 is the
 * LEADER (2 public VP), player-1 is TRAILING (0 public VP, gap 2: 0 <= 2-2),
 * player-3 sits exactly at the trailing boundary's edge (1 public VP: NOT
 * trailing, 1 > 2-2=0). A 7 never produces, so no producing tiles are needed
 * — only the public-VP standing (via `buildings.settlements`) matters here;
 * vertex ids are arbitrary strings (no board-legality check runs for
 * `intent.rollDice`).
 */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    matchId: 'match-event-tiles-1',
    phase: 'roll',
    turn: 1,
    profileId: EVENT_TILES_ROBIN_HOOD,
    currentPlayerId: 'player-1',
    players: [makePlayer('player-1'), makePlayer('player-2'), makePlayer('player-3')],
    eventIndex: 0, // resolves to total 7 with SEED (verified below)
    seedHash: 'deadbeef',
    board: {
      tileKinds: {},
      tileTokens: {},
      portContents: [],
      robberTileId: 'tile-robber',
    },
    buildings: {
      settlements: {
        'vertex-leader-1': 'player-2',
        'vertex-leader-2': 'player-2',
        'vertex-p3': 'player-3',
      },
      roads: {},
    },
    ...overrides,
  };
}

/** Drops `profileId` entirely (never sets it to `undefined` — `exactOptionalPropertyTypes`) so the state resolves to Classic's default `eventTiles:false`. */
function withoutProfileId(state: GameState): GameState {
  const { profileId: _profileId, ...rest } = state;
  return rest;
}

describe('eventTiles cadence (S2.2.4)', () => {
  it('sanity: eventIndex 0 resolves to total 7 with SEED', () => {
    const result = validate(
      makeState(),
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect((result.events[0] as DiceRolledEvent).total).toBe(7);
  });

  it('1st storm (sevensRolled 0->1) grants nothing — 1 % 2 !== 0', () => {
    const state = makeState({ sevensRolled: 0 });
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(1); // dice.rolled only, no poverty event

    const next = result.events.reduce(reduce, state);
    expect(next.sevensRolled).toBe(1); // the counter advances regardless of a grant
    expect(next.povertyTokens).toBeUndefined();
  });

  it('2nd storm (sevensRolled 1->2) grants the trailing player — 2 % 2 === 0', () => {
    const state = makeState({ sevensRolled: 1 });
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(2); // dice.rolled + poverty.tokensGranted
    const povertyEvent = result.events[1] as PovertyTokensGrantedEvent;
    expect(povertyEvent.type).toBe('poverty.tokensGranted');
    expect(povertyEvent.grants).toEqual({ 'player-1': 1 }); // ONLY the trailing player

    const next = result.events.reduce(reduce, state);
    expect(next.sevensRolled).toBe(2);
    expect(next.povertyTokens).toEqual({ 'player-1': 1 });
  });

  it('3rd storm (sevensRolled 2->3) grants nothing — 3 % 2 !== 0', () => {
    const state = makeState({ sevensRolled: 2 });
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(1);

    const next = result.events.reduce(reduce, state);
    expect(next.sevensRolled).toBe(3);
  });

  it('4th storm (sevensRolled 3->4) grants again — 4 % 2 === 0', () => {
    const state = makeState({ sevensRolled: 3 });
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(2);
    const povertyEvent = result.events[1] as PovertyTokensGrantedEvent;
    expect(povertyEvent.grants).toEqual({ 'player-1': 1 });

    const next = result.events.reduce(reduce, state);
    expect(next.sevensRolled).toBe(4);
  });

  it('a NON-trailing (leading) player never appears in an event-storm grant', () => {
    const state = makeState({ sevensRolled: 1 }); // 2nd storm, grants
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    const povertyEvent = result.events[1] as PovertyTokensGrantedEvent;
    expect(povertyEvent.grants['player-2']).toBeUndefined(); // the leader
    expect(povertyEvent.grants['player-3']).toBeUndefined(); // at the trailing boundary's edge
  });

  it('the cap (robinHoodTokenCap 3) is respected — an at-cap trailing player gets no token, no event', () => {
    const state = makeState({ sevensRolled: 1, povertyTokens: { 'player-1': 3 } });
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(1); // no poverty event — grants map was empty

    const next = result.events.reduce(reduce, state);
    expect(next.povertyTokens).toEqual({ 'player-1': 3 }); // unchanged, never exceeds the cap
  });

  it('the robber/discard flow on an event storm is byte-identical to a no-eventTiles storm', () => {
    const plain = validate(
      withoutProfileId(makeState()),
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    const storm = validate(
      makeState({ sevensRolled: 1 }),
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!plain.ok || !storm.ok) throw new Error('expected ok results');
    // The SAME `dice.rolled` shape (dieA/dieB/total/playersToDiscard) on both
    // — the event-storm grant is a SEPARATE, additional event, never a
    // mutation of the `dice.rolled` event itself (per-action legality
    // unchanged).
    expect(storm.events[0]).toEqual(plain.events[0]);
  });
});

describe('eventTiles + robinHood — shared pool (S2.2.4)', () => {
  it('both flags on: an event storm grants via ONE poverty.tokensGranted event (no double-count in one roll)', () => {
    const state = makeState({ profileId: EVENT_TILES_ROBIN_HOOD, sevensRolled: 1 });
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(2); // dice.rolled + exactly ONE poverty.tokensGranted
    const povertyEvent = result.events[1] as PovertyTokensGrantedEvent;
    expect(povertyEvent.grants).toEqual({ 'player-1': 1 });
  });

  it('the shared cap holds across BOTH grant sources — an event storm respects tokens already accrued via robinHood', () => {
    // player-1 already holds 2 tokens (as if accrued via a prior non-7
    // robinHood roll) — the event-storm grant brings it to the cap (3), never beyond.
    const state = makeState({
      profileId: EVENT_TILES_ROBIN_HOOD,
      sevensRolled: 1,
      povertyTokens: { 'player-1': 2 },
    });
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    const next = result.events.reduce(reduce, state);
    expect(next.povertyTokens).toEqual({ 'player-1': 3 });
  });

  it('once at the cap, the event-storm source grants nothing either', () => {
    const state = makeState({
      profileId: EVENT_TILES_ROBIN_HOOD,
      sevensRolled: 1,
      povertyTokens: { 'player-1': 3 },
    });
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(1); // no poverty event
  });
});

describe('forced roll no-hang under eventTiles (S2.2.4)', () => {
  it("a forced (timed-out) rollDice intent — identical to `forcedAction.ts`'s `roll`-phase default — is never rejected on an event storm", () => {
    // `forcedAction.ts`'s 'roll'-phase default is exactly
    // `{ type: 'intent.rollDice', playerId: state.currentPlayerId }` — the
    // SAME intent a human sends. The event-storm grant is purely additive
    // (never a new legality gate), so a forced roll on a flagged cadence can
    // never fail validate — this proves
    // [[turn-timer-forced-action-hang-risk]] stays closed.
    const state = makeState({ sevensRolled: 1 }); // 2nd storm, would grant
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: state.currentPlayerId },
      state.currentPlayerId,
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const next = result.events.reduce(reduce, state);
    expect(next.phase).toBe('robber'); // the turn moves on, never stuck in 'roll'
  });
});

describe('eventTiles:false — byte-identical to M1 (S2.2.4)', () => {
  it('a storm never writes sevensRolled and never emits poverty.tokensGranted when eventTiles is off', () => {
    const state = withoutProfileId(makeState()); // resolves to 'classic', eventTiles:false
    const result = validate(
      state,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(1); // dice.rolled only

    const next = result.events.reduce(reduce, state);
    expect(next.sevensRolled).toBeUndefined();
    expect(Object.keys(next)).not.toContain('sevensRolled');
  });
});
