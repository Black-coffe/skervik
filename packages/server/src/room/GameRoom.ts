// @skervik/server — the authoritative game room (S1.4.1 shell + S1.4.2
// intent pipeline + S1.4.3 commit-reveal + S1.4.4b durable persist, ADR-0009).
// Holds the complete plain `@skervik/core` `GameState` + a private crypto seed
// in room memory; the `@colyseus/schema` mirrors ONLY the public lobby/late-join
// projection (Fork 1). Gameplay flows as `event.batch` broadcasts of
// server-validated events — never through the Schema. Each validated batch is
// PERSISTED to the event log BEFORE it is committed/broadcast (S1.4.4b): no
// client ever observes an event that was not durably recorded first. The secret
// seed is revealed to match metadata ONLY after `game.ended` (S1.4.3).
import { type Bot, createHeuristicBot, type Difficulty } from '@skervik/bots';
import {
  type BoardGeneratedEvent,
  buildTopology,
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  generateBoard,
  loadRuleProfile,
  type MatchStartedEvent,
  type NeutralPlacedEvent,
  neutralPlacementEvents,
  type PlayerId,
  type PlayerIntent,
  reduce,
  type RuleProfileId,
  type Seed,
  type TimerProfile,
  validate,
} from '@skervik/core';
import {
  ClientMessageSchema,
  ConnectOptionsSchema,
  type EventBatchMessage,
  isCompatibleProtocolVersion,
  JoinLobbySelectionSchema,
  JoinOptionsSchema,
  PROTOCOL_VERSION,
  type RejectMessage,
  type StateSnapshotMessage,
  type VersionErrorMessage,
} from '@skervik/protocol';
import { type Client, CloseCode, Room, ServerError } from 'colyseus';

import type { MatchPlayerResult } from '../db/schema/index.js';
import {
  FsMatchMetadataStore,
  InMemoryMatchMetadataStore,
  type MatchMetadataStore,
  type MatchPlayerResultMetadata,
  type MatchResultMetadata,
} from '../matchMetadata.js';
import { createRoomSchema, RoomSchema, SeatSchema } from '../schema/RoomSchema.js';
import { generateSeed, sha256Hex } from '../seed.js';
import { FsEventSink, type GameEventSink, InMemoryEventSink } from './eventSink.js';
import { resolveForcedAction } from './forcedAction.js';

/** Classic seat cap for M1 (3-4 players) — a room option, not a hardcoded rule. */
const DEFAULT_MAX_SEATS = 4;

/**
 * The default seat-hold grace window in seconds (S2.3.1, "no karmic bans"
 * product law: a network drop must never cost you the game) — NOT clamped at
 * runtime (a test injects a tiny value via {@link GameRoomOptions.reconnectGraceSeconds}
 * so the expiry path stays fast/deterministic; production rooms get this floor).
 */
const DEFAULT_RECONNECT_GRACE_SECONDS = 120;

/**
 * The default per-turn bot-action safety cap (S2.4.3 no-hang discipline) —
 * generous enough that no real turn (setup's handful of placements, a normal
 * main-phase build/trade sequence) is ever truncated; a test overrides it via
 * the `botActionCap` room option to prove the no-hang fallback without a
 * genuinely broken bot.
 */
const DEFAULT_BOT_ACTION_CAP = 100;

/**
 * The delay before force-closing clients at game end (S2.3.3). Long enough that
 * the `game.ended` `event.batch` broadcast (enqueued on the same tick) is
 * flushed to every client BEFORE its socket closes — Colyseus flushes queued
 * messages on its patch interval (~50ms), so a few hundred ms is a comfortable,
 * player-imperceptible margin. Runs on the room's own wall-clock seam
 * (`#scheduler`), never the deterministic core.
 */
const GAME_END_CLOSE_DELAY_MS = 500;

/**
 * A cancellable one-shot timer — the minimal surface the room needs from a
 * scheduler. In production this is a Colyseus `this.clock` `Delayed` (the room
 * clock is lifecycle-bound and auto-cleared on dispose); a test can inject a
 * manual {@link TurnTimerScheduler} whose timers it fires deterministically,
 * since `@colyseus/testing` exposes no tickable clock.
 */
export interface RoomTimer {
  clear(): void;
}

/**
 * Schedules the turn-timer callback (S2.1.4). Production uses `this.clock`
 * exclusively (see {@link GameRoom.onCreate}); tests inject a controllable
 * implementation so `arm → expire → forced action` is exercised without a real
 * wall-clock wait.
 */
export interface TurnTimerScheduler {
  setTimeout(callback: () => void, ms: number): RoomTimer;
}

/**
 * The transport-level `ServerError.code` for a protocol-version rejection
 * (S1.5.2). A value in the WebSocket application-reserved close-code range
 * (4000-4999) so it never collides with Colyseus's own codes; the
 * machine-readable reason lives in the `error.version` payload (the error's
 * message body), not in this numeric code.
 */
const PROTOCOL_VERSION_MISMATCH_CODE = 4001;

/**
 * The transport-level `ServerError.code` for a rejected WIRE lobby selection
 * (S2.5.4 security requirement): a `profileId` outside the shipping allow-list
 * or a malformed `bots` roster. Distinct from {@link PROTOCOL_VERSION_MISMATCH_CODE}
 * so this is never misreported to the client as a version problem — same
 * WebSocket application-reserved range (4000-4999).
 */
const INVALID_LOBBY_SELECTION_CODE = 4002;

/**
 * The transport-level `ServerError.code` for a join options object carrying a
 * key OUTSIDE the full wire allow-list (`JoinOptionsSchema`, security
 * follow-up to S2.5.4 — `[[room-options-are-client-input]]`): e.g. `seed`,
 * `maxSeats`, `botActionCap`, `botFillDifficulty`, or any other
 * internal-only {@link GameRoomOptions} field. Distinct from both codes above
 * so this specific "you sent a field you must never send" reason survives the
 * transport, even though the client only ever treats any non-`error.version`
 * message as a generic connection error today.
 */
const INVALID_JOIN_OPTIONS_CODE = 4003;

/**
 * The transport-level `ServerError.code` for a PRESENT-but-invalid session
 * token (S2.6.2a): a `sessionToken` on the join handshake that fails
 * verification (bad signature / expired / malformed). Distinct from the three
 * codes above — same WebSocket application-reserved range (4000-4999). An
 * ABSENT token is NOT an error (a fresh guest proceeds); only a supplied token
 * that fails is rejected, never silently downgraded (that would mask tampering).
 */
const AUTH_TOKEN_INVALID_CODE = 4004;

/**
 * Verifies a session token (S2.6.2a) — injected into the room so `onAuth` can
 * resolve a returning guest's durable `userId` without this module importing
 * `jose` or reading the secret. Returns the claims on success, `null` on any
 * verification failure. Defaults (when auth isn't configured) to a no-op that
 * returns `null` for ANY token — but `onAuth` treats an ABSENT token as "no
 * auth" and only rejects a PRESENT one, so an unconfigured room simply never
 * exercises this (test rooms that pass no token are unchanged).
 */
export type VerifySessionToken = (
  token: string,
) => Promise<{ userId: string; displayName: string } | null>;

export interface GameRoomOptions {
  readonly maxSeats?: number;
  /**
   * The rule profile this match runs under (S2.1.1/S2.1.6). Defaults to
   * `'classic'` — the M1 behavior, unchanged: lobby mode SELECTION is S2.5.4, so
   * production rooms stay Classic/4 until that lands. A test/room can set
   * `'twoPlayer'` (with `maxSeats: 2`) to run the 2-player mode, which places the
   * profile's `neutralSettlements` neutral blockers at genesis (S2.1.6). Carried
   * into `match.started` so replay/verify resolve the same rules (event-sourcing).
   */
  readonly profileId?: RuleProfileId;
  /**
   * Where validated events are appended before broadcast (S1.4.2 seam). When
   * given, it wins over `matchesDir`; tests inject an in-memory buffer here.
   * When omitted, the room builds an {@link FsEventSink} if `matchesDir` is set
   * (production), else falls back to an in-memory buffer (the test/dev default,
   * so no run touches the filesystem unless it asked to).
   */
  readonly sink?: GameEventSink;
  /**
   * Base directory for the durable ndjson log (S1.4.4b). When set (and no
   * explicit `sink` is given), the room writes each validated batch to
   * `{matchesDir}/{matchId}/events.ndjson` via {@link FsEventSink}. Production
   * wiring passes this through `createGameServer({ matchesDir })`.
   */
  readonly matchesDir?: string;
  /**
   * Where the secret seed is revealed after `game.ended` (S1.4.3 seam).
   * Defaults to an in-memory store; S1.7.3 injects the durable
   * PostgreSQL/JSON-sidecar writer here without touching pipeline logic.
   */
  readonly metadataStore?: MatchMetadataStore;
  /**
   * A fixed secret PRNG seed (S1.7.2 test seam) — injected so an E2E can run
   * the SAME scripted match twice and assert byte-equal final state, and so a
   * board/roll sequence is reproducible. Production omits it: {@link onCreate}
   * falls back to a fresh {@link generateSeed}. Like the raw seed it replaces,
   * this stays a server secret — it is never serialized, broadcast, or logged
   * (commit-reveal, ADR-0009 Fork 3); only its `sha256Hex` becomes public.
   */
  readonly seed?: Seed;
  /**
   * A turn-timer scheduler (S2.1.4 test seam). Production omits it: {@link
   * GameRoom.onCreate} falls back to a scheduler backed by `this.clock` (the
   * ONLY wall-clock the room uses). A test injects a manual scheduler so it can
   * fire the hard timeout deterministically without waiting real time — Colyseus
   * `@colyseus/testing` has no tickable clock.
   */
  readonly turnTimerScheduler?: TurnTimerScheduler;
  /**
   * Bot seats to seat at genesis (S2.4.3) — each entry mints one server-owned
   * bot seat (`'bot-0'`, `'bot-1'`, …) with a `Bot` brain behind it; a bot seat
   * has no live `Client` (it can't be created in {@link GameRoom.onJoin}, so
   * this is assembled in {@link onCreate} instead). Single-player is 1 human +
   * this array sized to fill the rest of `maxSeats`; a pure bot-vs-bot room
   * (this story's E2E) sizes it to `maxSeats` with no human at all. Defaults to
   * `[]` — production Classic rooms are unaffected, byte-frozen. Lobby mode /
   * difficulty SELECTION is S2.5.4; this option is the room-level knob a future
   * lobby maps a UI pick onto.
   */
  readonly bots?: ReadonlyArray<{ readonly difficulty: Difficulty }>;
  /**
   * Per-turn bot-action safety cap (S2.4.3 test seam, no-hang discipline). If a
   * bot seat's OWN decision keeps producing legal actions without its turn
   * advancing (`state.turn` unchanged) past this many steps, the room stops
   * trusting it for the rest of that span and falls back to the deterministic
   * `resolveForcedAction` default — the same discipline S2.1.4 uses on a hard
   * timeout, just triggered by a step count instead of a wall-clock. Defaults
   * to a generous {@link DEFAULT_BOT_ACTION_CAP} (production); a test sets it
   * tiny to prove the no-hang fallback without needing a genuinely broken bot.
   */
  readonly botActionCap?: number;
  /**
   * The seat-hold grace window in seconds (S2.3.1, "no karmic bans" product
   * law) — how long a NON-consented drop's seat is held via Colyseus's native
   * `allowReconnection` before it gives up (the seat still isn't removed past
   * that point; there is just no more automatic reclaim — bot-fill of an
   * expired hold is S2.3.3). Defaults to {@link DEFAULT_RECONNECT_GRACE_SECONDS}
   * (120, the product-law floor); a test injects a tiny value so the expiry
   * path is exercised fast, without a real 120s wait. This is a ROOM/infra
   * option, not a `RuleProfile` field — grace is resilience, not a game rule;
   * a future lobby (E2.5) can override it per match.
   */
  readonly reconnectGraceSeconds?: number;
  /**
   * The difficulty a fill-bot takes over an abandoned seat with (S2.3.3, "no
   * dead time" product law) — installed when a dropped seat's grace expires
   * with no reconnect, OR immediately on a consented leave, so the remaining
   * humans play out a real match against a competent opponent instead of a
   * stalled seat. Defaults to `'medium'` (a reasonable stand-in). A ROOM/infra
   * option, not a `RuleProfile` field — bot-fill is resilience, not a game rule;
   * a future lobby (E2.5) can override it per match.
   */
  readonly botFillDifficulty?: Difficulty;
  /**
   * Private-room flag (S2.5.3). When `true`, {@link onCreate} calls Colyseus's
   * own `this.setPrivate(true)` — the room is excluded from `joinOrCreate`'s
   * matchmaking listing, so only a client that already has this room's
   * `roomId` (the invite "code", owner decision — no bespoke code registry)
   * can reach it, via `client.joinById`. Defaults to `false`/absent: every
   * existing room stays publicly matchable, byte-unchanged. Privacy here is
   * "unguessable-enough for play with a friend," not a security boundary —
   * anyone holding the roomId can join until the room fills.
   *
   * S2.5.2: ALSO gates `#maybeAutoStart` — a private room never auto-starts
   * on seats-full; it starts only when its host (seat 0) sends `startMatch`
   * (`#handleStartMatch`), which bot-fills any still-empty seats first.
   */
  readonly isPrivate?: boolean;
  /**
   * Session-token verifier (S2.6.2a) — a DEFINE-time server config option (bound
   * to the resolved `SESSION_SECRET` in `boot.ts`), NOT a client-supplied field
   * (`JoinOptionsSchema.strict()` forbids it on the wire). When present, `onAuth`
   * verifies a PRESENT `sessionToken` and rejects an invalid one with
   * {@link AUTH_TOKEN_INVALID_CODE}; a valid token attaches the resolved
   * `userId` to `client.userData` (metadata only — the seat `PlayerId` stays the
   * `sessionId`, ADR-0009). When ABSENT (no DB/auth configured), a supplied
   * token is simply ignored — the room accepts the join as a fresh guest.
   */
  readonly verifySessionToken?: VerifySessionToken;
}

