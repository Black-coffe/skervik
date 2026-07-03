// @skervik/server — the authoritative game room (S1.4.1 shell + S1.4.2
// intent pipeline + S1.4.3 commit-reveal, ADR-0009). Holds the complete plain
// `@skervik/core` `GameState` + a private crypto seed in room memory; the
// `@colyseus/schema` mirrors ONLY the public lobby/late-join projection
// (Fork 1). Gameplay flows as `event.batch` broadcasts of server-validated
// events — never through the Schema. The secret seed is revealed to match
// metadata ONLY after `game.ended` (S1.4.3); no ndjson persistence (S1.4.4).
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
import { type GameEventSink, InMemoryEventSink } from './eventSink.js';

/** Classic seat cap for M1 (3-4 players) — a room option, not a hardcoded rule. */
const DEFAULT_MAX_SEATS = 4;

export interface GameRoomOptions {
  readonly maxSeats?: number;
  /**
   * Where validated events are appended before broadcast (S1.4.2 seam).
   * Defaults to an in-memory buffer; S1.4.4 injects the durable ndjson writer
   * here without touching pipeline logic.
   */
  readonly sink?: GameEventSink;
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
   * The log-append seam (S1.4.2): every validated batch is handed here BEFORE
   * broadcast. Public so a test can read what the pipeline appended; S1.4.4
   * swaps the default in-memory buffer for the durable ndjson writer via the
   * `sink` room option.
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
    this.eventSink = options?.sink ?? new InMemoryEventSink();
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
    // guard DOES throw on a structurally-unknown intent type. Wrap so no input
    // can throw out of the handler; state is assigned only AFTER a successful
    // reduce, so a throw here leaves the authoritative state untouched.
    let result: ReturnType<typeof validate>;
    try {
      result = validate(this.gameState, message.payload, playerId, this.#seed);
    } catch {
      this.#sendReject(client, 'MALFORMED_INTENT');
      return;
    }

    if (!result.ok) {
      // Private reply to ONLY the sender — a rejection is not a state change,
      // so it is never broadcast, and it never mutates `gameState`.
      this.#sendReject(client, result.reason);
      return;
    }

    // Authoritative fold: only server-validated events change state.
    this.gameState = result.events.reduce(
      (state, event) => reduce(state, event),
      this.gameState,
    );

    // Order: reduce → persist-seam → broadcast. Persist BEFORE broadcast so a
    // future durable sink (S1.4.4) can never emit to clients an event it failed
    // to record — no client observes an event that isn't in the log. With the
    // default in-memory sink `append` is synchronous, so there is no reordering
    // gap today.
    await this.eventSink.append(result.events);

    // Commit-reveal (S1.4.3 / ADR-0009 Fork 3, invariant #4): the moment — and
    // ONLY the moment — a validated batch carries `game.ended`, reveal the
    // secret seed to durable match metadata, so anyone can later recompute
    // every `dice.rolled` from the event log and check it against `seedHash`.
    // The reveal goes to the metadata seam, NEVER the event log (Fork 3), never
    // a broadcast. The `#seedRevealed` latch is set BEFORE the (possibly async)
    // write so a re-entrant batch cannot double-reveal — though core freezes to
    // `'finished'` at `game.ended`, so no further batch is even possible.
    if (!this.#seedRevealed && result.events.some((e) => e.type === 'game.ended')) {
      this.#seedRevealed = true;
      await this.matchMetadataStore.recordSeedReveal(this.gameState.matchId, this.#seed);
    }

    // Refresh the minimal public projection (Fork 1 / invariant #2): the schema
    // mirrors only phase + currentPlayerId (whose-turn is read from
    // currentPlayerId against the seat list) — never any gameplay state.
    this.state.phase = this.gameState.phase;
    this.state.currentPlayerId = this.gameState.currentPlayerId;

    // Broadcast the EXACT validated events to every client (sender included);
    // each folds them through its own bundled `@skervik/core` reduce (Fork 1).
    // Events are public — the seed never appears here (`validate` never returns
    // it).
    const batch: EventBatchMessage = {
      v: 1,
      type: 'event.batch',
      payload: result.events,
    };
    this.broadcast(batch.type, batch);
  }

  #sendReject(client: Client, reason: RejectMessage['payload']['reason']): void {
    const message: RejectMessage = { v: 1, type: 'intent.rejected', payload: { reason } };
    client.send(message.type, message);
  }
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
