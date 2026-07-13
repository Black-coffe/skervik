// @skervik/core — S1.7.3 fair-RNG VERIFY golden. Proves `verifyMatchRandomness`
// recomputes EVERY M1 seed-derived draw (board, dice, dev-card, robber-steal)
// from the seed + each event's own stream index and deep-compares to the log —
// and that a tamper in ANY of the four types is caught (a missed type would be
// a silent verification hole, the plan's #1 cross-cutting risk). The events are
// built with the REAL draw primitives so their values are correct by
// construction; each tamper then flips exactly one recorded fact.

import { describe, expect, it } from 'vitest';

import { drawBalancedRoll } from './balancedDeck.js';
import { buildTopology } from './board.js';
import { generateBoard } from './boardgen.js';
import { CLASSIC_DEV_CARD_PROFILE, shuffledDevDeck } from './devcards.js';
import { deriveValue, gameplayStreamIndex, rollDie, type Seed } from './rng.js';
import { EXPANDED_BOARD } from './ruleProfile.js';
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

// --- S2.1.2: the verifier is profile-aware for the randomness SOURCE ---
// A Balanced match's rolls are without-replacement draws, not 2d6. The verifier
// must recompute them from `drawBalancedRoll(seed, balancedRollsSeen)` — where
// `balancedRollsSeen` is its OWN counter — and reject any forged pair, exactly
// the S1.7.3 positional-binding discipline applied to the new draw source.

/** A faithful Balanced log: N honest without-replacement rolls off `drawBalancedRoll`. */
function faithfulBalancedLog(rolls = 5): GameEvent[] {
  const matchStarted: MatchStartedEvent = {
    type: 'match.started',
    index: 0,
    matchId: 'balanced-verify',
    seedHash: 'opaque-here',
    playerIds: ['a', 'b'],
    profileId: 'balanced',
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

  const events: GameEvent[] = [matchStarted, boardGenerated];
  for (let k = 0; k < rolls; k++) {
    const { dieA, dieB, total } = drawBalancedRoll(SEED, k);
    const dice: DiceRolledEvent = {
      type: 'dice.rolled',
      index: k + 2,
      playerId: 'a',
      dieA,
      dieB,
      total,
      ...(total === 7 ? { playersToDiscard: [] } : {}),
    };
    events.push(dice);
  }
  return events;
}

describe('verifyMatchRandomness — Balanced (balanced_deck) randomness source (S2.1.2)', () => {
  it('accepts a faithful Balanced log and checks every without-replacement roll', () => {
    const events = faithfulBalancedLog(5);
    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    // board + 5 balanced rolls = 6 seed-derived draws.
    expect(result.checked).toBe(6);
  });

  it('rejects a forged Balanced roll (naming dice.rolled/dieA)', () => {
    const events = faithfulBalancedLog(5);
    const idx = 4; // the 3rd balanced roll (event index 4)
    const dice = events[idx] as DiceRolledEvent;
    // Flip to a self-consistent but WRONG pair for this position.
    const forgedA = (dice.dieA % 6) + 1;
    events[idx] = { ...dice, dieA: forgedA, total: forgedA + dice.dieB };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some((m) => m.type === 'dice.rolled' && m.field === 'dieA'),
    ).toBe(true);
  });

  it('anti-grind: a favorable pair borrowed from a DIFFERENT draw position is rejected', () => {
    // The positional-binding attack for balanced_deck: swap an honest roll for a
    // pair that is a genuine draw at some OTHER position (so it "looks drawn"),
    // hoping the verifier keys off a log-supplied position. It must not — the
    // verifier recomputes at its OWN counter, so the borrowed pair mismatches.
    const events = faithfulBalancedLog(5);
    const trueThird = drawBalancedRoll(SEED, 2); // honest 3rd roll (event index 4)
    // Find a later draw position whose pair differs from the true 3rd roll.
    let borrowFrom = -1;
    for (let n = 5; n < 500; n++) {
      const cand = drawBalancedRoll(SEED, n);
      if (cand.dieA !== trueThird.dieA || cand.dieB !== trueThird.dieB) {
        borrowFrom = n;
        break;
      }
    }
    expect(borrowFrom).toBeGreaterThan(0);
    const borrowed = drawBalancedRoll(SEED, borrowFrom);
    const dice = events[4] as DiceRolledEvent;
    // A perfectly self-consistent (dieA,dieB,total) — just drawn at the WRONG
    // position. A verifier trusting any log-supplied position would accept it.
    events[4] = {
      ...dice,
      dieA: borrowed.dieA,
      dieB: borrowed.dieB,
      total: borrowed.total,
    };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some(
        (m) => m.type === 'dice.rolled' && (m.field === 'dieA' || m.field === 'dieB'),
      ),
    ).toBe(true);
  });

  it('reshuffle boundary: rolls past 36 verify against the next-round permutation', () => {
    // 38 rolls crosses the 36-card cycle boundary (round 0 → round 1). An honest
    // log must still verify, proving the verifier's counter drives round=floor(n/36).
    const events = faithfulBalancedLog(38);
    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(39); // board + 38 rolls
  });
});