export class GameRoom extends Room<{ state: RoomSchema }> {
  /** The authoritative plain GameState — never serialized via the Schema (ADR-0009 Fork 1). */
  gameState!: GameState;

  /**
   * The match's secret PRNG seed (commit-reveal, ADR-0009 Fork 3) — true JS
   * private field, so it is unreachable outside this class (never
   * `GameState`, never the Schema, never broadcast, never logged). Revealed
   * only at `game.ended`, only into match metadata (S1.4.3).
   */
  #seed!: Seed;

  /**
   * The match's rule profile id (S2.1.1/S2.1.6), fixed at `onCreate` from the
   * room option (default `'classic'`). Emitted in `match.started` and read at
   * `#startMatch` to decide neutral placement — the pure engine itself resolves
   * rules from `state.profileId` (`loadRuleProfile`), never from this field.
   */
  #profileId: RuleProfileId = 'classic';

  /**
   * The one-way reveal latch (S1.4.3 / ADR-0009 invariant #4). Flips exactly
   * once, when the first batch carrying `game.ended` is applied; guards against
   * a double-reveal. Set BEFORE the (possibly async) metadata write so no
   * re-entrant batch can slip a second reveal through.
   */
  #seedRevealed = false;

  /**
   * One-shot latch for the durable `recordMatchStart` (S2.6.3). Flips once, when
   * the genesis batch has been appended + committed, so a re-entrant start can
   * never double-insert the `matches` row. A pure metadata side-effect, isolated
   * from the deterministic core exactly like {@link #seedRevealed}.
   */
  #matchStartRecorded = false;

  /**
   * One-shot latch for the durable `recordMatchResult` (S2.6.3). Flips once, on
   * the first `game.ended` batch, alongside {@link #seedRevealed} — guards the
   * result write + per-seat `match_players` inserts against a double-fire.
   */
  #matchResultRecorded = false;

  /**
   * The log-append seam (S1.4.2): every validated batch is handed here and
   * awaited BEFORE broadcast/commit. Public so a test can read/replace what the
   * pipeline appended; production uses the durable {@link FsEventSink} (S1.4.4b)
   * selected by the `matchesDir` room option, tests inject an in-memory buffer.
   */
  eventSink!: GameEventSink;

  /**
   * The seed-reveal seam (S1.4.3): the secret seed is written here exactly
   * once, only after `game.ended`. Public so a test can assert the reveal
   * fired with the exact seed; S1.7.3 swaps the default in-memory store for
   * the durable writer via the `metadataStore` room option.
   */
  matchMetadataStore!: MatchMetadataStore;

  /**
   * The per-room intent SERIALIZATION queue (lead-review fix, post-S1.4.4b):
   * Colyseus dispatches `onMessage` handlers via a synchronous EventEmitter —
   * it does NOT await or serialize an async handler, so two `intent`s arriving
   * in the same tick would otherwise both call `#handleIntent` concurrently.
   * With a genuinely async sink (`FsEventSink`'s `await appendFile`), that opens
   * a TOCTOU window: a second intent's `validate` would run against the FIRST
   * intent's still-uncommitted `this.gameState` (commit happens only after the
   * first `append` resolves), so both could validate against the same stale
   * state — a double-spend / duplicate-`eventIndex` fairness break. Chaining
   * every intent onto this promise ensures intent N's ENTIRE pipeline
   * (validate → persist → commit → broadcast → reveal) fully settles before
   * intent N+1 begins — one queue per room instance (an own field, not static),
   * so rooms never serialize against each other. `#handleIntent` itself never
   * throws (every path is caught internally, S1.4.4b), so the `.catch` here is
   * a pure safety net: it exists ONLY so a future regression that lets an error
   * through can never wedge the queue for subsequent intents or escape as an
   * unhandled rejection.
   */
  #queue: Promise<void> = Promise.resolve();

  /**
   * The one-way match-start latch (S1.7.2): flips exactly once, when the last
   * seat needed to reach the room's start condition is taken, so seating the
   * final player triggers the `match.started` + `board.generated` genesis
   * batch a single time — a re-entrant/duplicate `onJoin` can never fire a
   * second start. Set synchronously in `onJoin` BEFORE the (async) enqueue so
   * two joins landing in the same tick can't both pass the guard.
   */
  #matchStarted = false;

  /**
   * The turn-timer scheduler (S2.1.4). Production: a thin wrapper over
   * `this.clock` — the room's ONLY wall-clock, lifecycle-bound + auto-cleared on
   * dispose (never `Date.now()`/`setTimeout` scattered elsewhere; the
   * deterministic core never sees a clock at all). Tests inject a manual one.
   */
  #scheduler!: TurnTimerScheduler;

  /**
   * The currently-armed HARD turn timer (S2.1.4), or `undefined` when none is
   * armed (lobby/finished/setup). Cleared + replaced on every re-arm.
   */
  #hardTimer: RoomTimer | undefined = undefined;

  /**
   * A monotonically-increasing arm generation (S2.1.4). Every arm/disarm bumps
   * it; a fired timeout captures the generation it was armed with and no-ops if
   * it no longer matches — i.e. any committed action since (which always re-arms)
   * has superseded it. This is how "a real action taken just before cancels the
   * forced one" is realized even in the rare case the old timer already fired and
   * queued before a real intent's commit re-armed a fresh one ([[server-intent-pipeline-serialization]]).
   */
  #turnTimerGeneration = 0;

  /**
   * Per-player consecutive force-completed turns (anti-AFK, S2.1.4) — incremented
   * when the server force-completes a player's decision on a hard timeout, reset
   * to 0 on any real committed intent from that player. Lives in ROOM memory (a
   * seat projection mirrors it), NOT `GameState`/the log: it is session/liveness
   * metadata S2.3.3 will act on, never a game rule.
   */
  #consecutiveTimeouts = new Map<PlayerId, number>();

  /**
   * Bot seats seated at genesis (S2.4.3), keyed by their server-minted
   * `playerId`. A `Bot` holds NO authority — it only proposes intents via
   * `decide(state, playerId)` (no seed param); ONLY `validate` (fed the room's
   * real secret seed) ever mutates state. Empty for every room that doesn't
   * request `bots` — a plain human-only Classic room never touches this map.
   */
  #bots = new Map<PlayerId, Bot>();

  /** {@link GameRoomOptions.botActionCap}, resolved at `onCreate`. */
  #botActionCap = DEFAULT_BOT_ACTION_CAP;

  /** {@link GameRoomOptions.reconnectGraceSeconds}, resolved at `onCreate` (S2.3.1). */
  #reconnectGraceSeconds = DEFAULT_RECONNECT_GRACE_SECONDS;

  /** {@link GameRoomOptions.botFillDifficulty}, resolved at `onCreate` (S2.3.3). */
  #botFillDifficulty: Difficulty = 'medium';

  /**
   * {@link GameRoomOptions.isPrivate}, resolved at `onCreate` (S2.5.2, first
   * read by S2.5.3 only for `setPrivate`). Gates `#maybeAutoStart` (a private
   * room is manual-start only — `#handleStartMatch` is its sole trigger) and
   * is echoed on every `state.snapshot` (`#sendSnapshot`) so a client can tell
   * a manual-start room from an auto-starting quick match without depending
   * on its own remembered join mode (survives a reload).
   */
  #isPrivate = false;

