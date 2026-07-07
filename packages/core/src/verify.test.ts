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

  // --- B1 soundness: draws bind to the TRUE folded position, not log fields ---
  // These forgeries keep every VALUE self-consistent (an honest face/card at a
  // grinding-chosen stream slot) — they'd pass a verifier that trusted
  // `event.index`/`event.deckRemaining`, but must fail one anchored to position.

  it('catches a relabeled dice index — honest faces at a forged stream slot (B1)', () => {
    const events = faithfulLog();
    // The review's exact forgery: relabel an honest roll to `total 12` by moving
    // it to a stream slot that genuinely rolls 6+6, keeping the faces consistent.
    let forgedIndex = -1;
    for (let q = 100; q < 5000; q++) {
      const a = rollDie(SEED, gameplayStreamIndex(q, GAMEPLAY_SLOT.DICE_A));
      const b = rollDie(SEED, gameplayStreamIndex(q, GAMEPLAY_SLOT.DICE_B));
      if (a + b === 12) {
        forgedIndex = q;
        break;
      }
    }
    expect(forgedIndex).toBeGreaterThan(0); // a double-6 slot exists in range
    const a = rollDie(SEED, gameplayStreamIndex(forgedIndex, GAMEPLAY_SLOT.DICE_A));
    const b = rollDie(SEED, gameplayStreamIndex(forgedIndex, GAMEPLAY_SLOT.DICE_B));
    // Self-consistent faces + total, but at the wrong (forged) index.
    events[3] = {
      ...(events[3] as DiceRolledEvent),
      index: forgedIndex,
      dieA: a,
      dieB: b,
      total: 12,
    };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    // The tamper is named as an index mismatch at the event's TRUE position (3).
    expect(
      result.mismatches.some(
        (m) =>
          m.type === 'dice.rolled' && m.field === 'index' && m.actual === forgedIndex,
      ),
    ).toBe(true);
  });

  it('catches a forged devCard.bought deckRemaining selecting a different card (B1)', () => {
    const events = faithfulLog();
    const bought = events[4] as DevCardBoughtEvent;
    const deckSize = CLASSIC_DEV_CARD_PROFILE.deck.length;
    const deck = shuffledDevDeck(SEED);
    // Pick some LATER deck slot holding a different card, then forge
    // `deckRemaining` to point the (naive) verifier at it — the true draw is the
    // top card (slot 0), so anchoring to the folded deck counter must reject it.
    let target = -1;
    for (let j = 1; j < deckSize; j++) {
      if (deck[j] !== deck[0]) {
        target = j;
        break;
      }
    }
    expect(target).toBeGreaterThan(0);
    events[4] = {
      ...bought,
      card: deck[target]!,
      deckRemaining: deckSize - (target + 1),
    };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some((m) => m.type === 'devCard.bought' && m.field === 'card'),
    ).toBe(true);
    // The forged field is itself flagged as tampering evidence.
    expect(
      result.mismatches.some(
        (m) => m.type === 'devCard.bought' && m.field === 'deckRemaining',
      ),
    ).toBe(true);
  });

  it('catches a total that disagrees with the (honest) dice faces (B1)', () => {
    const events = faithfulLog();
    const dice = events[3] as DiceRolledEvent;
    // Faces stay the true recomputed values; only `total` is inflated.
    events[3] = { ...dice, total: dice.dieA + dice.dieB + 1 };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some((m) => m.type === 'dice.rolled' && m.field === 'total'),
    ).toBe(true);
  });

  it('catches a non-contiguous index gap (B1)', () => {
    const events = faithfulLog();
    // Bump one event's self-reported index off its true folded position.
    const produced = events[2] as ResourcesProducedEvent;
    events[2] = { ...produced, index: 99 };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some(
        (m) => m.field === 'index' && m.index === 2 && m.actual === 99,
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
