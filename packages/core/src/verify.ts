// @skervik/core — the VERIFY half of commit-reveal fair RNG (S1.7.3,
// `docs/wiki/fair-rng-commit-reveal.md` step 4). Given a match's revealed
// `seed` and its public event log, recompute EVERY seed-derived random draw
// (dice, robber-steal, dev-card, board-gen) from `seed` + the event's TRUE
// folded position — using the SAME primitives the engine drew with — and
// deep-compare each to the logged fact. Any discrepancy means the log was
// altered after the fact; a clean pass is cryptographic proof no roll was
// rigged (the seed already committed via `seedHash` at match start).
//
// SOUNDNESS (lead-review B1, S1.7.3): the stream key of every draw is derived
// from the event's TRUE folded position — an `expectedIndex` counter this
// verifier maintains itself (genesis `match.started`=0, `board.generated`=1,
// then +1 per event) — NOT from `event.index`, a field the LOG AUTHOR controls.
// Likewise the dev-card draw index comes from a verifier-owned deck counter, not
// the log's `event.deckRemaining`. Binding to a self-reported field would make
// the stream index a free parameter a compromised server could grind to hand a
// player favorable dice / a `victoryPoint` card and STILL pass — exactly the
// commit-reveal threat model (the seed is committed before play). We therefore
// (a) flag ANY `event.index !== expectedIndex` (a relabel or a gap), and (b)
// flag any `event.deckRemaining` that disagrees with the folded deck count.
//
// RESIDUAL LIMITATION (N2, out of M1 scope): contiguity catches relabels and
// gaps, but seed+log ALONE cannot prove no event was OMITTED — a fully
// re-indexed deletion (e.g. a deleted `dice.rolled` with everything after it
// renumbered) leaves no positional gap. Proving no omission needs a signed /
// hash-chained log (post-M1). This verifier proves PRESENT draws are faithful;
// it does not prove COMPLETENESS.
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

import { drawBalancedRoll } from './balancedDeck.js';
import { type BoardTopology, buildTopology } from './board.js';
import { generateBoard } from './boardgen.js';
import { shuffledDevDeck } from './devcards.js';
import { reduce } from './reduce.js';
import { deriveValue, gameplayStreamIndex, rollDie, type Seed } from './rng.js';
import { loadRuleProfile } from './ruleProfile.js';
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
 * Every draw is keyed off the event's TRUE folded position (`expectedIndex`),
 * never `event.index`; every event's `index` is also checked for contiguity.
 *
 * Covered M1 random-draw surface (the complete set — a missed type would be a
 * silent verification hole):
 * - `board.generated` — `generateBoard(seed, topology)` deep-equals the layout
 *   (`tileKinds` / `tileTokens` / `portContents` / `robberTileId`).
 * - `dice.rolled` — branches on the folded profile's randomness (S2.1.2):
 *   `'dice'` recomputes `rollDie(seed, gameplayStreamIndex(expectedIndex,
 *   DICE_A|DICE_B))`; `'balanced_deck'` recomputes `drawBalancedRoll(seed,
 *   balancedRollsSeen)` (a verifier-owned roll counter, NOT
 *   `state.balancedRollsDrawn`). Both compare `dieA`/`dieB`, and logged
 *   `total === dieA + dieB`.
 * - `devCard.bought` — `shuffledDevDeck(seed, deck)[drawIndex]` equals `card`,
 *   with `deck` resolved from the match profile and `drawIndex` derived from a
 *   verifier-owned deck counter (NOT the log's `deckRemaining`, which is itself
 *   checked for tampering).
 * - `robber.moved` (only when a card was stolen) —
 *   `expandHand(victimResources)[floor(deriveValue(seed, gameplayStreamIndex(
 *   expectedIndex, STEAL)) * handSize)]` equals `stolenResource`; the victim's
 *   hand is taken from the folded state BEFORE the move, exactly as `validate`
 *   saw it.
 * - Event-index contiguity — every `event.index` must equal its TRUE folded
 *   position (genesis 0, 1, then +1); a relabel or gap is flagged.
 */