  /**
   * The one-way game-end close latch (S2.3.3): flips exactly once, when the
   * `game.ended` batch is applied, so the consented client-close is scheduled a
   * single time. Guards against a re-entrant/duplicate schedule (core freezes to
   * `'finished'` at `game.ended`, so no further batch is even possible, but the
   * latch keeps the intent explicit).
   */
  #gameEndClosing = false;

  /**
   * The per-turn bot-action counter (S2.4.3 no-hang discipline) + the
   * `state.turn` it was last reset for. Reset whenever `state.turn` advances
   * (a new turn starts fresh), so the cap bounds "steps without this turn
   * ending," not the whole match.
   */
  #botActionsThisTurn = 0;
  #botActionsTrackedTurn = -1;

  /**
   * {@link GameRoomOptions.verifySessionToken}, resolved at `onCreate` (S2.6.2a).
   * A DEFINE-time server config (bound to `SESSION_SECRET` in `boot.ts`), never
   * a client field — read in `onAuth` to verify a presented `sessionToken`.
   * `undefined` when auth isn't configured (a supplied token is then ignored).
   */
  #verifySessionToken?: VerifySessionToken;

  override async onCreate(options?: GameRoomOptions): Promise<void> {
    this.maxClients = options?.maxSeats ?? DEFAULT_MAX_SEATS;
    // S2.6.2a: the session-token verifier is a define-time server option (bound
    // to the resolved secret in `boot.ts`), stored here for `onAuth`. A client
    // cannot inject it — `JoinOptionsSchema.strict()` forbids the key on the
    // wire, and `onAuth`'s strict gate rejects any such join before it is read.
    if (options?.verifySessionToken !== undefined) {
      this.#verifySessionToken = options.verifySessionToken;
    }
    // The match's rule profile (S2.1.1/S2.1.6) — Classic by default (production
    // has no lobby mode selection yet, S2.5.4); a `twoPlayer` room places
    // neutral blockers at genesis (`#startMatch`). Byte-unchanged for the default.
    this.#profileId = options?.profileId ?? 'classic';
    // Private rooms (S2.5.3): excludes this room from `joinOrCreate`'s listing
    // so only a `client.joinById(roomId)` holding this room's own id can reach
    // it. `onCreate` is now `async` (colyseus's `MatchMaker` already awaits its
    // returned promise regardless — verified against `MatchMaker.mjs`) so this
    // resolves before any join can observe the room, closing the theoretical
    // race a fire-and-forget `void setPrivate(...)` would leave open. Absent
    // for every existing room (production default `false`) — byte-unchanged.
    this.#isPrivate = options?.isPrivate ?? false;
    if (options?.isPrivate) {
      await this.setPrivate(true);
    }
    // Persist wiring (S1.4.4b): an explicit `sink` wins (tests inject in-memory);
    // otherwise `matchesDir` (production) selects the durable ndjson writer keyed
    // to this room's id; with neither, the in-memory default keeps dev/test runs
    // off the filesystem.
    this.eventSink =
      options?.sink ??
      (options?.matchesDir !== undefined
        ? new FsEventSink({ matchId: this.roomId, matchesDir: options.matchesDir })
        : new InMemoryEventSink());
    // Reveal wiring (S1.7.3), mirroring the sink above: an explicit store wins;
    // otherwise `matchesDir` selects the durable sidecar writer (same dir/id as
    // the log, so one `:id` addresses both); with neither, in-memory keeps
    // dev/test off the filesystem.
    this.matchMetadataStore =
      options?.metadataStore ??
      (options?.matchesDir !== undefined
        ? new FsMatchMetadataStore({ matchesDir: options.matchesDir })
        : new InMemoryMatchMetadataStore());

    // Fixed injected seed (S1.7.2 E2E: reproducible board + rolls) or a fresh
    // CSPRNG seed (production). Either way it stays a server secret — only its
    // hash is ever published (commit-reveal, ADR-0009 Fork 3).
    this.#seed = options?.seed ?? generateSeed();
    const seedHash = sha256Hex(this.#seed);

    this.gameState = {
      matchId: this.roomId,
      phase: 'lobby',
      turn: 0,
      currentPlayerId: '',
      players: [],
      eventIndex: 0,
      seedHash,
    };

    this.state = createRoomSchema({
      seedHash,
      phase: this.gameState.phase,
      currentPlayerId: this.gameState.currentPlayerId,
    });

    // Turn-timer wiring (S2.1.4): production schedules through `this.clock` — the
    // room's ONLY wall-clock (lifecycle-bound, auto-cleared on dispose). A test
    // injects a manual scheduler to fire timeouts deterministically. Either way
    // NO wall-clock ever reaches `@skervik/core`.
    this.#scheduler = options?.turnTimerScheduler ?? {
      setTimeout: (callback, ms) => this.clock.setTimeout(callback, ms),
    };

    this.#botActionCap = options?.botActionCap ?? DEFAULT_BOT_ACTION_CAP;
    this.#reconnectGraceSeconds =
      options?.reconnectGraceSeconds ?? DEFAULT_RECONNECT_GRACE_SECONDS;
    this.#botFillDifficulty = options?.botFillDifficulty ?? 'medium';

    // Bot-seat creation at genesis (S2.4.3): a bot seat has no live `Client`,
    // so — unlike a human seat — it cannot be minted in `onJoin`. Each `bots`
    // entry becomes one stable `'bot-N'` seat + a `Bot` brain stored in
    // `#bots`. The bot's OWN noise seed is `bot-${seatIndex}` — NEVER the
    // match's secret `#seed` — so a single-player match stays reproducible
    // from the same room options without coupling the bot to commit-reveal.
    (options?.bots ?? []).forEach((spec, i) => {
      this.#mintBotSeat(spec.difficulty, i);
    });

    // The authoritative intent pipeline (S1.4.2), SERIALIZED per room (see
    // `#queue` doc): each intent is chained onto the room's queue rather than
    // dispatched as an independent floating promise, so a durable async sink
    // can never open a window where a second intent validates against a
    // not-yet-committed state.
    this.onMessage('intent', (client, message: unknown) => {
      this.#enqueueIntent(client, message);
    });

    // Host-only manual match start (S2.5.2): a private room's ONLY start
    // trigger — `#maybeAutoStart` skips it entirely (see that method's
    // updated guard). No payload, no reply on either success or a silent
    // ignore: this is a lobby control message (host-only, private-room-only),
    // never a gameplay `validate`/`intent.rejected` concern, so it stays off
    // the S1.4.2 intent/reject channel entirely.
    this.onMessage('startMatch', (client) => {
      this.#handleStartMatch(client);
    });

    // Bots alone can already fill the room (a pure bot-vs-bot room, or the
    // last human-optional seat) — mirror `onJoin`'s seats-full auto-start latch
    // (S2.4.3 reuses `#startMatch`, never a second start path).
    this.#maybeAutoStart();
  }

