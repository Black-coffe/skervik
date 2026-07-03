// @skervik/server — the authoritative game room shell (S1.4.1, ADR-0009).
// Holds the complete plain `@skervik/core` `GameState` + a private crypto
// seed in room memory; the `@colyseus/schema` mirrors ONLY the public
// lobby/late-join projection (Fork 1). No gameplay flows through the Schema
// yet — that's `event.batch` broadcasts, S1.4.2. No seed reveal (S1.4.3), no
// event-log persistence (S1.4.4).
import { createHash, randomBytes } from 'node:crypto';

import type { GameState, PlayerId, Seed } from '@skervik/core';
import type { StateSnapshotMessage } from '@skervik/protocol';
import { type Client, Room } from 'colyseus';

import { createRoomSchema, RoomSchema, SeatSchema } from '../schema/RoomSchema.js';

/** Classic seat cap for M1 (3-4 players) — a room option, not a hardcoded rule. */
const DEFAULT_MAX_SEATS = 4;

export interface GameRoomOptions {
  readonly maxSeats?: number;
}

export class GameRoom extends Room<{ state: RoomSchema }> {
  /** The authoritative plain GameState — never serialized via the Schema (ADR-0009 Fork 1). */
  gameState!: GameState;

  /**
   * The match's secret PRNG seed (commit-reveal, ADR-0009 Fork 3) — true JS
   * private field, so it is unreachable outside this class (never
   * `GameState`, never the Schema, never broadcast, never logged). Revealed
   * only at `game.ended`, only into match metadata — that's S1.4.3.
   */
  #seed!: Seed;

  override onCreate(options?: GameRoomOptions): void {
    this.maxClients = options?.maxSeats ?? DEFAULT_MAX_SEATS;

    this.#seed = randomBytes(32).toString('hex');
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
}

function sha256Hex(seed: Seed): string {
  return createHash('sha256').update(seed).digest('hex');
}
