// @skervik/core — the VERIFY half of commit-reveal fair RNG (S1.7.3,
// `docs/wiki/fair-rng-commit-reveal.md` step 4). Given a match's revealed
// `seed` and its public event log, recompute EVERY seed-derived random draw
// (dice, robber-steal, dev-card, board-gen) from `seed` + the event's own
// stream index — using the SAME primitives the engine drew with — and
// deep-compare each to the logged fact. Any discrepancy means the log was
// altered after the fact; a clean pass is cryptographic proof no roll was
// rigged (the seed already committed via `seedHash` at match start).
//
// Pure + zero-dep (ADR-0003), like the rest of core: the SHA-256 commitment
// check (`sha256Hex(seed) === seedHash`) is the SERVER's job (`server/seed.ts`)
// — core stays crypto-free and browser-isomorphic. This module proves the
// DRAWS; the server proves the COMMITMENT.
//
// Faithfulness by construction: it folds the log through `reduce` exactly as
// the authoritative server did, so at each random event it holds the SAME
// `GameState` `validate` held when it drew — the victim's hand for a steal, the
// deck position for a card. It reuses `validate.ts`'s own `GAMEPLAY_SLOT` /
// `expandHand` (not a second copy), so the recompute can never silently drift
// from the real draw (the plan's #1 cross-cutting risk).

import { type BoardTopology, buildTopology } from './board.js';
import { generateBoard } from './boardgen.js';
import { CLASSIC_DEV_CARD_PROFILE, shuffledDevDeck } from './devcards.js';
import { reduce } from './reduce.js';
import { deriveValue, gameplayStreamIndex, rollDie, type Seed } from './rng.js';
import type { GameEvent, GameState } from './types.js';
import { expandHand, GAMEPLAY_SLOT } from './validate.js';

/** One recomputed draw that did not match the logged fact — an audit failure. */
export interface RandomnessMismatch {
  /** The offending event's log/stream index. */
  readonly index: number;
  /** The event type whose recompute disagreed (e.g. `'dice.rolled'`). */
  readonly type: GameEvent['type'];
  /** Which field of the event mismatched (e.g. `'dieA'`, `'stolenResource'`, `'robberTileId'`). */
  readonly field: string;
  /** What the seed recomputes to (the truth). */
  readonly expected: unknown;
  /** What the log recorded (the possibly-forged value). */
  readonly actual: unknown;
}

/** Verdict of {@link verifyMatchRandomness}: `ok` iff every seed-derived draw matched. */
export interface VerifyRandomnessResult {
  /** `true` iff `mismatches` is empty — no recomputed draw disagreed with the log. */
  readonly ok: boolean;
  /** How many seed-derived draws were checked (dice/steal/dev-card/board). */
  readonly checked: number;
  /** Every discrepancy found (empty when `ok`). */
  readonly mismatches: readonly RandomnessMismatch[];
}

/** The pre-match lobby state the log folds onto (mirrors `GameRoom.onCreate`). */
const GENESIS: GameState = {
  matchId: '',
  phase: 'lobby',
  turn: 0,
  currentPlayerId: '',
  players: [],
  eventIndex: 0,
  seedHash: '',
};

/** Order-independent structural equality for the JSON-shaped payloads in the log. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * Recomputes and checks every seed-derived random event in `events` against
 * the revealed `seed` (commit-reveal step 4). Pure and deterministic: same
 * `(seed, events)` in → identical verdict out, on any machine.
 *
 * Covered M1 random-draw surface (the complete set — a missed type would be a
 * silent verification hole):
 * - `board.generated` — `generateBoard(seed, topology)` deep-equals the layout
 *   (`tileKinds` / `tileTokens` / `portContents` / `robberTileId`).
 * - `dice.rolled` — `rollDie(seed, gameplayStreamIndex(index, DICE_A|DICE_B))`
 *   equals `dieA` / `dieB` (and their sum equals `total`).
 * - `devCard.bought` — `shuffledDevDeck(seed)[drawIndex]` equals `card`, with
 *   `drawIndex` reconstructed from the event's own `deckRemaining`.
 * - `robber.moved` (only when a card was stolen) —
 *   `expandHand(victimResources)[floor(deriveValue(seed, gameplayStreamIndex(
 *   index, STEAL)) * handSize)]` equals `stolenResource`; the victim's hand is
 *   taken from the folded state BEFORE the move, exactly as `validate` saw it.
 */
