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
  type GameState,
  type PlayerId,
  reduce,
  type Seed,
  validate,
} from '@skervik/core';
import type {
  EventBatchMessage,
  RejectMessage,
  StateSnapshotMessage,
} from '@skervik/protocol';
import { type Client, Room } from 'colyseus';

import { InMemoryMatchMetadataStore, type MatchMetadataStore } from '../matchMetadata.js';
import { createRoomSchema, RoomSchema, SeatSchema } from '../schema/RoomSchema.js';
import { generateSeed, sha256Hex } from '../seed.js';
import { FsEventSink, type GameEventSink, InMemoryEventSink } from './eventSink.js';

/** Classic seat cap for M1 (3-4 players) — a room option, not a hardcoded rule. */
const DEFAULT_MAX_SEATS = 4;

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
    this.matchMetadataStore = options?.metadataStore ?? new InMemoryMatchMetadataStore();

    this.#seed = generateSeed();
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

    // The authoritative intent pipeline (S1.4.2). The handler never throws out
    // (it returns rejections), so the floating promise is deliberately voided.
    this.onMessage('intent', (client, message: unknown) => {
      void this.#handleIntent(client, message);
    });
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
    // Structural guard (S1.5.1 adds zod). A malformed envelope is REJECTED,
    // never thrown out of the handler.
    if (!isIntentEnvelope(message)) {
      this.#sendReject(client, 'MALFORMED_INTENT');
      return;
    }

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
      result = validate(this.gameState, message.payload, playerId, this.#seed);
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

/**
 * Minimal structural guard on an inbound `intent` envelope (no zod until
 * S1.5.1): a non-null object with `type === 'intent'` and a `payload` object
 * carrying a string `type`. Deep intent legality is `validate`'s job — this
 * only screens out garbage the pipeline shouldn't hand to it.
 */
function isIntentEnvelope(
  message: unknown,
): message is { readonly type: 'intent'; readonly payload: PlayerIntentLike } {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const envelope = message as Record<string, unknown>;
  if (envelope['type'] !== 'intent') {
    return false;
  }
  const payload = envelope['payload'];
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  return typeof (payload as Record<string, unknown>)['type'] === 'string';
}

/** The shape the structural guard proves — narrowed to what `validate` needs. */
type PlayerIntentLike = Parameters<typeof validate>[1];
