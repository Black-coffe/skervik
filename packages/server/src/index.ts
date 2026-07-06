// @skervik/server — Colyseus stateful rooms + Fastify REST.
// Colyseus room shell lands in S1.4.1; Fastify REST is deferred (ADR-0009 Fork 4).
import { GAME_ROOM_NAME } from '@skervik/protocol';
import { Server } from 'colyseus';

import { GameRoom } from './room/GameRoom.js';

export const SERVER_VERSION = '0.0.1' as const;

export {
  type GuestIdentity,
  type GuestStore,
  InMemoryGuestStore,
} from './auth/guestStore.js';
export {
  createHttpServer,
  type CreateHttpServerOptions,
  DEFAULT_HOST,
  DEFAULT_PORT,
  type HttpServerHandle,
  startServer,
} from './boot.js';
export {
  InMemoryMatchMetadataStore,
  type MatchMetadataStore,
  NoopMatchMetadataStore,
} from './matchMetadata.js';
export {
  DEFAULT_MATCHES_DIR,
  FsEventSink,
  type FsEventSinkOptions,
  type GameEventSink,
  InMemoryEventSink,
  NoopEventSink,
} from './room/eventSink.js';
export { GameRoom, type GameRoomOptions } from './room/GameRoom.js';
export { generateSeed, sha256Hex } from './seed.js';

/**
 * Matchmaking name the `GameRoom` is registered under. Single source of truth is
 * `@skervik/protocol` (S1.6.5, part of the wire contract) — re-exported here so
 * existing `@skervik/server` consumers of `GAME_ROOM_NAME` are unaffected.
 */
export { GAME_ROOM_NAME } from '@skervik/protocol';

export interface CreateGameServerOptions {
  /**
   * Base directory for durable match logs (S1.4.4b). When set, every room
   * defined here defaults to the durable {@link FsEventSink}, writing
   * `{matchesDir}/{matchId}/events.ndjson`. Omit it (the test/dev default) to
   * keep rooms on the in-memory sink and off the filesystem.
   */
  readonly matchesDir?: string;
}

/**
 * Builds a fresh Colyseus `Server` with the `GameRoom` registered for
 * matchmaking — no `listen()` call: the caller binds a port/transport (the
 * real entry point, or a test harness). Passing `matchesDir` wires durable
 * ndjson persistence (S1.4.4b) as the default sink for every room; the boot
 * entry point supplies it, tests boot without it (in-memory).
 */
export function createGameServer(options?: CreateGameServerOptions): Server {
  const gameServer = new Server();
  gameServer.define(
    GAME_ROOM_NAME,
    GameRoom,
    options?.matchesDir !== undefined ? { matchesDir: options.matchesDir } : undefined,
  );
  return gameServer;
}