// --- S2.1.7a / ADR-0013: verify recomputes board.generated from the PROFILE ---
// The board-leg discharge. An `expanded` (radius-3) match's board must be
// recomputed against the radius-3 topology + expanded board contents resolved
// from `state.profileId` — NOT the hardcoded Classic topology the verifier used
// before. These prove the recompute is profile-resolved both ways: an honest
// expanded log verifies clean; a corrupted one is flagged; and the SAME expanded
// layout fails if the log claims Classic (the verifier is not board-blind).

const EXPANDED_TOPO = buildTopology(3, 11);

/** A minimal honest `expanded` log: match.started(expanded) + its board.generated. */
function faithfulExpandedLog(): GameEvent[] {
  const matchStarted: MatchStartedEvent = {
    type: 'match.started',
    index: 0,
    matchId: 'expanded-verify',
    seedHash: 'opaque-here',
    playerIds: ['a', 'b', 'c', 'd', 'e'],
    profileId: 'expanded',
  };
  const layout = generateBoard(SEED, EXPANDED_TOPO, EXPANDED_BOARD);
  const boardGenerated: BoardGeneratedEvent = {
    type: 'board.generated',
    index: 1,
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: layout.robberTileId,
  };
  return [matchStarted, boardGenerated];
}

describe('verifyMatchRandomness — expanded (radius-3) board recompute (S2.1.7a)', () => {
  it('accepts a faithful expanded log — the 37-tile board recomputes clean', () => {
    const result = verifyMatchRandomness(SEED, faithfulExpandedLog());

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.checked).toBe(1); // the board.generated draw
  });

  it('flags a corrupted expanded layout (naming board.generated/robberTileId)', () => {
    const events = faithfulExpandedLog();
    const board = events[1] as BoardGeneratedEvent;
    events[1] = {
      ...board,
      robberTileId: EXPANDED_TOPO.tiles.find((t) => t.id !== board.robberTileId)!.id,
    };

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some(
        (m) => m.type === 'board.generated' && m.field === 'robberTileId',
      ),
    ).toBe(true);
  });

  it('flags an expanded layout mislabeled as Classic — proves the recompute is profile-resolved', () => {
    // Same honest expanded board.generated, but the log claims no profile (→
    // Classic). A board-blind verifier (old behavior: hardcoded Classic topology)
    // would recompute a 19-tile Classic board and flag every field. This is the
    // forcing proof that the board-leg now resolves topology+board from profileId.
    const events = faithfulExpandedLog();
    const started = events[0] as MatchStartedEvent;
    const { profileId: _dropped, ...classicClaim } = started;
    events[0] = classicClaim as MatchStartedEvent;

    const result = verifyMatchRandomness(SEED, events);

    expect(result.ok).toBe(false);
    expect(
      result.mismatches.some(
        (m) => m.type === 'board.generated' && m.field === 'tileKinds',
      ),
    ).toBe(true);
  });
});
