// @skervik/core — foundational domain types (M0 skeleton, S0.5.1).
//
// These are the minimal, real shapes behind the engine contract from tech
// spec §4.1 (`reduce`/`validate` themselves land in S0.5.2). Per ADR-0003
// every type here is plain data — no class instances, no functions, no
// `Map`/`Set` — so `GameState` can be event-sourced and deep-compared via
// JSON. M1 Classic rules extend these shapes; this file does not invent a
// full ruleset.

/** Opaque identifier for a match (room / game instance). */
export type MatchId = string;

/** Opaque identifier for a player within a match. */
export type PlayerId = string;

/**
 * Resource kind held by a player. Left abstract on purpose: the concrete
 * archipelago resource set (timber, ore, fish, ...) is an M1 ruleset
 * decision, not a core-skeleton concern.
 */
export type ResourceType = string;

/** Coarse lifecycle stage of a match. M1 will refine/extend this set. */
export type GamePhase = 'lobby' | 'setup' | 'main' | 'finished';

/**
 * A single player's public state. Plain data only (ADR-0003): `resources`
 * is a plain object, never a `Map`, so it serializes and deep-compares
 * deterministically.
 */
export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly victoryPoints: number;
  readonly resources: Readonly<Record<ResourceType, number>>;
}

/**
 * The full authoritative game state. A plain, JSON-serializable object —
 * no class instances, no functions, no `Map`/`Set` — so it can be
 * event-sourced (replay = truth) and deep-compared byte-for-byte
 * (ADR-0003, `docs/wiki/deterministic-core.md`).
 */
export interface GameState {
  readonly matchId: MatchId;
  readonly phase: GamePhase;
  /** 1-based turn counter; advances on `turn.ended`. */
  readonly turn: number;
  readonly currentPlayerId: PlayerId;
  readonly players: ReadonlyArray<PlayerState>;
  /**
   * Count of events applied so far. Doubles as the PRNG stream index
   * (`docs/wiki/fair-rng-commit-reveal.md`): randomness is derived from
   * `seed` + this index, never drawn ambiently.
   */
  readonly eventIndex: number;
  /** `SHA256(seed)`, published before the match (commit step of commit-reveal). */
  readonly seedHash: string;
}

/** Fields shared by every {@link GameEvent} variant. */
interface BaseGameEvent {
  /** Position of this event in the match's event log / PRNG stream. */
  readonly index: number;
}

/** Emitted once when a match's authoritative state is initialized. */
export interface MatchStartedEvent extends BaseGameEvent {
  readonly type: 'match.started';
  readonly matchId: MatchId;
  readonly seedHash: string;
  readonly playerIds: ReadonlyArray<PlayerId>;
}

/**
 * A dice roll resolved by the server from the seeded PRNG. `value` is a
 * fact, not a request — it is never generated inside `reduce` itself, only
 * carried as event data (ADR-0003: randomness is data, not ambient).
 */
export interface DiceRolledEvent extends BaseGameEvent {
  readonly type: 'dice.rolled';
  readonly playerId: PlayerId;
  readonly value: number;
}

/** Emitted when a player's turn ends and play passes to the next player. */
export interface TurnEndedEvent extends BaseGameEvent {
  readonly type: 'turn.ended';
  readonly playerId: PlayerId;
  readonly nextPlayerId: PlayerId;
}

/**
 * A fact that mutates {@link GameState} via `reduce`. Discriminated by
 * `type`. Only events change state — intents never do directly
 * (ADR-0003). This is a minimal M0 set; M1 Classic rules add
 * build/trade/robber/etc.
 */
export type GameEvent = MatchStartedEvent | DiceRolledEvent | TurnEndedEvent;

/** Fields shared by every {@link PlayerIntent} variant. */
interface BaseIntent {
  readonly playerId: PlayerId;
}

/** A player's request to roll the dice on their turn. */
export interface RollDiceIntent extends BaseIntent {
  readonly type: 'intent.rollDice';
}

/** A player's request to end their turn. */
export interface EndTurnIntent extends BaseIntent {
  readonly type: 'intent.endTurn';
}

/**
 * A player's wish, sent from the client. Discriminated by `type`. Passed
 * through `validate` (S0.5.2), which turns a legal intent into
 * {@link GameEvent}s or rejects it with a {@link RejectReason} — an intent
 * never mutates state directly (ADR-0003). This is a minimal M0 set; M1
 * Classic rules add build/trade/etc.
 */
export type PlayerIntent = RollDiceIntent | EndTurnIntent;

/**
 * Why `validate` refused an intent. An enumerated string-literal union so
 * rejections serialize plainly (e.g. over the wire in `intent.rejected`,
 * tech spec §5.3) and can be switched on exhaustively.
 */
export type RejectReason =
  'NOT_YOUR_TURN' | 'INVALID_PHASE' | 'UNKNOWN_PLAYER' | 'MALFORMED_INTENT';
