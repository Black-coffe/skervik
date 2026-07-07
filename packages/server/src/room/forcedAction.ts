// @skervik/server — the deterministic forced-default-action resolver (S2.1.4).
//
// When a player's turn timer hits its HARD deadline, the room must keep the
// match moving without hanging and without punishing the player (no karmic ban,
// CLAUDE.md roadmap principle 4/5). This module answers the one question the
// room asks at that moment: "for the current decision, what is the minimal legal
// default action, and WHO takes it?" — as a PURE, deterministic, wall-clock-free
// function. The room forges the returned `PlayerIntent` and pushes it through
// the SAME `#queue`-serialized authoritative pipeline as a human intent, so the
// event log records only the RESULTING normal event (`turn.ended` /
// `dice.rolled` / `resources.discarded` / `robber.moved`) — no timestamp, no
// "timed-out" marker. That is what keeps the deterministic core + the event log
// clock-free: replay and the S1.7.3 verifier can't even tell a turn was
// auto-played.
//
// Determinism discipline (mirrors `@skervik/core`): every choice here is a pure
// function of `GameState` — no `Date.now()`, no `Math.random()`, no seed. The
// seed-derived bits a forced action still triggers (the dice faces of a forced
// roll; the stolen resource of a forced robber move) are drawn by `validate`
// exactly as for a human action, so the S1.7.3 fair-RNG verifier is UNCHANGED
// (no new PRNG slot). The one player-choice a default is invented for — WHICH
// cards to discard after a 7 — uses a fixed largest-stacks-first policy, NOT a
// seed draw, precisely so verify stays untouched.
import {
  buildTopology,
  type GameState,
  isStealable,
  loadRuleProfile,
  type PlayerId,
  type PlayerIntent,
  type ResourceType,
} from '@skervik/core';

/** A forced default action: the minimal legal intent for the current decision + who acts. */
export interface ForcedAction {
  readonly playerId: PlayerId;
  readonly intent: PlayerIntent;
}

/**
 * The canonical resource order used to break ties in the forced-discard policy
 * (Classic's `timber → clay → fleece → barley → iron`, the same order the
 * profile's cost records and fixtures list). A deterministic, seed-free
 * tie-break: when two resource stacks are the same size, the one earlier in this
 * order is discarded first. An unknown resource kind (never reachable in Classic)
 * sorts AFTER all known ones, then alphabetically — still fully deterministic.
 */
const CANONICAL_RESOURCE_ORDER: readonly ResourceType[] = [
  'timber',
  'clay',
  'fleece',
  'barley',
  'iron',
];

/** Rank of a resource in {@link CANONICAL_RESOURCE_ORDER}; unknown kinds rank last. */
function resourceRank(resource: ResourceType): number {
  const index = CANONICAL_RESOURCE_ORDER.indexOf(resource);
  return index === -1 ? CANONICAL_RESOURCE_ORDER.length : index;
}

/** Total number of resource cards in a hand. */
function handSize(resources: Readonly<Record<ResourceType, number>>): number {
  return Object.values(resources).reduce((sum, amount) => sum + amount, 0);
}

/**
 * Resolves the minimal legal default action for the CURRENT phase, or `null`
 * when there is nothing to force (lobby/finished — no timed decision; setup —
 * auto-placement is DEFERRED, S2.1.4 Scope). Pure & deterministic: a function of
 * `state` alone, no clock, no RNG.
 *
 * - `'roll'`  → the current player's `intent.rollDice` (the seed-derived faces
 *               are drawn by `validate`, already in the log/verify — no change).
 * - `'main'`  → the current player's `intent.endTurn` (the simplest legal exit —
 *               no resource choice to invent).
 * - `'robber'` + a still-owing discarder → that player's `intent.discard` chosen
 *               by the deterministic largest-stacks policy (returns ONE ower's
 *               discard per call; the room re-resolves for each remaining ower).
 * - `'robber'` with discards cleared → the current player's `intent.moveRobber`
 *               to a deterministic default tile (steal — if any — follows the
 *               normal seed-derived rule inside validate/reduce).
 * - `'setup'` / `'lobby'` / `'finished'` → `null`.
 */
export function resolveForcedAction(state: GameState): ForcedAction | null {
  switch (state.phase) {
    case 'roll':
      return {
        playerId: state.currentPlayerId,
        intent: { type: 'intent.rollDice', playerId: state.currentPlayerId },
      };
    case 'main':
      return {
        playerId: state.currentPlayerId,
        intent: { type: 'intent.endTurn', playerId: state.currentPlayerId },
      };
    case 'robber':
      return resolveRobberPhase(state);
    case 'setup':
    case 'lobby':
    case 'finished':
      return null;
    default: {
      // Exhaustiveness guard — a new GamePhase must be handled explicitly.
      const _never: never = state.phase;
      return _never;
    }
  }
}

/** Forced default for the `'robber'` phase: pending discards first, then the move. */
function resolveRobberPhase(state: GameState): ForcedAction | null {
  const owing = state.playersToDiscard ?? [];
  if (owing.length > 0) {
    // One ower per call — the FIRST still-owing player (list order is
    // `state.players` order, recomputed by validate as each discard lands). The
    // room forces each in turn within the same timeout.
    const playerId = owing[0] as PlayerId;
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return null; // defensive: an owing id with no player (unreachable)
    return {
      playerId,
      intent: {
        type: 'intent.discard',
        playerId,
        resources: chooseDiscard(state, player.resources),
      },
    };
  }
  return resolveMoveRobber(state);
}

