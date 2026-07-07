// @skervik/core — S1.3.1: the 7 / robber (discard, relocate, steal) + knight
// play. Exercises the full `intent.rollDice` (on a 7) / `intent.discard` /
// `intent.moveRobber` / `intent.playDevCard(knight)` -> `validate` -> events
// -> `reduce` pipeline: the discard-wait FSM (order-independent, resumes only
// once every owing player has discarded), robber relocation legality, victim
// selection + the seeded steal-pick (gameplay slot 2,
// `docs/wiki/rng-stream-map.md` §1), the knight's shared relocate+steal path
// (un-deferred from S1.2.3's `KNIGHT_DEFERRED`), and one negative test per
// new S1.3.1 reject reason.

import { describe, expect, it } from 'vitest';

import { buildTopology, type TileTopology } from './board.js';
import { reduce } from './reduce.js';
import { deriveValue, gameplayStreamIndex } from './rng.js';
import type {
  BoardState,
  GameEvent,
  GameState,
  PlayerState,
  RobberMovedEvent,
} from './types.js';
import { validate } from './validate.js';

// A match's secret PRNG seed (revealed post-match) — chosen so eventIndex 0
// resolves to a total of 7 (verified below, not just asserted, same
// discipline as `production.test.ts`'s own seed comment). Passed as
// `validate`'s 4th param only, never stored in state (A1).
const SEED = 'skervik-robber-seed-2';

const topology = buildTopology();
// Two distinct tiles by construction (different spiral positions) — `tileR`
// plays the robber's CURRENT tile, `tileT` the target it relocates to.
const tileR = topology.tiles[0] as TileTopology;
const tileT = topology.tiles[1] as TileTopology;

function makePlayer(id: string, resources: Record<string, number> = {}): PlayerState {
  return { id, name: id, victoryPoints: 0, resources };
}

function makeBoard(robberTileId: string): BoardState {
  return { tileKinds: {}, tileTokens: {}, portContents: [], robberTileId };
}

/**
 * Genesis for relocate/steal-only tests (`intent.moveRobber`): already past
 * any discard (phase `'robber'`, no `playersToDiscard`), `player-1` is the
 * mover. `tileT`'s first vertex is `player-2`'s settlement, its second is
 * `player-3`'s city — both eligible victims once the robber lands on `tileT`.
 */