  /**
   * Chains one intent's handling onto the room's serialization queue (see
   * `#queue` doc) — never dispatches `#handleIntent` directly. The `.catch` is
   * a safety net only: `#handleIntent` already catches everything it can throw,
   * so this exists purely to guarantee the queue can never wedge (a rejected
   * link would otherwise permanently stall every subsequent intent) or escape
   * as an unhandled rejection.
   */
  #enqueueIntent(client: Client, message: unknown): void {
    this.#queue = this.#queue
      .then(() => this.#handleIntent(client, message))
      .catch((error: unknown) => {
        this.#logInternalError(
          'intent queue link threw unexpectedly (should be unreachable)',
          error,
        );
      });
  }

  /**
   * The seats-full auto-start latch (S1.7.2, generalized by S2.4.3 to count
   * bot seats too): fires `#startMatch` exactly once, the moment the room's
   * seat count (human + bot) reaches `maxClients` — from `onJoin` (a human
   * fills the last seat) or from `onCreate` itself (bots alone already fill a
   * bot-vs-bot room). The latch is set synchronously BEFORE the async enqueue
   * so a re-entrant call can never fire a second start, and the start batch
   * rides the SAME per-room `#queue` as every intent.
   */
  #maybeAutoStart(): void {
    // Private rooms are manual-start only (S2.5.2): `#handleStartMatch` is
    // their sole start trigger, even once every seat is technically full —
    // the host may still be waiting on one more friend to click the invite
    // link. Quick-match (the default, `#isPrivate === false`) is unchanged.
    if (this.#isPrivate) return;
    if (this.#matchStarted || this.state.seats.length < this.maxClients) return;
    this.#matchStarted = true;
    this.#queue = this.#queue
      .then(() => this.#startMatch())
      .catch((error: unknown) => {
        this.#logInternalError('match-start queue link threw unexpectedly', error);
      });
  }

  /**
   * Mints ONE brand-new server-owned bot seat with playerId `bot-${index}`
   * and a fresh `Bot` brain. Extracted from `onCreate`'s genesis `options.bots`
   * loop (S2.4.3) so S2.5.2's host-start pre-fill (`#handleStartMatch`) can
   * share the EXACT same minting logic instead of a second bot-mint path.
   *
   * DEVIATION (reported per the story's own contingency): the story asked to
   * reuse `#botFillSeat` (S2.3.3) for pre-start fill, but that method solves a
   * different problem — it converts an ALREADY-SEATED (human) seat into a
   * bot-driven one, and explicitly no-ops in `'lobby'` phase (`if
   * (this.gameState.phase === 'finished' || this.gameState.phase === 'lobby')
   * return;`), which is exactly the phase a pre-start fill runs in; it also
   * has no existing seat/playerId to key off for a slot that was NEVER
   * occupied. Rather than duplicate a second bot-mint code path, this shares
   * the ONE that already existed (previously inlined here), so there is still
   * exactly one bot-mint path — just not the specific method the story named.
   */
  #mintBotSeat(difficulty: Difficulty, index: number): void {
    const playerId = `bot-${index}` as PlayerId;
    const seat = new SeatSchema().assign({
      playerId,
      seatIndex: this.state.seats.length,
      connected: true,
      consecutiveMisses: 0,
      idle: false,
      isBot: true,
      botDifficulty: difficulty,
    });
    this.state.seats.push(seat);
    this.#bots.set(playerId, createHeuristicBot({ difficulty, seed: `bot-${index}` }));
  }

  /**
   * The host-only manual match-start trigger (S2.5.2) — a private room's ONLY
   * way to start, since `#maybeAutoStart` skips it entirely. A no-op (no
   * reply — see the `onMessage('startMatch', …)` registration doc) unless
   * ALL of: the room is private, the match hasn't already started, and the
   * sender IS the host (seat 0 — the `createPrivate` creator; seat 0 is never
   * reassigned after genesis). On a valid press: bot-fill whatever seats are
   * still empty up to `maxClients` (via `#mintBotSeat`, shared with the
   * genesis path — see its doc), then hand off to the EXISTING `#startMatch`
   * genesis pipeline through the room's `#queue` — the identical path
   * `#maybeAutoStart` uses, so a manually-started private match is
   * indistinguishable from an auto-started one once it begins.
   *
   * The `#matchStarted` latch is set synchronously, BEFORE the bot-fill loop
   * and the async enqueue — same discipline as `#maybeAutoStart` — so a
   * re-entrant/duplicate Start press can never mint bots or start twice.
   */
  #handleStartMatch(client: Client): void {
    if (!this.#isPrivate) return;
    if (this.#matchStarted) return;
    const hostSeat = this.state.seats[0];
    if (!hostSeat || hostSeat.playerId !== client.sessionId) return;

    this.#matchStarted = true;
    let index = this.state.seats.length;
    while (this.state.seats.length < this.maxClients) {
      this.#mintBotSeat(this.#botFillDifficulty, index);
      index += 1;
    }
    this.#queue = this.#queue
      .then(() => this.#startMatch())
      .catch((error: unknown) => {
        this.#logInternalError('host-start queue link threw unexpectedly', error);
      });
  }

  /**
   * The match-start genesis batch (S1.7.2): folds the two events that turn the
   * lobby `GameState` into a playable Classic game and drives them through the
   * SAME persist-before-commit pipeline as every intent (`#handleIntent`'s
   * tail) — PERSIST the batch first, and only on a successful append commit the
   * authoritative state, refresh the public projection, and broadcast. Not a
   * side channel: no client ever observes a start event that was not durably
   * logged, exactly like a gameplay event.
   *
   * - `match.started` fixes the seated `playerOrder` (seat order) and moves the
   *   phase to `setup` (`reduce`), so the snake-draft (S1.1.3) can begin.
   * - `board.generated` carries the deterministic Classic layout from the
   *   room's secret `#seed` (`generateBoard`, the SAME path S1.6.1's dev
   *   fixture uses) — a fixed seed ⇒ a fixed board, no wall-clock / ambient RNG.
   *
   * The two hand-built genesis events (there is no player intent for them,
   * S1.4.1) keep `@skervik/core` byte-unchanged. Never throws: an append
   * failure leaves `this.gameState` untouched (assignment happens only after
   * `append` resolves) and is logged with the public `seedHash` only.
   */
  async #startMatch(): Promise<void> {
    const playerIds = this.state.seats.map((seat) => seat.playerId as PlayerId);

    const matchStarted: MatchStartedEvent = {
      type: 'match.started',
      index: this.gameState.eventIndex,
      matchId: this.gameState.matchId,
      seedHash: this.gameState.seedHash,
      playerIds,
      // The match's rule profile (S2.1.1/S2.1.6) — the room's `#profileId`
      // (Classic by default; `twoPlayer` for a 2p room). Lobby mode selection is
      // S2.5.4. Carried in the log so replay/verify resolve the same rules
      // (event-sourcing). The pure engine reads it via `state.profileId` +
      // `loadRuleProfile` — no behavior change from M1 for the Classic default.
      profileId: this.#profileId,
    };
    const afterStart = reduce(this.gameState, matchStarted);

    // The layout is generated from the SECRET seed (never serialized) — the
    // full board travels as event data so replay never re-runs the generator
    // (ADR-0003). The board sub-profile comes from the resolved rule profile —
    // `twoPlayer` uses the standard Classic board (S2.1.6: phantom on the
    // standard board, no topology divergence), so this is byte-identical to the
    // M1 path for every current profile. `board.generated`'s index continues
    // from the post-start `eventIndex`, so both events form one contiguous batch.
    const profile = loadRuleProfile(this.#profileId);
    const topology = buildTopology();
    const layout = generateBoard(this.#seed, topology, profile.board);
    const boardGenerated: BoardGeneratedEvent = {
      type: 'board.generated',
      index: afterStart.eventIndex,
      tileKinds: layout.tileKinds,
      tileTokens: layout.tileTokens,
      portContents: layout.portContents,
      robberTileId: layout.robberTileId,
    };
    const afterBoard = reduce(afterStart, boardGenerated);

    // Neutral/phantom blockers (S2.1.6): a profile with `neutralSettlements` set
    // (only `twoPlayer` today) places that many neutral settlements at genesis,
    // right after `board.generated` and before the setup draft. The placement is
    // a DETERMINISTIC function of the public board (`neutralPlacementEvents`) —
    // NO seed draw, so it needs no PRNG slot and the fair-RNG verifier folds
    // these as plain events. Empty (`[]`) for every non-`twoPlayer` profile, so
    // the Classic genesis batch stays exactly `[match.started, board.generated]`.
    const neutralEvents: NeutralPlacedEvent[] = neutralPlacementEvents(
      layout,
      profile.neutralSettlements ?? 0,
      afterBoard.eventIndex,
      topology,
    );

    const events: GameEvent[] = [matchStarted, boardGenerated, ...neutralEvents];
    const nextState = events.reduce(
      (state, event) => reduce(state, event),
      this.gameState,
    );

    try {
      // PERSIST first (same ordering invariant as `#handleIntent`): only on a
      // successful append do we commit + broadcast.
      await this.eventSink.append(events);
      this.gameState = nextState;
      this.state.phase = this.gameState.phase;
      this.state.currentPlayerId = this.gameState.currentPlayerId;

      const batch: EventBatchMessage = {
        v: 1,
        type: 'event.batch',
        payload: events,
      };
      this.broadcast(batch.type, batch);

      // Arm the turn timer for the freshly-started match (S2.1.4). The genesis
      // batch lands the game in `setup`, so this arms only the soft-warning
      // presentational field — setup auto-placement is DEFERRED (no hard forced
      // action), the first hard timer arms once real setup placements reach `roll`.
      this.#armTurnTimer();

      // Trigger point 2/2 (S2.4.3): a bot placing FIRST in the snake draft (or
      // acting first at all) needs to be driven right after genesis — the
      // other trigger is the commit tail of every subsequent intent.
      this.#scheduleBotTurnIfNeeded();

      // Durable match metadata (S2.6.3): record the freshly-started match — a
      // PURE side-effect on the queue tail, AFTER append + commit + broadcast,
      // exactly like the `game.ended` reveal. It is NOT a `GameEvent`, never
      // enters `events.ndjson`, never feeds `reduce`/`validate` (ADR-0009 Fork
      // 3), so it cannot perturb the deterministic core. Best-effort + latched:
      // any failure is caught + logged and the match continues; the wall-clock
      // `startedAt` lives ONLY here (never in core / the log).
      this.#recordMatchStart(profile);
    } catch (error) {
      // Append failed: state was NOT advanced, nothing broadcast. Log with the
      // public seedHash only (never the raw seed) and swallow — nothing escapes
      // this voided handler as an unhandled rejection.
      this.#logInternalError(
        'failed to persist the match-start batch; state left uncommitted',
        error,
      );
    }
  }

  /**
   * Fires the best-effort `recordMatchStart` metadata write (S2.6.3), guarded by
   * the one-shot {@link #matchStartRecorded} latch. A metadata failure is caught
   * + logged and NEVER propagates — the match must never crash or block on a
   * secondary durability write. `eventLogUri` is the FS log path when durable,
   * omitted for an in-memory sink.
   */
  #recordMatchStart(profile: ReturnType<typeof loadRuleProfile>): void {
    if (this.#matchStartRecorded) return;
    this.#matchStartRecorded = true;
    const eventLogUri =
      this.eventSink instanceof FsEventSink ? this.eventSink.filePath : undefined;
    void Promise.resolve(
      this.matchMetadataStore.recordMatchStart(this.gameState.matchId, {
        roomId: this.gameState.matchId,
        profile,
        seedHash: this.gameState.seedHash,
        playerCount: this.state.seats.length,
        startedAt: new Date(),
        ...(eventLogUri !== undefined ? { eventLogUri } : {}),
      }),
    ).catch((error: unknown) => {
      this.#logInternalError('recordMatchStart failed (metadata is best-effort)', error);
    });
  }

  /**
   * Resolves a seat to its token-authenticated `userId` (S2.6.3), or `undefined`
   * for a bot seat OR a human seat that presented no session token — both persist
   * as a NULL `user_id`/`winner_id`. The `PlayerId` (seat/sessionId) is unchanged;
   * this is a metadata-only lookup on the non-authoritative `client.userData` bag
   * (set in `onAuth`).
   */
  #resolveUserIdForSeat(seatIndex: number): string | undefined {
    const seat = this.state.seats[seatIndex];
    if (!seat || seat.isBot) return undefined;
    const client = this.clients.find((c) => c.sessionId === seat.playerId);
    return (client?.userData as { userId?: string } | undefined)?.userId;
  }

  /**
   * Assembles the `recordMatchResult` payload (S2.6.3) from the AUTHORITATIVE
   * `game.ended` event — `winnerId` + `finalStandings` are core's own tally
   * (`computeVictoryPoints`, public + hidden), never a server-side re-derivation.
   * One entry per seat: `'win'` for the winner, `'abandoned'` for a dropped
   * non-bot seat, else `'loss'`. The `finishedAt` wall-clock lives ONLY here.
   */
  #buildMatchResult(event: GameEndedEvent): MatchResultMetadata {
    const playerResults: MatchPlayerResultMetadata[] = this.state.seats.map((seat, i) => {
      const userId = this.#resolveUserIdForSeat(i);
      const result: MatchPlayerResult =
        seat.playerId === event.winnerId
          ? 'win'
          : !seat.isBot && !seat.connected
            ? 'abandoned'
            : 'loss';
      return {
        seat: i,
        finalVp: event.finalStandings[seat.playerId as PlayerId] ?? 0,
        result,
        ...(userId !== undefined ? { userId } : {}),
      };
    });
    const winnerSeatIndex = this.state.seats.findIndex(
      (s) => s.playerId === event.winnerId,
    );
    const winnerUserId =
      winnerSeatIndex >= 0 ? this.#resolveUserIdForSeat(winnerSeatIndex) : undefined;
    return {
      seed: this.#seed,
      finishedAt: new Date(),
      playerResults,
      ...(winnerUserId !== undefined ? { winnerUserId } : {}),
    };
  }

  /**
   * The protocol-version handshake gate (S1.5.2). Colyseus calls `onAuth`
   * BEFORE `onJoin`/seat assignment, and a throw here cleans up the reserved
   * seat and fails the join — so a version-incompatible client NEVER enters the
   * room (no seat, no `state.snapshot`, no broadcast, no state mutation). We
   * `safeParse` the client-supplied join `options` and compare the presented
   * `protocolVersion` against the single-source `PROTOCOL_VERSION` via the ONE
   * compatibility helper. On mismatch (or missing/malformed options) we throw a
   * Colyseus `ServerError` whose message is the JSON of the typed
   * `error.version` message, so the rejection reason survives the transport and
   * E1.6's client can `JSON.parse` it and validate it against
   * `ServerMessageSchema` to render a precise "update required" prompt.
   * A compatible client returns `true` and proceeds to the unchanged
   * `onJoin`/seat/`state.snapshot` path.
   *
   * S2.5.4 security requirement: `@skervik/core`'s `PROFILE_REGISTRY` is keyed
   * by `string` and resolves six measurement-only profiles in addition to the
   * four shipping presets (`EXPERIMENTAL_PROFILE_IDS`); `onCreate` trusts
   * `options?.profileId`/`options?.bots` at the TypeScript type level ONLY —
   * there is no runtime check there. This is where the check actually lives:
   * `JoinLobbySelectionSchema.safeParse` is the explicit allow-list (an
   * experimental or unknown `profileId`, or a malformed `bots` roster, fails
   * to parse), and colyseus 0.17's `joinOrCreate` AWAITS `onAuth` to fully
   * resolve before it ever calls `onCreate` with this SAME client-supplied
   * options object (verified against `@colyseus/core`'s `MatchMaker.ts`) — so
   * a rejection here means `onCreate`/`loadRuleProfile` never sees the bad
   * value at all; the room is never created, the join promise just rejects
   * (nothing crashes).
   *
   * 🔴 Security follow-up (`[[room-options-are-client-input]]`): `onCreate`
   * reads MANY MORE `GameRoomOptions` fields directly off this SAME raw
   * options object with no runtime check of its own — most seriously `seed`
   * (`this.#seed = options?.seed ?? generateSeed()`), also `maxSeats`,
   * `botActionCap`, `botFillDifficulty`. A client that could smuggle its own
   * `seed` through would know every future die roll while commit-reveal still
   * "verifies" (the server honestly reveals whatever seed it was handed) —
   * the exact reputational failure provably-fair RNG exists to prevent.
   * `JoinOptionsSchema.safeParse` (STRICT — see its own doc) is the final gate:
   * ANY key outside the full wire allow-list fails the whole join, not just
   * that field silently dropped. Checked LAST (after the two schemas above
   * already gave their own specific rejections for a bad version/lobby pick)
   * so a legitimately-shaped-but-extended payload gets this SPECIFIC reason.
   */
  override async onAuth(client: Client, options: unknown): Promise<boolean> {
    const parsed = ConnectOptionsSchema.safeParse(options);
    // The raw value the client presented, reported back for a precise client
    // message: the parsed string on a structurally-valid handshake, else null
    // (missing options or a non-string `protocolVersion`).
    const clientVersion = parsed.success ? parsed.data.protocolVersion : null;
    if (!parsed.success || !isCompatibleProtocolVersion(clientVersion)) {
      const message: VersionErrorMessage = {
        v: 1,
        type: 'error.version',
        payload: {
          code: 'PROTOCOL_VERSION_MISMATCH',
          serverVersion: PROTOCOL_VERSION,
          clientVersion,
        },
      };
      throw new ServerError(PROTOCOL_VERSION_MISMATCH_CODE, JSON.stringify(message));
    }

    const lobby = JoinLobbySelectionSchema.safeParse(options);
    if (!lobby.success) {
      // A plain string message (not the `error.version` JSON envelope) — the
      // client's `parseJoinError` already degrades anything that isn't a
      // valid `error.version` payload to a generic `error` status, so no
      // client-side change was needed to correctly NOT report this as a
      // version mismatch.
      throw new ServerError(INVALID_LOBBY_SELECTION_CODE, 'invalid lobby selection');
    }

    if (!JoinOptionsSchema.safeParse(options).success) {
      throw new ServerError(INVALID_JOIN_OPTIONS_CODE, 'unrecognized join option');
    }

    // Grace floor (discharges the S2.3.1 nit): a WIRE-supplied
    // `reconnectGraceSeconds` override can never undercut the ≥120s "no
    // karmic bans" product law (CLAUDE.md). Mutated IN PLACE on the raw
    // `options` object — colyseus reuses this EXACT reference for the
    // room-creating client's later `onCreate` call, so this is the only seam
    // available to sanitize a value before the room ever reads it. The
    // internal `GameRoomOptions.reconnectGraceSeconds` test seam (S2.3.1)
    // never reaches `onAuth` at all — `@colyseus/testing`'s `createRoom()`
    // bypasses every matchmaker entry point that calls it — so this can NEVER
    // clamp a test's deliberately tiny fast-expiry value.
    if (
      lobby.data.reconnectGraceSeconds !== undefined &&
      options !== null &&
      typeof options === 'object'
    ) {
      (options as { reconnectGraceSeconds?: number }).reconnectGraceSeconds = Math.max(
        DEFAULT_RECONNECT_GRACE_SECONDS,
        lobby.data.reconnectGraceSeconds,
      );
    }

    // S2.6.2a — durable-guest session token. `parsed` succeeded above, so
    // `sessionToken` is a validated optional string. Only acted on when a
    // verifier is configured (DB/auth wired via `boot.ts`); an unconfigured
    // room (every existing test) ignores any token entirely, unchanged.
    //   • ABSENT token  → proceed as a fresh guest (backward compatible).
    //   • PRESENT+VALID → attach the resolved durable `userId` to the
    //     per-connection `client.userData` bag — NON-authoritative metadata for
    //     S2.6.3 match attribution; the seat `PlayerId` stays the `sessionId`
    //     (ADR-0009), so a forged/replayed token can re-attach a display
    //     identity at most, never impersonate another player's MOVES.
    //   • PRESENT+INVALID → REJECT (4004). Never silently downgraded to
    //     anonymous — a bad signature/expiry is treated as tampering, made loud.
    const { sessionToken } = parsed.data;
    if (this.#verifySessionToken !== undefined && sessionToken !== undefined) {
      const claims = await this.#verifySessionToken(sessionToken);
      if (claims === null) {
        throw new ServerError(AUTH_TOKEN_INVALID_CODE, 'invalid session token');
      }
      client.userData = { userId: claims.userId };
    }

    return true;
  }

  override onJoin(client: Client): void {
    const seat = new SeatSchema().assign({
      playerId: client.sessionId as PlayerId,
      seatIndex: this.state.seats.length,
      connected: true,
      consecutiveMisses: 0,
      idle: false,
      isBot: false,
      botDifficulty: '',
    });

    // S2.5.4 (discharges an S2.4.3 lead-review nit): bot seats are minted
    // synchronously at genesis (`onCreate`), before any human ever joins — so
    // the FIRST human to join a bot-pre-seeded room would otherwise always
    // land at the LAST `seatIndex`, never the snake-draft's first pick.
    // `#startMatch` builds `playerOrder` by mapping `this.state.seats` in
    // ARRAY order, so unshifting the human to the front (and renumbering the
    // bots after it) is what actually moves them into the first placement,
    // not just a cosmetic `seatIndex` swap. Only applies when EVERY seat
    // minted so far is a bot (this is that first human join) — a room with no
    // bots (the M1 default) or any join after the first human is unaffected,
    // and a PURE bot-vs-bot room (no human ever joins) never reaches `onJoin`
    // at all, so its genesis seat order stays exactly as `onCreate` left it.
    const allExistingSeatsAreBots =
      this.state.seats.length > 0 && this.state.seats.every((s) => s.isBot);
    if (allExistingSeatsAreBots) {
      seat.seatIndex = 0;
      this.state.seats.unshift(seat);
      this.state.seats.forEach((s, i) => {
        s.seatIndex = i;
      });
    } else {
      seat.seatIndex = this.state.seats.length;
      this.state.seats.push(seat);
    }

    this.#sendSnapshot(client);

    // Match-start orchestration (S1.7.2/S2.4.3): when the last seat needed to
    // reach the start condition (the room's full seat cap, bot seats included)
    // is taken, auto-start the match — no lobby-ready UI / host button for M1
    // (later). See `#maybeAutoStart` for the latch discipline.
    this.#maybeAutoStart();
  }

  /**
   * Mint + unicast a fresh `StateSnapshotMessage` (the CURRENT authoritative
   * `gameState`, NO seed — `PublicGameState`) to ONE client (S2.3.2). Extracted
   * from the join path so the exact same minting is reused at the S2.3.1
   * reclaim seam below: Colyseus takes the `onReconnect` path on a reconnect,
   * never `onJoin`, so the reclaimed client would otherwise never get the
   * authoritative core `gameState` its board depends on. Never a `broadcast` —
   * only the given client receives it.
   */
  #sendSnapshot(client: Client): void {
    const snapshot: StateSnapshotMessage = {
      v: 1,
      type: 'state.snapshot',
      payload: this.gameState,
      // S2.5.2: transport-only host/manual-start signals — NEVER on
      // `GameState`/an event. Recomputed at EVERY snapshot send (join, and
      // every reconnect/reclaim unicast, S2.3.1/S2.3.2), so a reloaded host
      // regains its Start-match affordance without depending on any
      // client-remembered join mode.
      isHost: this.state.seats[0]?.playerId === client.sessionId,
      isPrivate: this.#isPrivate,
    };
    client.send(snapshot.type, snapshot);
  }

  /**
   * The non-consented-drop hook (S2.3.1, "no karmic bans" product law).
   * Colyseus 0.17 splits the M1-era single `onLeave(client, consented)` into
   * three hooks — `onDrop` (network drop, no consent), `onLeave` (a consented
   * `.leave()`, and the FINAL notice once a drop's grace expires with no
   * reconnect), `onReconnect` (unused here — the reclaim runs off the
   * `allowReconnection` promise directly, see below) — and dispatches to
   * `onDrop` whenever the close code isn't `CloseCode.CONSENTED`. This is
   * exactly the primitive the framework's own docs recommend for this purpose.
   *
   * Marks the seat absent, then HOLDS it via the native `allowReconnection`
   * for `#reconnectGraceSeconds`: the returned promise RESOLVES if the same
   * session reconnects in time (reclaim: flip `connected` back) or REJECTS on
   * timeout (grace expired — the seat simply stays `connected:false`, no
   * forfeit, no removal; bot-fill of an expired hold is S2.3.3). Neither
   * branch touches the authoritative `gameState` or appends an event — this
   * is a pure transport-layer projection update, so determinism/replay stays
   * byte-untouched. The turn timer (S2.1.4) is completely unaffected: it keeps
   * arming/firing off `gameState` alone, so an absent CURRENT player still
   * gets forced past on schedule while their seat sits in grace.
   */
  override onDrop(client: Client): void {
    const seat = this.state.seats.find((s) => s.playerId === client.sessionId);
    if (seat) seat.connected = false;

    this.allowReconnection(client, this.#reconnectGraceSeconds)
      .then(() => {
        if (seat) seat.connected = true; // reclaimed within grace — same seat, same playerId
        // S2.3.2: unicast a fresh authoritative snapshot to THIS reclaimed
        // client — the reconnect took the `onReconnect` path, not `onJoin`, so
        // its core `gameState` (and anything forced actions advanced while it
        // was away) is otherwise never resent. IMPORTANT: send to the LIVE
        // client Colyseus just re-registered in `this.clients` — NOT the
        // `client` closed over from this `onDrop` call. Colyseus's own native
        // reconnection swaps in a fresh `Client` for the new connection
        // internally; sending on the stale closed-over reference (even though
        // it still briefly reports an "open" readyState) writes into a socket
        // that never reaches the reconnected client — empirically verified
        // while building this story (zero bytes arrived via the stale ref,
        // every byte via the live one); a Colyseus 0.17 quirk, undocumented.
        const liveClient = this.clients.find((c) => c.sessionId === client.sessionId);
        if (liveClient) this.#sendSnapshot(liveClient);
      })
      .catch(() => {
        // Grace expired with no reconnect (S2.3.3, "no dead time" product law):
        // the seat is not forfeited — instead a bot takes it over so the
        // remaining humans play a real match to a real finish. The seat stays in
        // `state.seats` with `connected:false` (already set above); `#botFillSeat`
        // flips `isBot` + drives it through the S2.4.3 loop. Colyseus still fires
        // `onLeave` once more as the terminal notice for this drop — but with the
        // drop's NON-consented code, so `onLeave`'s consented-gated fill is
        // skipped there (and the `#bots.has` guard would catch it regardless).
        // Fork B: bot-fill happens ONLY on expiry, never during grace —
        // forced-defaults cover the seat while it can still reconnect (S2.3.1).
        if (seat) this.#botFillSeat(seat);
      });
  }

  /**
   * Fires directly for a CONSENTED `.leave()` (deliberate leave — mark
   * disconnected, NO grace hold; the safe-leave/rejoin UX is S2.3.3's
   * boundary). It ALSO fires a second time, via Colyseus's own dispatch, as
   * the terminal notice after a non-consented drop's grace window expires
   * without a reconnect (`onDrop` above) — by then the seat is already
   * `connected:false`, so this is a no-op re-affirmation for that path. It
   * never fires at all on a successful reconnect (Colyseus only invokes it
   * when the `allowReconnection` deferred settles by REJECTION). Either way,
   * the authoritative `gameState` is untouched — only the public projection
   * changes.
   */
  override onLeave(client: Client, code?: number): void {
    const seat = this.state.seats.find((s) => s.playerId === client.sessionId);
    if (seat) seat.connected = false;

    // A CONSENTED leave (S2.3.3, Key decision 3): a deliberate leaver is not
    // coming back mid-match, so the seat is bot-filled IMMEDIATELY (not
    // grace-held) — the remaining humans keep playing. `#botFillSeat` guards
    // against the terminal drop-notice case (the seat is already in `#bots` from
    // the expiry `.catch()` above) and against a finished game (the game-end
    // close, part 3, force-closes clients with the SAME consented code, so this
    // hook fires per seat then too — the `phase:'finished'` guard skips it). We
    // do NOT fill on the FINAL grace-expiry notice via a non-consented code:
    // that path is already handled by the expiry `.catch()`.
    if (seat && code === CloseCode.CONSENTED) this.#botFillSeat(seat);
  }

  /**
   * Installs a fill-bot on an abandoned HUMAN seat (S2.3.3) — the epic-closing
   * "no dead time" capability. Reuses the S2.4.3 bot-drive seam WHOLESALE: the
   * only thing that makes the drive loop treat a seat as a bot actor is its
   * presence in `#bots` (`#nextBotActorId` gates on `#bots.has(playerId)`
   * ALONE), so filling a seat is exactly: mint a `createHeuristicBot`, add it to
   * `#bots`, flip the seat's existing `isBot`/`botDifficulty` client-signal
   * fields (NO new SeatSchema field), and trigger the existing
   * `#scheduleBotTurnIfNeeded` drive. The fill-bot holds NO authority and is
   * MATCH-SEED-BLIND — its noise seed is `bot-fill-${seatIndex}`, never the
   * room's secret `#seed` — and its moves are ORDINARY events (no timestamp /
   * marker), so a drop+bot-fill match replays byte-identically from its log.
   *
   * Three guards keep it correct:
   * - **Already a bot** → no-op: a genesis bot, or an already-filled seat (the
   *   expiry `.catch()` + the terminal `onLeave` both call this for the same
   *   drop). A filled seat = `isBot:true` + `connected:false`, distinguishable
   *   from a genesis bot's `connected:true`.
   * - **`finished`/`lobby` phase** → no-op: nothing to drive once the match is
   *   over (the game-end consented close, part 3, would otherwise re-fill every
   *   seat) or before it has started.
   * - **No connected human remains** → no-op: bot-fill exists to keep the game
   *   alive for the REMAINING humans; if the leaver was the last connected
   *   human, there is no one left to play for — Colyseus auto-disposes the
   *   client-empty room instead of running a pointless bot-vs-bot game (and this
   *   keeps a bot from driving a step into the log during that teardown).
   */
  #botFillSeat(seat: SeatSchema): void {
    const playerId = seat.playerId as PlayerId;
    if (this.#bots.has(playerId)) return;
    if (this.gameState.phase === 'finished' || this.gameState.phase === 'lobby') return;
    const aHumanRemains = this.state.seats.some(
      (s) => s.playerId !== seat.playerId && s.connected && !s.isBot,
    );
    if (!aHumanRemains) return;

    const bot = createHeuristicBot({
      difficulty: this.#botFillDifficulty,
      seed: `bot-fill-${seat.seatIndex}`,
    });
    this.#bots.set(playerId, bot);
    seat.isBot = true;
    seat.botDifficulty = this.#botFillDifficulty;

    // Drive it now if it is (or already owes) the current decision; otherwise
    // the existing per-commit trigger picks the seat up when its turn comes.
    this.#scheduleBotTurnIfNeeded();
  }

  /**
   * Schedules the game-end consented close (S2.3.3). Fires exactly once (the
   * `#gameEndClosing` latch), a short {@link GAME_END_CLOSE_DELAY_MS} after
   * `game.ended`, via the room's ONE wall-clock seam (`#scheduler` — production
   * `this.clock`, a test's manual scheduler): `this.disconnect(CloseCode.CONSENTED)`
   * force-closes every client with code 4000. The client's S2.3.2a logic maps
   * that code to a consented leave and clears its persisted reconnect pointer,
   * so a post-match reload never tries to resume the finished seat. The delay
   * lets the `game.ended` broadcast flush first (Colyseus enqueues messages, so
   * an immediate disconnect would race the final batch). No event, no seed, no
   * `GameState` — a pure transport-layer teardown, so replay stays byte-untouched.
   */
  #scheduleGameEndClose(): void {
    if (this.#gameEndClosing) return;
    this.#gameEndClosing = true;
    this.#scheduler.setTimeout(() => {
      // `disconnect` no-ops if the room is already disposing; the CONSENTED code
      // is what the S2.3.2a client clears its reconnect pointer on.
      void this.disconnect(CloseCode.CONSENTED);
    }, GAME_END_CLOSE_DELAY_MS);
  }

  override onDispose(): void {
    // Cancel any armed turn timer (S2.1.4). `this.clock` is auto-cleared on
    // dispose by Colyseus too, but clearing the tracked handle is explicit and
    // also releases an injected test scheduler's timer.
    this.#hardTimer?.clear();
    this.#hardTimer = undefined;
  }

  /**
   * The authoritative gameplay pipeline (S1.4.2): a client's intent is a WISH.
   * Resolve the actor from the SENDER'S SEAT (never client-supplied identity),
   * `validate` against the authoritative state + secret seed, and only on `ok`
   * fold the produced events through `reduce` — nothing a client sends mutates
   * state directly (ADR-0009 invariant #1).
   */
  async #handleIntent(client: Client, message: unknown): Promise<void> {
    // Wire-shape guard (S1.5.1): zod-parse the inbound envelope at the trust
    // boundary BEFORE core `validate`. A malformed envelope OR payload (bad `v`,
    // unknown `type`, missing/wrong-typed intent fields) is REJECTED privately,
    // never thrown out of the handler. This REPLACES the S1.4.2 ad-hoc structural
    // guard; core `validate` remains the authoritative SEMANTIC validator
    // (turn / affordability / adjacency …) — zod only enforces the wire shape.
    const parsed = ClientMessageSchema.safeParse(message);
    if (!parsed.success) {
      this.#sendReject(client, 'MALFORMED_INTENT');
      return;
    }
    // zod validated the wire shape; the intent's discriminant is one of core's
    // known variants, so the cast to the canonical union is sound (the schema is
    // pinned to `PlayerIntent` at compile time — see @skervik/protocol
    // messages.ts). The cast is needed only because zod infers optional fields
    // as `T | undefined`, which `exactOptionalPropertyTypes` treats as distinct.
    const intent = parsed.data.payload as PlayerIntent;

    // Identity binding: the actor is the sender's SEAT, resolved from the
    // connection's `sessionId` — never `payload.playerId`. An unseated sender
    // has no identity to act under, so it is rejected before `validate`. A
    // sender that NAMES a different player is caught by `validate`
    // (`intent.playerId !== playerId` → MALFORMED_INTENT), since the seat id is
    // what we pass, not the claimed one.
    const seat = this.state.seats.find((s) => s.playerId === client.sessionId);
    if (!seat) {
      this.#sendReject(client, 'UNKNOWN_PLAYER');
      return;
    }
    const playerId = seat.playerId as PlayerId;

    // Hand off to the SHARED authoritative tail (S2.1.4 refactor) — the identical
    // `validate → fold → persist → commit → broadcast → reveal → re-arm` path a
    // forced timeout action also runs. `client` is passed so a rejection/error
    // replies privately to this sender.
    await this.#applyAuthoritativeIntent(playerId, intent, client);
  }

  /**
   * The ONE authoritative state-advancing path (S2.1.4 refactor of the S1.4.4b
   * tail): `validate → fold → persist(await append) → commit → update projection
   * → broadcast → commit-reveal → re-arm turn timer`. Both a real client intent
   * (`#handleIntent`, `client` set) and a forced timeout action
   * (`#forceTimedOutAction`, `client` undefined) call it, so the persist-before-
   * commit ordering + the double-persist race fix live in exactly ONE place and
   * can never drift between the two callers.
   *
   * `client === undefined` means a FORCED (server-injected) action: a validate
   * rejection there is a no-op (the state moved; the forced action is moot — see
   * the generation guard in `#forceTimedOutAction`) rather than a private reply.
   * Never throws: every failure path is caught and, for a real client, answered
   * privately, so nothing escapes as an unhandled rejection / node crash.
   */
  async #applyAuthoritativeIntent(
    playerId: PlayerId,
    intent: PlayerIntent,
    client?: Client,
  ): Promise<void> {
    const forced = client === undefined;

    // `validate` never throws for an EXPECTED rejection, but its exhaustiveness
    // guard DOES throw on a structurally-unknown intent type. Narrow the catch
    // (NIT-2): ONLY that known "unhandled intent type" throw maps to
    // MALFORMED_INTENT. A genuinely unexpected throw is NOT silently relabelled
    // as a malformed intent — it is debug-logged (surfaced) and answered with the
    // same private `intent.error` this pipeline uses for a persist failure, so it
    // is still defensive: nothing escapes this voided handler as an unhandled
    // rejection / node crash, it's just no longer misreported as MALFORMED_INTENT.
    let result: ReturnType<typeof validate>;
    try {
      result = validate(this.gameState, intent, playerId, this.#seed);
    } catch (error) {
      if (isUnknownIntentError(error)) {
        if (client) this.#sendReject(client, 'MALFORMED_INTENT');
        else
          this.#logInternalError('forced action produced an unknown intent type', error);
        return;
      }
      this.#logInternalError('validate threw unexpectedly', error);
      if (client) this.#sendInternalError(client);
      return;
    }

    if (!result.ok) {
      // Private reply to ONLY the sender — a rejection is not a state change,
      // so it is never broadcast, and it never mutates `gameState`. A forced
      // action that no longer validates (state already advanced) is simply a
      // no-op: the current timer keeps counting for the real decision.
      if (client) this.#sendReject(client, result.reason);
      return;
    }

    // --- Persist-before-commit pipeline (S1.4.4b / NIT-1) -------------------
    // The whole state-advancing tail is wrapped so nothing (a rejecting durable
    // sink, an unexpected throw) can either advance state past an unrecorded
    // event OR escape this voided handler as an unhandled rejection / node
    // crash. Ordering invariant: PERSIST first, and only on success COMMIT +
    // broadcast — no client ever observes an event that was not durably logged.
    try {
      // 1. Fold the validated events into a LOCAL next state — do NOT assign
      //    `this.gameState` yet, so a persist failure leaves it untouched.
      const nextState = result.events.reduce(
        (state, event) => reduce(state, event),
        this.gameState,
      );

      // 2. Persist FIRST. If the durable sink rejects, we throw out of this
      //    block below with state still uncommitted and nothing broadcast.
      await this.eventSink.append(result.events);

      // 3. ONLY on a successful persist: commit the authoritative state.
      this.gameState = nextState;

      // 4. Refresh the minimal public projection (Fork 1 / invariant #2): the
      //    schema mirrors only phase + currentPlayerId — never gameplay state.
      this.state.phase = this.gameState.phase;
      this.state.currentPlayerId = this.gameState.currentPlayerId;

      // 5. Broadcast the EXACT validated events to every client (sender
      //    included); each folds them through its own bundled `@skervik/core`
      //    reduce (Fork 1). Events are public — the seed never appears here. A
      //    forced action's events are indistinguishable from a human's here (a
      //    normal `turn.ended`/`dice.rolled`/`resources.discarded`/`robber.moved`
      //    — no timestamp, no timeout marker), which is what keeps the log
      //    byte-replayable.
      const batch: EventBatchMessage = {
        v: 1,
        type: 'event.batch',
        payload: result.events,
      };
      this.broadcast(batch.type, batch);

      // 6. Commit-reveal (S1.4.3 / ADR-0009 Fork 3, invariant #4): the moment —
      //    and ONLY the moment — a validated batch carries `game.ended`, reveal
      //    the secret seed to durable match metadata, so anyone can later
      //    recompute every `dice.rolled` from the event log and check it against
      //    `seedHash`. The reveal goes to the metadata seam, NEVER the event log
      //    (Fork 3), never a broadcast. The `#seedRevealed` latch is set BEFORE
      //    the (possibly async) write so a re-entrant batch cannot double-reveal
      //    — though core freezes to `'finished'` at `game.ended`, so no further
      //    batch is even possible.
      const gameEndedEvent = result.events.find(
        (e): e is GameEndedEvent => e.type === 'game.ended',
      );
      const gameEnded = gameEndedEvent !== undefined;
      if (gameEndedEvent !== undefined && !this.#seedRevealed) {
        this.#seedRevealed = true;
        // Best-effort + ISOLATED (S2.6.3, AC4): a throwing metadata store must
        // never fail this already-committed batch (the log + broadcast are done)
        // — catch + log locally so the pipeline still runs its tail (steps 7-9)
        // and the room never crashes on a secondary durability write.
        try {
          await this.matchMetadataStore.recordSeedReveal(
            this.gameState.matchId,
            this.#seed,
          );
        } catch (error) {
          this.#logInternalError(
            'recordSeedReveal failed (metadata is best-effort)',
            error,
          );
        }
      }
      // Durable match RESULT (S2.6.3): reveal-adjacent, same purity + isolation
      // contract as the seed reveal above — a PURE side-effect (NOT a `GameEvent`,
      // never in the log, no feedback into core). Latched so it fires exactly once
      // at `game.ended`; the winner + per-seat VP come from the AUTHORITATIVE
      // `game.ended` event (`winnerId` + `finalStandings`, core's own tally).
      if (gameEndedEvent !== undefined && !this.#matchResultRecorded) {
        this.#matchResultRecorded = true;
        try {
          await this.matchMetadataStore.recordMatchResult(
            this.gameState.matchId,
            this.#buildMatchResult(gameEndedEvent),
          );
        } catch (error) {
          this.#logInternalError(
            'recordMatchResult failed (metadata is best-effort)',
            error,
          );
        }
      }

      // 7. Anti-AFK bookkeeping (S2.1.4): a real committed intent clears the
      //    acting player's timeout streak; a FORCED one increments it (and may
      //    flag the seat idle). Then re-arm the turn timer from the NEW state.
      this.#recordActivity(playerId, forced);
      this.#armTurnTimer();

      // 8. Trigger point 1/2 (S2.4.3): after ANY commit — human or bot — check
      //    whether a bot seat must now act (this is what lets a bot play its
      //    whole turn one enqueued step at a time, and what hands a human's
      //    commit off to a bot's turn). A no-op for a room with no bots.
      this.#scheduleBotTurnIfNeeded();

      // 9. Game-end consented close (S2.3.3, fixes the S2.3.2a nit): once the
      //    match ends, force-close every client with the CONSENTED code so a
      //    post-match page reload clears its reconnect pointer (S2.3.2a) instead
      //    of wasting a resume attempt on a finished seat. Deferred by one flush
      //    cycle (see `#scheduleGameEndClose`) so this same batch's `game.ended`
      //    broadcast reaches clients BEFORE their sockets close.
      if (gameEnded) this.#scheduleGameEndClose();
    } catch (error) {
      // A durable-sink rejection (or any unexpected throw) fails the batch:
      // state was NOT advanced (assignment happens only after `append` resolved
      // in the happy path; a pre-commit throw leaves `this.gameState` as-is), no
      // broadcast went out. Reply PRIVATELY to the sender and swallow the error
      // here so nothing escapes this voided handler as an unhandled rejection /
      // node crash. Logs carry the public `seedHash` only — never the raw seed.
      this.#logInternalError(
        'failed to persist a validated batch; state left uncommitted',
        error,
      );
      if (client) this.#sendInternalError(client);
    }
  }

  /**
   * (Re-)arms the turn timer from the CURRENT committed state (S2.1.4). Cancels
   * any prior hard timer and bumps the arm generation (so a timeout already fired
   * for the previous decision recognizes itself as stale). For a phase with a
   * hard-enforced decision (`roll`/`main`/`robber`) it arms a `this.clock` timeout
   * sized by `loadRuleProfile(profileId).timers` and projects the presentational
   * deadline onto the schema; for `setup` it surfaces only a soft-warning nudge
   * (auto-placement deferred → no hard forced action); for `lobby`/`finished` it
   * clears the presentational deadline entirely. The wall-clock lives ONLY here —
   * the core + event log never see it.
   */
  #armTurnTimer(): void {
    // Disarm any prior timer and invalidate its (possibly already-fired) callback.
    this.#hardTimer?.clear();
    this.#hardTimer = undefined;
    const generation = ++this.#turnTimerGeneration;

    const timers = loadRuleProfile(this.gameState.profileId ?? 'classic').timers;
    const hardMs = this.#hardDeadlineMsForPhase(timers);

    if (hardMs === null) {
      // No hard-enforced decision. `setup` still surfaces a soft-warning nudge
      // (presentational only — auto-placement is DEFERRED to a later story, so
      // there is no forced action); `lobby`/`finished` clear it outright.
      if (this.gameState.phase === 'setup') {
        this.state.turnDeadline = 0;
        this.state.turnSoftWarnAt = Date.now() + timers.softWarningMs;
      } else {
        this.state.turnDeadline = 0;
        this.state.turnSoftWarnAt = 0;
      }
      return;
    }

    // Project the wall-clock deadline (epoch ms) onto the PUBLIC schema only —
    // never `GameState`/an event/the log. `Date.now()` is the presentational
    // wall-clock the client compares against; the enforcement itself runs on
    // `this.clock` via the scheduler.
    const now = Date.now();
    const deadline = now + hardMs;
    this.state.turnDeadline = deadline;
    this.state.turnSoftWarnAt = Math.max(now, deadline - timers.softWarningMs);

    this.#hardTimer = this.#scheduler.setTimeout(() => {
      this.#onHardTimeout(generation);
    }, hardMs);
  }

  /**
   * The hard-deadline duration for the current decision phase, or `null` when no
   * hard timer applies (`setup` — deferred; `lobby`/`finished` — no turn). A
   * `robber` phase splits on whether post-7 discards are still owed.
   */
  #hardDeadlineMsForPhase(timers: TimerProfile): number | null {
    switch (this.gameState.phase) {
      case 'roll':
        return timers.rollMs;
      case 'main':
        return timers.mainMs;
      case 'robber':
        return (this.gameState.playersToDiscard?.length ?? 0) > 0
          ? timers.discardMs
          : timers.robberMs;
      case 'setup':
      case 'lobby':
      case 'finished':
        return null;
      default:
        return null;
    }
  }

  /**
   * Hard-timeout handler (S2.1.4): the forced action MUST enter the SAME per-room
   * `#queue` as every intent — never a floating callback that mutates state and
   * TOCTOU-races a live intent ([[server-intent-pipeline-serialization]]). We
   * enqueue a link that resolves + applies the forced action at EXECUTION time.
   */
  #onHardTimeout(generation: number): void {
    this.#queue = this.#queue
      .then(() => this.#forceTimedOutAction(generation))
      .catch((error: unknown) => {
        this.#logInternalError('forced-action queue link threw unexpectedly', error);
      });
  }

  /**
   * Resolves + applies the forced default action for the state as it stands AT
   * EXECUTION TIME (S2.1.4). Runs inside the `#queue`, so it is serialized with
   * every real intent. Two guards make it race-safe and correct:
   *
   * - **Stale generation** → no-op: any committed action since this timer was
   *   armed bumped the generation (and re-armed a fresh timer), so this fired
   *   timeout is moot — the real action already advanced the turn. This is how
   *   "a real action taken just before cancels the forced one" holds even when
   *   the old timer had already fired and queued.
   * - **`resolveForcedAction` → `null`** → no-op (nothing to force: setup, or a
   *   phase with no decision).
   *
   * The multi-ower discard step is the ONE case a single hard timeout
   * force-completes several players at once: after the first ower's forced
   * discard commits, it keeps forcing each remaining owing discarder in turn
   * (each through the shared authoritative tail), until the robber may move.
   */
  async #forceTimedOutAction(generation: number): Promise<void> {
    if (generation !== this.#turnTimerGeneration) return;

    let forced = resolveForcedAction(this.gameState);
    if (!forced) return;

    const wasDiscardStep =
      this.gameState.phase === 'robber' &&
      (this.gameState.playersToDiscard?.length ?? 0) > 0;

    await this.#applyAuthoritativeIntent(forced.playerId, forced.intent);

    if (wasDiscardStep) {
      // Force every remaining owing discarder in this same timeout, in turn —
      // they collectively ran out of time on the shared discard deadline.
      while (
        this.gameState.phase === 'robber' &&
        (this.gameState.playersToDiscard?.length ?? 0) > 0
      ) {
        forced = resolveForcedAction(this.gameState);
        if (!forced) break;
        await this.#applyAuthoritativeIntent(forced.playerId, forced.intent);
      }
    }
  }

  /**
   * The bot seat that must act RIGHT NOW given `state`, or `undefined` if none
   * does (a human seat's turn, a phase with no bot decision pending, or a room
   * with no bots at all). Pure & re-derived fresh at every call — never cached
   * across a `#queue` hop — mirroring `resolveForcedAction`'s own discipline,
   * so it always reflects state exactly as it stands at execution time:
   *
   * - `'robber'` + pending discards → the FIRST bot among `playersToDiscard`
   *   (a human owing discarder is left for their own client/timer).
   * - `'robber'` with discards cleared, `'setup'`, `'roll'`, `'main'` → the
   *   current player's seat, if it is a bot.
   * - `'lobby'` / `'finished'` → never (no decision pending).
   */
  #nextBotActorId(state: GameState): PlayerId | undefined {
    if (this.#bots.size === 0) return undefined;
    if (state.phase === 'robber') {
      const owing = state.playersToDiscard ?? [];
      if (owing.length > 0) return owing.find((id) => this.#bots.has(id));
      return this.#bots.has(state.currentPlayerId) ? state.currentPlayerId : undefined;
    }
    if (state.phase === 'setup' || state.phase === 'roll' || state.phase === 'main') {
      return this.#bots.has(state.currentPlayerId) ? state.currentPlayerId : undefined;
    }
    return undefined;
  }

  /**
   * The drive-loop TRIGGER (S2.4.3): a cheap synchronous check — never itself
   * awaits a bot decision — that enqueues one bot step onto the EXISTING
   * `#queue` when (and only when) a bot seat must act. Called from the tail of
   * `#applyAuthoritativeIntent` (after every commit) and once after
   * `#startMatch`; a no-op for a room with no bots or when it is a human
   * seat's turn. Re-entrancy runs through the queue, not the stack: each bot
   * step is its own fresh `#queue` link, and applying it re-triggers this
   * check for the NEXT step — this is what plays a bot's whole turn (roll →
   * build → … → endTurn) one enqueued step at a time and naturally terminates
   * once no bot seat needs to act.
   */
  #scheduleBotTurnIfNeeded(): void {
    if (this.#nextBotActorId(this.gameState) === undefined) return;
    this.#queue = this.#queue
      .then(() => this.#driveBotTurn())
      .catch((error: unknown) => {
        this.#logInternalError('bot-drive queue link threw unexpectedly', error);
      });
  }

  /**
   * Bumps the per-turn bot-action counter (S2.4.3 no-hang discipline),
   * resetting it to 1 whenever `state.turn` has advanced since the last bump
   * (a fresh turn gets a fresh budget). Pure bookkeeping — no clock, no seed.
   */
  #bumpBotActionCounter(turn: number): void {
    if (turn !== this.#botActionsTrackedTurn) {
      this.#botActionsTrackedTurn = turn;
      this.#botActionsThisTurn = 0;
    }
    this.#botActionsThisTurn += 1;
  }

  /**
   * Drives exactly ONE bot step through the SAME authoritative tail a human
   * intent uses (S2.4.3) — `#applyAuthoritativeIntent(playerId, intent)` with
   * `client === undefined`, the identical forced-injection signal S2.1.4
   * uses. Runs inside the `#queue`, so it is serialized with every real intent
   * and every forced timeout action.
   *
   * Re-resolves the acting seat AT EXECUTION TIME (never trusts a stale
   * `playerId` captured when this step was scheduled — state may have moved
   * on if another queue link landed first) and never spins:
   *
   * 1. Within the per-turn action cap, ask the bot for its own decision.
   * 2. If that decision is missing/illegal (`validate` rejects it), OR the cap
   *    was exceeded, fall back to `resolveForcedAction` — but ONLY if it
   *    targets this SAME seat and is itself legal (never act on behalf of a
   *    different, e.g. human, owing player just because this bot got capped).
   * 3. If neither is available, the seat is truly stuck: fail LOUD (a
   *    descriptive thrown error, caught + logged by `#scheduleBotTurnIfNeeded`'s
   *    `.catch`, same discipline as every other queue-link failure) rather
   *    than spin forever. Every OTHER seat's pipeline is unaffected.
   */
  async #driveBotTurn(): Promise<void> {
    const state = this.gameState;
    const playerId = this.#nextBotActorId(state);
    if (playerId === undefined) return; // state moved on since this step was scheduled

    this.#bumpBotActionCounter(state.turn);
    const withinCap = this.#botActionsThisTurn <= this.#botActionCap;
    const bot = this.#bots.get(playerId);
    const proposed = withinCap ? (bot?.decide(state, playerId) ?? null) : null;
    const proposedOk =
      proposed !== null && validate(state, proposed, playerId, this.#seed).ok;

    let intent: PlayerIntent | null = null;
    if (proposedOk) {
      intent = proposed;
    } else {
      const forced = resolveForcedAction(state);
      if (
        forced &&
        forced.playerId === playerId &&
        validate(state, forced.intent, playerId, this.#seed).ok
      ) {
        intent = forced.intent;
      }
    }

    if (intent === null) {
      throw new Error(
        `bot seat ${playerId} is STUCK at phase=${state.phase} turn=${state.turn}: ` +
          'neither its own decision nor the deterministic forced default validated ' +
          '— failing loud rather than spinning (S2.4.3 no-hang discipline).',
      );
    }

    await this.#applyAuthoritativeIntent(playerId, intent);
  }

  /**
   * Anti-AFK bookkeeping (S2.1.4): update a player's consecutive-timeout streak
   * and the seat's `idle` flag after a committed action. A FORCED action
   * increments the streak; a REAL one resets it to 0. Purely session/liveness
   * metadata in room memory + the seat projection — never `GameState`/the log
   * (the deterministic core stays independent of liveness). No bot replacement,
   * no removal (no karmic ban) — the seat is only flagged.
   */
  #recordActivity(playerId: PlayerId, forced: boolean): void {
    const previous = this.#consecutiveTimeouts.get(playerId) ?? 0;
    const next = forced ? previous + 1 : 0;
    if (next === 0) this.#consecutiveTimeouts.delete(playerId);
    else this.#consecutiveTimeouts.set(playerId, next);

    const seat = this.state.seats.find((s) => s.playerId === playerId);
    if (seat) {
      const threshold = loadRuleProfile(this.gameState.profileId ?? 'classic').timers
        .afkThreshold;
      seat.consecutiveMisses = next;
      seat.idle = next >= threshold;
    }
  }

  #sendReject(client: Client, reason: RejectMessage['payload']['reason']): void {
    const message: RejectMessage = { v: 1, type: 'intent.rejected', payload: { reason } };
    client.send(message.type, message);
  }

  /**
   * Private, sender-only signal that a validated batch could NOT be durably
   * recorded (sink rejection or an unexpected internal throw). Distinct from
   * `intent.rejected` (a `validate` RejectReason): this is an infrastructure
   * failure, and the authoritative state was NOT advanced. Server-local (not a
   * core RejectReason) — the typed protocol/zod envelope lands in S1.5.1. Never
   * carries a seed or any state.
   */
  #sendInternalError(client: Client): void {
    const message: IntentErrorMessage = {
      v: 1,
      type: 'intent.error',
      payload: { code: 'INTERNAL_ERROR' },
    };
    client.send(message.type, message);
  }

  /**
   * Logs an internal-error path (a sink rejection, or a `validate` throw that
   * wasn't the known unknown-intent-type case) with the PUBLIC seedHash only —
   * the raw seed never leaks into logs.
   */
  #logInternalError(context: string, error: unknown): void {
    console.error(
      `[GameRoom ${this.roomId}] ${context} (seedHash=${this.gameState.seedHash}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * A private, sender-only error envelope (S1.4.4b): the room failed to durably
 * record a validated batch. NOT a core {@link RejectMessage}/RejectReason (that
 * channel is for `validate` rejections) — this is an infrastructure failure with
 * state untouched. Lives server-side; the shared typed/zod envelope is S1.5.1.
 */
interface IntentErrorMessage {
  readonly v: 1;
  readonly type: 'intent.error';
  readonly payload: { readonly code: 'INTERNAL_ERROR' };
}

/**
 * True only for the exhaustiveness-guard throw `validate` raises on a
 * structurally-unknown intent type (`"unhandled intent type: …"` /
 * `"unhandled playDevCard card kind: …"`, core `validate.ts`). Any OTHER throw
 * is unexpected (a real bug) and must surface, not be relabelled MALFORMED_INTENT.
 */
function isUnknownIntentError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith('unhandled intent type:') ||
      error.message.startsWith('unhandled playDevCard card kind:'))
  );
}