/**
 * The deterministic forced-discard policy (S2.1.4): pick exactly
 * `floor(handSize / halfDivisor)` cards — the amount `validate` requires — one
 * at a time from the LARGEST remaining stack, ties broken by
 * {@link CANONICAL_RESOURCE_ORDER}. NOT seed-derived (a discard is a player
 * choice, not a random draw), so the S1.7.3 verifier gains no new slot. Pure.
 */
function chooseDiscard(
  state: GameState,
  resources: Readonly<Record<ResourceType, number>>,
): Record<ResourceType, number> {
  const { robber } = loadRuleProfile(state.profileId ?? 'classic');
  const required = Math.floor(handSize(resources) / robber.halfDivisor);

  const remaining: Record<string, number> = { ...resources };
  const discard: Record<string, number> = {};
  for (let i = 0; i < required; i++) {
    const pick = largestStack(remaining);
    if (pick === undefined) break; // defensive: required <= handSize, never hit
    remaining[pick] = (remaining[pick] ?? 0) - 1;
    discard[pick] = (discard[pick] ?? 0) + 1;
  }
  return discard;
}

/**
 * The resource with the largest remaining count, ties broken by canonical order
 * (then, for unknown kinds of equal rank, alphabetically) — a total order, so
 * the winner is independent of object key iteration order. `undefined` only if
 * every stack is empty.
 */
function largestStack(remaining: Record<string, number>): ResourceType | undefined {
  let best: ResourceType | undefined;
  let bestCount = 0;
  for (const resource of Object.keys(remaining)) {
    const count = remaining[resource] ?? 0;
    if (count <= 0) continue;
    if (
      best === undefined ||
      count > bestCount ||
      (count === bestCount && preferOver(resource, best))
    ) {
      best = resource;
      bestCount = count;
    }
  }
  return best;
}

/** True when `a` should be discarded before `b` at equal stack size (canonical, then alphabetical). */
function preferOver(a: ResourceType, b: ResourceType): boolean {
  const ra = resourceRank(a);
  const rb = resourceRank(b);
  if (ra !== rb) return ra < rb;
  return a < b;
}

/**
 * Forced robber relocation once discards have cleared: move to the lowest-index
 * tile (topology order) that is NOT the robber's current tile, and — only if that
 * tile has an adjacent opponent holding cards — name a deterministic victim (the
 * first such owner in `state.players` order) so the move is a fully legal
 * `intent.moveRobber` (validate requires a named victim whenever one is
 * stealable). The stolen RESOURCE itself is the normal seed-derived draw inside
 * validate/reduce (verify already covers it — no change). Pure.
 *
 * **S2.2.1 friendly-robber cross-check**: when `friendlyRobber` is on, a
 * protected player (PUBLIC VP <= ceiling) is never picked as this deterministic
 * victim — `validate` would reject a forced move naming one, which would hang
 * the turn ([[turn-timer-forced-action-hang-risk]]). If every adjacent
 * card-holder is protected, the forced move steals from no one (still legal).
 */
function resolveMoveRobber(state: GameState): ForcedAction | null {
  const board = state.board;
  if (!board) return null; // defensive: the robber phase always has a board

  const currentPlayer = state.currentPlayerId;
  const defaultTile = buildTopology().tiles.find(
    (tile) => tile.id !== board.robberTileId,
  );
  if (!defaultTile) return null; // defensive: 19 tiles, always one other than the robber's

  const { robber } = loadRuleProfile(state.profileId ?? 'classic');
  const buildings = state.buildings ?? { settlements: {}, roads: {} };
  const eligibleOwners: PlayerId[] = [];
  for (const vertexId of defaultTile.vertexIds) {
    const owner = buildings.cities?.[vertexId] ?? buildings.settlements[vertexId];
    if (
      owner !== undefined &&
      owner !== currentPlayer &&
      !eligibleOwners.includes(owner)
    ) {
      eligibleOwners.push(owner);
    }
  }
  // A deterministic victim only when one is actually stealable (adjacent, holds
  // ≥1 card, and — under friendlyRobber — is not protected); the first such
  // owner in fixed `state.players` order.
  const victimId = state.players
    .map((p) => p.id)
    .find(
      (id) =>
        eligibleOwners.includes(id) &&
        handSize(state.players.find((p) => p.id === id)?.resources ?? {}) > 0 &&
        // Shared steal-eligibility predicate (S2.2.2 dedup) — STRUCTURALLY the
        // same friendly-robber gate `validate` uses, so a forced move never
        // names a protected victim `validate` would reject (which would hang
        // the turn, [[turn-timer-forced-action-hang-risk]]).
        isStealable(state, id, robber),
    );

  const intent: PlayerIntent =
    victimId === undefined
      ? { type: 'intent.moveRobber', playerId: currentPlayer, tileId: defaultTile.id }
      : {
          type: 'intent.moveRobber',
          playerId: currentPlayer,
          tileId: defaultTile.id,
          victimId,
        };
  return { playerId: currentPlayer, intent };
}