export function verifyMatchRandomness(
  seed: Seed,
  events: readonly GameEvent[],
): VerifyRandomnessResult {
  const mismatches: RandomnessMismatch[] = [];
  let checked = 0;
  let state: GameState = GENESIS;
  let topology: BoardTopology | undefined;

  const flag = (
    index: number,
    type: GameEvent['type'],
    field: string,
    expected: unknown,
    actual: unknown,
  ): void => {
    mismatches.push({ index, type, field, expected, actual });
  };

  for (const event of events) {
    switch (event.type) {
      case 'board.generated': {
        checked += 1;
        topology ??= buildTopology();
        const layout = generateBoard(seed, topology);
        if (!deepEqual(layout.tileKinds, event.tileKinds)) {
          flag(event.index, event.type, 'tileKinds', layout.tileKinds, event.tileKinds);
        }
        if (!deepEqual(layout.tileTokens, event.tileTokens)) {
          flag(
            event.index,
            event.type,
            'tileTokens',
            layout.tileTokens,
            event.tileTokens,
          );
        }
        if (!deepEqual(layout.portContents, event.portContents)) {
          flag(
            event.index,
            event.type,
            'portContents',
            layout.portContents,
            event.portContents,
          );
        }
        if (layout.robberTileId !== event.robberTileId) {
          flag(
            event.index,
            event.type,
            'robberTileId',
            layout.robberTileId,
            event.robberTileId,
          );
        }
        break;
      }
      case 'dice.rolled': {
        checked += 1;
        const dieA = rollDie(
          seed,
          gameplayStreamIndex(event.index, GAMEPLAY_SLOT.DICE_A),
        );
        const dieB = rollDie(
          seed,
          gameplayStreamIndex(event.index, GAMEPLAY_SLOT.DICE_B),
        );
        if (dieA !== event.dieA) flag(event.index, event.type, 'dieA', dieA, event.dieA);
        if (dieB !== event.dieB) flag(event.index, event.type, 'dieB', dieB, event.dieB);
        if (dieA + dieB !== event.total) {
          flag(event.index, event.type, 'total', dieA + dieB, event.total);
        }
        break;
      }
      case 'devCard.bought': {
        checked += 1;
        // The event carries the deck count AFTER the draw, so the draw index is
        // `deckSize - (deckRemaining + 1)` — the SAME `deckSize - remainingBefore`
        // the buy branch used (`validate.ts`), reconstructed from the log alone.
        const deckSize = CLASSIC_DEV_CARD_PROFILE.deck.length;
        const drawIndex = deckSize - (event.deckRemaining + 1);
        const expected = shuffledDevDeck(seed)[drawIndex];
        if (expected !== event.card) {
          flag(event.index, event.type, 'card', expected, event.card);
        }
        break;
      }
      case 'robber.moved': {
        // Only a move that actually stole is a random draw (a no-op steal drew
        // nothing). `stolenFrom`/`stolenResource` are both-or-neither present.
        if (event.stolenResource !== undefined) {
          checked += 1;
          const victim = state.players.find((player) => player.id === event.stolenFrom);
          const hand = expandHand(victim?.resources ?? {});
          const draw = deriveValue(
            seed,
            gameplayStreamIndex(event.index, GAMEPLAY_SLOT.STEAL),
          );
          const expected = hand[Math.floor(draw * hand.length)];
          if (expected !== event.stolenResource) {
            flag(
              event.index,
              event.type,
              'stolenResource',
              expected,
              event.stolenResource,
            );
          }
        }
        break;
      }
      default:
        break;
    }
    state = reduce(state, event);
  }

  return { ok: mismatches.length === 0, checked, mismatches };
}