export function verifyMatchRandomness(
  seed: Seed,
  events: readonly GameEvent[],
): VerifyRandomnessResult {
  const mismatches: RandomnessMismatch[] = [];
  let checked = 0;
  let state: GameState = GENESIS;
  let topology: BoardTopology | undefined;

  // The event's TRUE folded position — a verifier-owned counter (genesis 0,
  // then +1 per event), NOT `event.index`. Every seed-derived draw keys off
  // THIS, so a log author can't grind `event.index` to hand a favorable draw
  // (B1). The engine drew at `state.eventIndex`, which for an honest,
  // contiguous log equals this counter (`GameRoom.ts` sets each event's `index`
  // to `gameState.eventIndex`, starting 0).
  let expectedIndex = 0;
  // The dev deck's remaining count BEFORE the next draw — a verifier-owned
  // counter (starts full), NOT the log's `event.deckRemaining` (which is itself
  // checked against this). `validate` draws `shuffledDevDeck(seed, deck)[deckSize
  // - remainingBefore]`; we reconstruct `remainingBefore` here independently.
  // Deck resolves from the match's profile (S2.1.2 carry-forward discharge);
  // Balanced shares Classic's dev deck today so this is byte-identical, but the
  // hardcode is gone — the source of truth is now `loadRuleProfile`.
  const deckSize = loadRuleProfile(state.profileId ?? 'classic').devCards.deck.length;
  let devRemainingBefore = deckSize;
  // The verifier's OWN count of `dice.rolled` events folded so far — the draw
  // position the `balanced_deck` recompute keys off (S2.1.2). NEVER
  // `state.balancedRollsDrawn` or any log-supplied field: trusting a
  // self-reported position lets a dishonest server grind it to forge a
  // favorable draw that still verifies (the S1.7.3 positional-binding threat,
  // [[commit-reveal-verify-positional-binding]]). Incremented per `dice.rolled`.
  let balancedRollsSeen = 0;

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
    // Contiguity/monotonicity: the event's self-reported `index` MUST equal its
    // TRUE folded position. A mismatch is a relabel (draw moved to a favorable
    // stream slot) or a gap — either way the log was tampered. All draws below
    // key off `expectedIndex`, never `event.index`, so a wrong `index` can't
    // steer a recompute; this check surfaces the tamper explicitly.
    if (event.index !== expectedIndex) {
      flag(expectedIndex, event.type, 'index', expectedIndex, event.index);
    }
    switch (event.type) {
      case 'board.generated': {
        checked += 1;
        topology ??= buildTopology();
        const layout = generateBoard(seed, topology);
        if (!deepEqual(layout.tileKinds, event.tileKinds)) {
          flag(expectedIndex, event.type, 'tileKinds', layout.tileKinds, event.tileKinds);
        }
        if (!deepEqual(layout.tileTokens, event.tileTokens)) {
          flag(
            expectedIndex,
            event.type,
            'tileTokens',
            layout.tileTokens,
            event.tileTokens,
          );
        }
        if (!deepEqual(layout.portContents, event.portContents)) {
          flag(
            expectedIndex,
            event.type,
            'portContents',
            layout.portContents,
            event.portContents,
          );
        }
        if (layout.robberTileId !== event.robberTileId) {
          flag(
            expectedIndex,
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
        // Recompute the roll from the folded profile's randomness source
        // (S2.1.2). The profile was fixed by `match.started` (index 0, folded
        // before any roll), so `state.profileId` is already set here.
        const { randomness } = loadRuleProfile(state.profileId ?? 'classic');
        let dieA: number;
        let dieB: number;
        if (randomness === 'balanced_deck') {
          // Balanced: recompute the without-replacement draw from the seed and
          // the verifier's OWN roll counter — NEVER `state.balancedRollsDrawn`
          // (positional binding, above). For an honest log this counter equals
          // the count `validate` drew at; a forged position can't steer it.
          ({ dieA, dieB } = drawBalancedRoll(seed, balancedRollsSeen));
        } else {
          // Classic 2d6, keyed to the true folded position (byte-frozen path).
          dieA = rollDie(seed, gameplayStreamIndex(expectedIndex, GAMEPLAY_SLOT.DICE_A));
          dieB = rollDie(seed, gameplayStreamIndex(expectedIndex, GAMEPLAY_SLOT.DICE_B));
        }
        balancedRollsSeen += 1;
        if (dieA !== event.dieA)
          flag(expectedIndex, event.type, 'dieA', dieA, event.dieA);
        if (dieB !== event.dieB)
          flag(expectedIndex, event.type, 'dieB', dieB, event.dieB);
        // Recompute anchors dieA/dieB to the true position; also assert the
        // logged `total` is internally consistent with the logged faces (a
        // cheap check that closes a trivial `total`-only relabel).
        if (event.dieA + event.dieB !== event.total) {
          flag(expectedIndex, event.type, 'total', event.dieA + event.dieB, event.total);
        }
        break;
      }
      case 'devCard.bought': {
        checked += 1;
        // Draw index comes from the verifier-owned deck counter (the count
        // BEFORE this draw), NOT `event.deckRemaining` — a log author who forged
        // `deckRemaining` to point at a `victoryPoint`/`knight` card would still
        // be checked against the true deck position. `validate` draws
        // `shuffledDevDeck(seed, deck)[deckSize - remainingBefore]` — same
        // profile-resolved deck (S2.1.2 carry-forward discharge).
        const drawIndex = deckSize - devRemainingBefore;
        const expected = shuffledDevDeck(
          seed,
          loadRuleProfile(state.profileId ?? 'classic').devCards.deck,
        )[drawIndex];
        if (expected !== event.card) {
          flag(expectedIndex, event.type, 'card', expected, event.card);
        }
        // A forged `deckRemaining` is itself evidence of tampering: it must
        // equal the true post-draw count (`remainingBefore - 1`).
        if (event.deckRemaining !== devRemainingBefore - 1) {
          flag(
            expectedIndex,
            event.type,
            'deckRemaining',
            devRemainingBefore - 1,
            event.deckRemaining,
          );
        }
        devRemainingBefore -= 1;
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
            gameplayStreamIndex(expectedIndex, GAMEPLAY_SLOT.STEAL),
          );
          const expected = hand[Math.floor(draw * hand.length)];
          if (expected !== event.stolenResource) {
            flag(
              expectedIndex,
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
    expectedIndex += 1;
  }

  return { ok: mismatches.length === 0, checked, mismatches };
}
