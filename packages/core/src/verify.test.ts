// @skervik/core — S1.7.3 fair-RNG VERIFY golden. Proves `verifyMatchRandomness`
// recomputes EVERY M1 seed-derived draw (board, dice, dev-card, robber-steal)
// from the seed + each event's own stream index and deep-compares to the log —
// and that a tamper in ANY of the four types is caught (a missed type would be
// a silent verification hole, the plan's #1 cross-cutting risk). The events are
// built with the REAL draw primitives so their values are correct by
// construction; each tamper then flips exactly one recorded fact.

import { describe, expect, it } from 'vitest';

import { buildTopology } from './board.js';
import { generateBoard } from './boardgen.js';
import { CLASSIC_DEV_CARD_PROFILE, shuffledDevDeck } from './devcards.js';
import { deriveValue, gameplayStreamIndex, rollDie, type Seed } from './rng.js';
import type {
  BoardGeneratedEvent,
  DevCardBoughtEvent,
  DiceRolledEvent,
  GameEvent,
  MatchStartedEvent,
  ResourcesProducedEvent,
  RobberMovedEvent,
} from './types.js';
import { expandHand, GAMEPLAY_SLOT } from './validate.js';
import { verifyMatchRandomness } from './verify.js';

const SEED: Seed = 'skervik-s1.7.3-verify-golden-seed';
const TOPO = buildTopology();

/**
 * A faithful mini-log exercising all four seed-derived draw types, each value
 * computed from the real primitive so `verifyMatchRandomness` must accept it.
 * `b` is the steal victim (a two-kind hand so the pick is a real index draw).
 */
function faithfulLog(): GameEvent[] {
  const matchStarted: MatchStartedEvent = {
    type: 'match.started',
    index: 0,
    matchId: 'verify-golden',
    seedHash: 'opaque-here', // commitment is a server-side check, not this fn's
    playerIds: ['a', 'b'],
  };

  const layout = generateBoard(SEED, TOPO);
  const boardGenerated: BoardGeneratedEvent = {
    type: 'board.generated',
    index: 1,
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: layout.robberTileId,
  };

  // Give the victim a deterministic two-kind hand to steal from.
  const produced: ResourcesProducedEvent = {
    type: 'resources.produced',
    index: 2,
    grants: { b: { barley: 1, timber: 1 } },
    bank: {},
  };

  const dieA = rollDie(SEED, gameplayStreamIndex(3, GAMEPLAY_SLOT.DICE_A));
  const dieB = rollDie(SEED, gameplayStreamIndex(3, GAMEPLAY_SLOT.DICE_B));
  const diceRolled: DiceRolledEvent = {
    type: 'dice.rolled',
    index: 3,
    playerId: 'a',
    dieA,
    dieB,
    total: dieA + dieB,
  };

  // First draw off the top of the seed-shuffled deck.
  const deckSize = CLASSIC_DEV_CARD_PROFILE.deck.length;
  const devCardBought: DevCardBoughtEvent = {
    type: 'devCard.bought',
    index: 4,
    playerId: 'a',
    card: shuffledDevDeck(SEED)[0]!,
    cost: { fleece: 1, barley: 1, iron: 1 },
    deckRemaining: deckSize - 1,
  };

  // Steal from `b`'s [barley, timber] hand (folded state before this event).
  const hand = expandHand({ barley: 1, timber: 1 });
  const draw = deriveValue(SEED, gameplayStreamIndex(5, GAMEPLAY_SLOT.STEAL));
  const robberMoved: RobberMovedEvent = {
    type: 'robber.moved',
    index: 5,
    playerId: 'a',
    tileId: TOPO.tiles.find((tile) => tile.id !== layout.robberTileId)!.id,
    stolenFrom: 'b',
    stolenResource: hand[Math.floor(draw * hand.length)]!,
    nextPhase: 'main',
  };

  return [matchStarted, boardGenerated, produced, diceRolled, devCardBought, robberMoved];
}

describe('verifyMatchRandomness — provably-fair recompute-and-compare (S1.7.3)', () => {
  it('accepts a faithful log and reports each seed-derived draw checked', () => {
    const result = verifyMatchRandomness(SEED, faithfulLog());

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    // board + dice + dev-card + steal = 4 seed-derived draws.
    expect(result.checked).toBe(4);
  });

  it('catches a tampered die face (naming dice.rolled/dieA)', () => {
    const events = faithfulLog();
    const dice = events[3] as DiceRolledEvent;
    events[3] = {
      ...dice,
      dieA: (dice.dieA % 6) + 1,
      total: (dice.dieA % 6) + 1 + dice.dieB,
    };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some((m) => m.type === 'dice.rolled' && m.field === 'dieA'),
    ).toBe(true);
  });

  it('catches a tampered board layout (naming board.generated/robberTileId)', () => {
    const events = faithfulLog();
    const board = events[1] as BoardGeneratedEvent;
    events[1] = {
      ...board,
      robberTileId: TOPO.tiles.find((tile) => tile.id !== board.robberTileId)!.id,
    };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some(
        (m) => m.type === 'board.generated' && m.field === 'robberTileId',
      ),
    ).toBe(true);
  });

  it('catches a tampered dev-card draw (naming devCard.bought/card)', () => {
    const events = faithfulLog();
    const bought = events[4] as DevCardBoughtEvent;
    const forged = bought.card === 'knight' ? 'victoryPoint' : 'knight';
    events[4] = { ...bought, card: forged };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some((m) => m.type === 'devCard.bought' && m.field === 'card'),
    ).toBe(true);
  });

  it('catches a tampered robber steal (naming robber.moved/stolenResource)', () => {
    const events = faithfulLog();
    const moved = events[5] as RobberMovedEvent;
    // The victim only ever held barley/timber — clay is impossible to have drawn.
    events[5] = { ...moved, stolenResource: 'clay' };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some(
        (m) => m.type === 'robber.moved' && m.field === 'stolenResource',
      ),
    ).toBe(true);
  });

  it('does not treat a no-steal robber move as a draw (nothing to check)', () => {
    const events = faithfulLog();
    // Drop the steal fields → a documented no-op move (no random pick happened).
    const moved = events[5] as RobberMovedEvent;
    const { stolenFrom: _from, stolenResource: _res, ...noSteal } = moved;
    events[5] = noSteal as RobberMovedEvent;

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(true);
    // board + dice + dev-card only — the move drew nothing.
    expect(result.checked).toBe(3);
  });
});
