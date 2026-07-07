// @skervik/server — the authoritative game room (S1.4.1 shell + S1.4.2
// intent pipeline + S1.4.3 commit-reveal + S1.4.4b durable persist, ADR-0009).
// Holds the complete plain `@skervik/core` `GameState` + a private crypto seed
// in room memory; the `@colyseus/schema` mirrors ONLY the public lobby/late-join
// projection (Fork 1). Gameplay flows as `event.batch` broadcasts of
// server-validated events — never through the Schema. Each validated batch is
// PERSISTED to the event log BEFORE it is committed/broadcast (S1.4.4b): no
// client ever observes an event that was not durably recorded first. The secret
// seed is revealed to match metadata ONLY after `game.ended` (S1.4.3).
import {
  type BoardGeneratedEvent,
  buildTopology,
  type GameEvent,
  type GameState,
  generateBoard,
  type MatchStartedEvent,
  type PlayerId,
  type PlayerIntent,
  reduce,
  type Seed,
  validate,
} from '@skervik/core';
import {
  ClientMessageSchema,
  ConnectOptionsSchema,
  type EventBatchMessage,
  isCompatibleProtocolVersion,
  PROTOCOL_VERSION,
  type RejectMessage,
  type StateSnapshotMessage,
  type VersionErrorMessage,
} from '@skervik/protocol';
import { type Client, Room, ServerError } from 'colyseus';

import {
  FsMatchMetadataStore,
  InMemoryMatchMetadataStore,
  type MatchMetadataStore,
} from '../matchMetadata.js';
import { createRoomSchema, RoomSchema, SeatSchema } from '../schema/RoomSchema.js';
import { generateSeed, sha256Hex } from '../seed.js';
import { FsEventSink, type GameEventSink, InMemoryEventSink } from './eventSink.js';

/** Classic seat cap for M1 (3-4 players) — a room option, not a hardcoded rule. */
const DEFAULT_MAX_SEATS = 4;

/**
 * The transport-level `ServerError.code` for a protocol-version rejection
 * (S1.5.2). A value in the WebSocket application-reserved close-code range
 * (4000-4999) so it never collides with Colyseus's own codes; the
 * machine-readable reason lives in the `error.version` payload (the error's
 * message body), not in this numeric code.
 */
const PROTOCOL_VERSION_MISMATCH_CODE = 4001;

export interface GameRoomOptions {
  readonly maxSeats?: number;
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
   * The one-way reveal latch (S1.4.3 / ADR-0009 invariant #4). Flips exactly
   * once, when the first batch carrying `game.ended` is applied; guards against
   * a double-reveal. Set BEFORE the (possibly async) metadata write so no
   * re-entrant batch can slip a second reveal through.
   */
  #seedRevealed = false;

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

  override onCreate(options?: GameRoomOptions): void {
    this.maxClients = options?.maxSeats ?? DEFAULT_MAX_SEATS;
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

    // The authoritative intent pipeline (S1.4.2), SERIALIZED per room (see
    // `#queue` doc): each intent is chained onto the room's queue rather than
    // dispatched as an independent floating promise, so a durable async sink
    // can never open a window where a second intent validates against a
    // not-yet-committed state.
    this.onMessage('intent', (client, message: unknown) => {
      this.#enqueueIntent(client, message);
    });
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
    };
    const afterStart = reduce(this.gameState, matchStarted);

    // The layout is generated from the SECRET seed (never serialized) — the
    // full board travels as event data so replay never re-runs the generator
    // (ADR-0003). `board.generated`'s index continues from the post-start
    // `eventIndex`, so both events form one contiguous batch.
    const layout = generateBoard(this.#seed, buildTopology());
    const boardGenerated: BoardGeneratedEvent = {
      type: 'board.generated',
      index: afterStart.eventIndex,
      tileKinds: layout.tileKinds,
      tileTokens: layout.tileTokens,
      portContents: layout.portContents,
      robberTileId: layout.robberTileId,
    };

    const events: GameEvent[] = [matchStarted, boardGenerated];
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
   */
  override onAuth(_client: Client, options: unknown): boolean {
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
    return true;
  }

  override onJoin(client: Client): void {
    const seat = new SeatSchema().assign({
      playerId: client.sessionId as PlayerId,
      seatIndex: this.state.seats.length,
      connected: true,
    });
    this.state.seats.push(seat);

    const snapshot: StateSnapshotMessage = {
      v: 1,
      type: 'state.snapshot',
      payload: this.gameState,
    };
    client.send(snapshot.type, snapshot);

    // Match-start orchestration (S1.7.2): when the last seat needed to reach
    // the start condition (the room's full seat cap) is taken, auto-start the
    // match — no lobby-ready UI / host button for M1 (later). The latch is set
    // synchronously here BEFORE the async enqueue so it fires exactly once, and
    // the start batch rides the SAME per-room `#queue` as every intent (so it
    // can never interleave with an in-flight intent's persist window).
    if (!this.#matchStarted && this.state.seats.length >= this.maxClients) {
      this.#matchStarted = true;
      this.#queue = this.#queue
        .then(() => this.#startMatch())
        .catch((error: unknown) => {
          this.#logInternalError('match-start queue link threw unexpectedly', error);
        });
    }
  }

  override onLeave(client: Client): void {
    // M1: no grace timer, no bot-fill, no removal — M2 owns reconnect. The
    // authoritative GameState is untouched; only the public projection notes
    // the disconnect.
    const seat = this.state.seats.find((s) => s.playerId === client.sessionId);
    if (seat) {
      seat.connected = false;
    }
  }

  override onDispose(): void {
    // Nothing to release yet — no persistence, no timers (M1 shell only).
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
        this.#sendReject(client, 'MALFORMED_INTENT');
        return;
      }
      this.#logInternalError('validate threw unexpectedly', error);
      this.#sendInternalError(client);
      return;
    }

    if (!result.ok) {
      // Private reply to ONLY the sender — a rejection is not a state change,
      // so it is never broadcast, and it never mutates `gameState`.
      this.#sendReject(client, result.reason);
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
      //    reduce (Fork 1). Events are public — the seed never appears here.
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
      if (!this.#seedRevealed && result.events.some((e) => e.type === 'game.ended')) {
        this.#seedRevealed = true;
        await this.matchMetadataStore.recordSeedReveal(
          this.gameState.matchId,
          this.#seed,
        );
      }
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
      this.#sendInternalError(client);
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