function makeRobberState(overrides: Partial<GameState> = {}): GameState {
  return {
    matchId: 'match-robber-1',
    phase: 'robber',
    turn: 3,
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

describe('robber relocation + steal (intent.moveRobber, S1.3.1)', () => {
  it('is deterministic: same seed+state -> same stolen card, no re-draw on replay', () => {
    const state = makeRobberState();

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
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    const again = validate(
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
    expect(again).toEqual(result);

    const event = result.events[0] as RobberMovedEvent;
    expect(event.stolenFrom).toBe('player-2');
    expect(event.stolenResource).toBe('timber'); // player-2's whole hand is timber

    const next = reduce(state, event);
    expect(next.board?.robberTileId).toBe(tileT.id);
    expect(next.phase).toBe('main');
    expect(next.players.find((p) => p.id === 'player-1')?.resources).toEqual({
      timber: 1,
    });
    expect(next.players.find((p) => p.id === 'player-2')?.resources).toEqual({
      timber: 2,
    });

    // Replay: folding the exact same recorded event through `reduce` from
    // the same genesis reproduces the same state — no re-draw.
    const replayed = [event].reduce(reduce, state);
    expect(replayed).toEqual(next);
  });

  it("indexes the victim's sorted-deterministic hand via the reserved gameplay slot 2", () => {
    const state = makeRobberState({
      players: [
        makePlayer('player-1'),
        makePlayer('player-2', { timber: 1, iron: 2 }), // sorted hand: [iron, iron, timber]
        makePlayer('player-3'),
      ],
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
    if (!result.ok) throw new Error('expected ok result');
    const event = result.events[0] as RobberMovedEvent;

    const sortedHand = ['iron', 'iron', 'timber'];
    // Slot 2 = the robber steal-pick (docs/wiki/rng-stream-map.md §1), keyed
    // to the resolving event's own index — here `state.eventIndex` since
    // `intent.moveRobber` emits a single event.
    const draw = deriveValue(SEED, gameplayStreamIndex(state.eventIndex, 2));
    const expectedResource = sortedHand[Math.floor(draw * sortedHand.length)];
    expect(event.stolenResource).toBe(expectedResource);
  });

  it('no-op steal (still relocates) when no adjacent victim holds any cards', () => {
    const state = makeRobberState({
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
    const event = result.events[0] as RobberMovedEvent;
    expect(event.stolenFrom).toBeUndefined();
    expect(event.stolenResource).toBeUndefined();

    const next = reduce(state, event);
    expect(next.board?.robberTileId).toBe(tileT.id);
  });

  it("excludes the mover's own adjacent building from eligible victims", () => {
    const state = makeRobberState({
      buildings: {
        settlements: {
          [tileT.vertexIds[0] as string]: 'player-2',
          [tileT.vertexIds[2] as string]: 'player-1',
        },
        roads: {},
        cities: { [tileT.vertexIds[1] as string]: 'player-3' },
      },
      players: [
        makePlayer('player-1', { timber: 5 }), // only the mover has cards
        makePlayer('player-2'),
        makePlayer('player-3'),
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
    // player-1's own hand is irrelevant — the mover can never steal from themselves.
    expect((result.events[0] as RobberMovedEvent).stolenFrom).toBeUndefined();
  });

  it("rejects ROBBER_SAME_TILE when the target is the robber's current tile", () => {
    const result = validate(
      makeRobberState(),
      { type: 'intent.moveRobber', playerId: 'player-1', tileId: tileR.id },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'ROBBER_SAME_TILE' });
  });

  it('rejects MALFORMED_INTENT for an off-board tile id', () => {
    const result = validate(
      makeRobberState(),
      { type: 'intent.moveRobber', playerId: 'player-1', tileId: 'not-a-real-tile' },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'MALFORMED_INTENT' });
  });

  it('rejects NO_SUCH_VICTIM for a victimId not adjacent to the new tile', () => {
    const result = validate(
      makeRobberState(),
      {
        type: 'intent.moveRobber',
        playerId: 'player-1',
        tileId: tileT.id,
        victimId: 'player-not-adjacent',
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NO_SUCH_VICTIM' });
  });

  it('rejects VICTIM_HAS_NO_CARDS for an adjacent-but-empty-handed named victim, even when another eligible victim has cards', () => {
    const state = makeRobberState({
      players: [
        makePlayer('player-1'),
        makePlayer('player-2'), // adjacent, 0 cards
        makePlayer('player-3', { iron: 1 }), // adjacent, has cards
      ],
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
    expect(result).toEqual({ ok: false, reason: 'VICTIM_HAS_NO_CARDS' });
  });

  it('rejects MUST_DISCARD_FIRST while a player still owes a discard', () => {
    const result = validate(
      makeRobberState({ playersToDiscard: ['player-2'] }),
      { type: 'intent.moveRobber', playerId: 'player-1', tileId: tileT.id },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'MUST_DISCARD_FIRST' });
  });

  it('rejects NOT_IN_ROBBER_PHASE outside the robber phase', () => {
    const result = validate(
      { ...makeRobberState(), phase: 'main' },
      { type: 'intent.moveRobber', playerId: 'player-1', tileId: tileT.id },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_IN_ROBBER_PHASE' });
  });

  it('rejects NOT_YOUR_TURN when a non-current player attempts to move the robber', () => {
    const result = validate(
      makeRobberState(),
      { type: 'intent.moveRobber', playerId: 'player-2', tileId: tileT.id },
      'player-2',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_YOUR_TURN' });
  });
});

describe('the 7 / discard-wait FSM (S1.3.1)', () => {
  /**
   * Genesis for the full scripted 7-flow: `player-1` (the roller/mover) and
   * `player-2` both hold >7 cards (9 and 8 — owing `floor(9/2)=4` and
   * `floor(8/2)=4`); `player-3` holds only 3 (never owes) and sits on
   * `tileT`'s first vertex — the eventual steal victim.
   */
  function makeSevenGenesis(overrides: Partial<GameState> = {}): GameState {
    return {
      matchId: 'match-robber-seven-1',
      phase: 'roll',
      turn: 4,
      currentPlayerId: 'player-1',
      players: [
        makePlayer('player-1', { timber: 5, clay: 4 }), // 9 cards
        makePlayer('player-2', { iron: 3, barley: 5 }), // 8 cards
        makePlayer('player-3', { fleece: 3 }), // 3 cards — never owes
      ],
      playerOrder: ['player-1', 'player-2', 'player-3'],
      eventIndex: 0, // resolves to total 7 with SEED (see file-header comment)
      seedHash: 'deadbeef',
      board: makeBoard(tileR.id),
      buildings: {
        settlements: { [tileT.vertexIds[0] as string]: 'player-3' },
        roads: {},
      },
      ...overrides,
    };
  }

  it('rolls a 7, order-independent discards, then relocate+steal — full scripted flow with replay', () => {
    const genesis = makeSevenGenesis();
    let state = genesis;
    const events: GameEvent[] = [];
    function apply(playerId: string, intent: Parameters<typeof validate>[1]): void {
      const result = validate(state, intent, playerId, SEED);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected ok result for ${intent.type}`);
      state = result.events.reduce(reduce, state);
      events.push(...result.events);
    }

    // Roll: total 7, both player-1 and player-2 owe a discard.
    apply('player-1', { type: 'intent.rollDice', playerId: 'player-1' });
    expect(state.phase).toBe('robber');
    expect(state.playersToDiscard).toEqual(['player-1', 'player-2']);

    // Order-independent: player-2 (not the current/roller player) discards FIRST.
    apply('player-2', {
      type: 'intent.discard',
      playerId: 'player-2',
      resources: { iron: 3, barley: 1 },
    });
    expect(state.playersToDiscard).toEqual(['player-1']);
    // `subtractResources` (`reduce.ts`) leaves a 0 entry for every named
    // resource rather than deleting the key — same convention every other
    // debit event already follows (`road.built`'s cost, etc.).
    expect(state.players.find((p) => p.id === 'player-2')?.resources).toEqual({
      iron: 0,
      barley: 4,
    });

    // The robber can't move yet — player-1 still owes.
    const tooEarly = validate(
      state,
      { type: 'intent.moveRobber', playerId: 'player-1', tileId: tileT.id },
      'player-1',
      SEED,
    );
    expect(tooEarly).toEqual({ ok: false, reason: 'MUST_DISCARD_FIRST' });

    // player-1 (the roller) discards last.
    apply('player-1', {
      type: 'intent.discard',
      playerId: 'player-1',
      resources: { timber: 2, clay: 2 },
    });
    expect(state.playersToDiscard).toBeUndefined(); // dropped — nobody left owing
    expect(state.phase).toBe('robber'); // still waiting on the move

    // Relocate + steal from player-3 (the only building adjacent to tileT).
    apply('player-1', {
      type: 'intent.moveRobber',
      playerId: 'player-1',
      tileId: tileT.id,
      victimId: 'player-3',
    });
    expect(state.phase).toBe('main');
    expect(state.board?.robberTileId).toBe(tileT.id);
    expect(state.players.find((p) => p.id === 'player-3')?.resources).toEqual({
      fleece: 2,
    });
    expect(state.players.find((p) => p.id === 'player-1')?.resources.fleece).toBe(1);

    // Determinism: replaying the exact same recorded events from genesis
    // reproduces this final state byte-for-byte.
    const replayed = events.reduce(reduce, genesis);
    expect(replayed).toEqual(state);
  });

  it('parallel discard (S2.1.5 confirms): N owers discard in ANY order for the same final state', () => {
    // Post-7 robber phase with two owers already recorded — discard is ALREADY
    // parallel (order-independent, each ower touches only their own hand +
    // leaves the queue), so S2.1.5 adds NO discard flag/behavior; this only
    // CONFIRMS it: folding the two discards in both orders yields byte-equal state.
    const base = makeSevenGenesis({
      phase: 'robber',
      playersToDiscard: ['player-1', 'player-2'],
      eventIndex: 5,
    });
    type Intent = Parameters<typeof validate>[1];
    const d1: Intent = {
      type: 'intent.discard',
      playerId: 'player-1',
      resources: { timber: 2, clay: 2 },
    };
    const d2: Intent = {
      type: 'intent.discard',
      playerId: 'player-2',
      resources: { iron: 3, barley: 1 },
    };

    function run(order: readonly Intent[]): GameState {
      let state: GameState = base;
      for (const intent of order) {
        const result = validate(state, intent, intent.playerId, SEED);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(`expected ok result for ${intent.playerId}`);
        state = result.events.reduce(reduce, state);
      }
      return state;
    }

    const forward = run([d1, d2]);
    const reversed = run([d2, d1]);
    expect(reversed).toEqual(forward);
    expect(forward.playersToDiscard).toBeUndefined(); // both cleared, queue dropped
  });

  it('a 7 with nobody over the hand limit still enters the robber phase, with moveRobber immediately legal', () => {
    const genesis = makeSevenGenesis({
      players: [
        makePlayer('player-1', { timber: 2 }),
        makePlayer('player-2', { clay: 1 }),
        makePlayer('player-3', { fleece: 3 }),
      ],
    });

    const rollResult = validate(
      genesis,
      { type: 'intent.rollDice', playerId: 'player-1' },
      'player-1',
      SEED,
    );
    if (!rollResult.ok) throw new Error('expected ok result');
    expect(rollResult.events).toHaveLength(1);
    expect(rollResult.events[0]).toMatchObject({
      type: 'dice.rolled',
      total: 7,
      playersToDiscard: [], // recorded as a fact even though it's empty
    });

    const afterRoll = reduce(genesis, rollResult.events[0] as GameEvent);
    expect(afterRoll.phase).toBe('robber');
    expect(afterRoll.playersToDiscard).toBeUndefined(); // dropped, not stored as []

    // player-3 sits on tileT (genesis fixture) and holds cards — naming them
    // as victim is required once an eligible, card-holding victim exists.
    const moveResult = validate(
      afterRoll,
      {
        type: 'intent.moveRobber',
        playerId: 'player-1',
        tileId: tileT.id,
        victimId: 'player-3',
      },
      'player-1',
      SEED,
    );
    expect(moveResult.ok).toBe(true);
  });

  it('rejects WRONG_DISCARD_COUNT when the discarded total is not exactly floor(handSize / 2)', () => {
    const genesis = makeSevenGenesis();
    const afterRoll = reduce(
      genesis,
      (
        validate(
          genesis,
          { type: 'intent.rollDice', playerId: 'player-1' },
          'player-1',
          SEED,
        ) as {
          ok: true;
          events: GameEvent[];
        }
      ).events[0] as GameEvent,
    );

    const result = validate(
      afterRoll,
      { type: 'intent.discard', playerId: 'player-2', resources: { iron: 3 } }, // owes 4, offers 3
      'player-2',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'WRONG_DISCARD_COUNT' });
  });

  it('rejects CANNOT_AFFORD when the discard names more of a resource than the player actually holds', () => {
    const genesis = makeSevenGenesis();
    const afterRoll = reduce(
      genesis,
      (
        validate(
          genesis,
          { type: 'intent.rollDice', playerId: 'player-1' },
          'player-1',
          SEED,
        ) as {
          ok: true;
          events: GameEvent[];
        }
      ).events[0] as GameEvent,
    );

    // player-1 holds 0 iron — the right TOTAL (4) but the wrong resource.
    const result = validate(
      afterRoll,
      { type: 'intent.discard', playerId: 'player-1', resources: { iron: 4 } },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'CANNOT_AFFORD' });
  });

  it('rejects NOT_OWED_DISCARD when a non-owing player tries to discard', () => {
    const genesis = makeSevenGenesis();
    const afterRoll = reduce(
      genesis,
      (
        validate(
          genesis,
          { type: 'intent.rollDice', playerId: 'player-1' },
          'player-1',
          SEED,
        ) as {
          ok: true;
          events: GameEvent[];
        }
      ).events[0] as GameEvent,
    );

    const result = validate(
      afterRoll,
      { type: 'intent.discard', playerId: 'player-3', resources: { fleece: 1 } },
      'player-3',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_OWED_DISCARD' });
  });

  it('rejects NOT_IN_ROBBER_PHASE for a discard attempted outside the robber phase', () => {
    const result = validate(
      makeSevenGenesis({ phase: 'main' }),
      { type: 'intent.discard', playerId: 'player-1', resources: { timber: 4 } },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_IN_ROBBER_PHASE' });
  });
});

describe('knight play (un-deferred by S1.3.1)', () => {
  function makeKnightGenesis(overrides: Partial<GameState> = {}): GameState {
    return {
      matchId: 'match-robber-knight-1',
      phase: 'main',
      turn: 5,
      currentPlayerId: 'player-1',
      players: [
        makePlayer('player-1'),
        makePlayer('player-2', { timber: 2 }),
        makePlayer('player-3'),
      ],
      eventIndex: 30,
      seedHash: 'deadbeef',
      board: makeBoard(tileR.id),
      buildings: {
        settlements: { [tileT.vertexIds[0] as string]: 'player-2' },
        roads: {},
      },
      devCards: { 'player-1': { held: { knight: 1 }, boughtThisTurn: {} } },
      ...overrides,
    };
  }

  it('routes through the same relocate+steal resolution and bumps the played-knight counter', () => {
    const genesis = makeKnightGenesis();

    const result = validate(
      genesis,
      {
        type: 'intent.playDevCard',
        playerId: 'player-1',
        card: 'knight',
        tileId: tileT.id,
        victimId: 'player-2',
      },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      type: 'devCard.knightPlayed',
      playerId: 'player-1',
    });
    const moveEvent = result.events[1] as RobberMovedEvent;
    expect(moveEvent.type).toBe('robber.moved');
    expect(moveEvent.nextPhase).toBe('main'); // played post-roll, from 'main'
    expect(moveEvent.stolenFrom).toBe('player-2');

    const next = result.events.reduce(reduce, genesis);
    expect(next.phase).toBe('main');
    expect(next.knightsPlayed).toEqual({ 'player-1': 1 });
    expect(next.devCards?.['player-1']?.held.knight).toBe(0);
    expect(next.devCardPlayedThisTurn).toBe(true);
    expect(next.board?.robberTileId).toBe(tileT.id);

    // Determinism: replaying the same 2 recorded events reproduces the state.
    const replayed = result.events.reduce(reduce, genesis);
    expect(replayed).toEqual(next);
  });

  it("is playable BEFORE rolling ('roll' phase) and returns the turn to 'roll' once resolved", () => {
    const genesis = makeKnightGenesis({ phase: 'roll' });

    // player-2 sits on tileT (genesis fixture) and holds cards — naming them
    // as victim is required once an eligible, card-holding victim exists.
    const result = validate(
      genesis,
      {
        type: 'intent.playDevCard',
        playerId: 'player-1',
        card: 'knight',
        tileId: tileT.id,
        victimId: 'player-2',
      },
      'player-1',
      SEED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');
    expect((result.events[1] as RobberMovedEvent).nextPhase).toBe('roll');

    const next = result.events.reduce(reduce, genesis);
    expect(next.phase).toBe('roll'); // the turn's roll is still pending
  });

  it('rejects INVALID_PHASE from setup/robber — knight is legal only from roll or main', () => {
    const fromSetup = validate(
      makeKnightGenesis({ phase: 'setup' }),
      {
        type: 'intent.playDevCard',
        playerId: 'player-1',
        card: 'knight',
        tileId: tileT.id,
      },
      'player-1',
      SEED,
    );
    expect(fromSetup).toEqual({ ok: false, reason: 'INVALID_PHASE' });
  });

  it('rejects DEV_CARD_ALREADY_PLAYED after a dev card was already played this turn', () => {
    const genesis = makeKnightGenesis({ devCardPlayedThisTurn: true });

    const result = validate(
      genesis,
      {
        type: 'intent.playDevCard',
        playerId: 'player-1',
        card: 'knight',
        tileId: tileT.id,
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'DEV_CARD_ALREADY_PLAYED' });
  });

  it('rejects BOUGHT_THIS_TURN for a knight bought this same turn', () => {
    const genesis = makeKnightGenesis({
      devCards: { 'player-1': { held: { knight: 1 }, boughtThisTurn: { knight: 1 } } },
    });

    const result = validate(
      genesis,
      {
        type: 'intent.playDevCard',
        playerId: 'player-1',
        card: 'knight',
        tileId: tileT.id,
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'BOUGHT_THIS_TURN' });
  });

  it('rejects CARD_NOT_HELD when no knight is held', () => {
    const genesis = makeKnightGenesis({ devCards: {} });

    const result = validate(
      genesis,
      {
        type: 'intent.playDevCard',
        playerId: 'player-1',
        card: 'knight',
        tileId: tileT.id,
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'CARD_NOT_HELD' });
  });

  it('still enforces relocate legality (e.g. ROBBER_SAME_TILE) for a knight play', () => {
    const genesis = makeKnightGenesis();

    const result = validate(
      genesis,
      {
        type: 'intent.playDevCard',
        playerId: 'player-1',
        card: 'knight',
        tileId: tileR.id,
      },
      'player-1',
      SEED,
    );
    expect(result).toEqual({ ok: false, reason: 'ROBBER_SAME_TILE' });
  });
});
