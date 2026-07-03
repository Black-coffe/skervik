// @skervik/server — Colyseus stateful rooms + Fastify REST.
// Colyseus room shell lands in S1.4.1; Fastify REST is deferred (ADR-0009 Fork 4).
import { Server } from 'colyseus';

import { GameRoom } from './room/GameRoom.js';

export const SERVER_VERSION = '0.0.1' as const;

export {
  type GameEventSink,
  InMemoryEventSink,
  NoopEventSink,
} from './room/eventSink.js';
export { GameRoom, type GameRoomOptions } from './room/GameRoom.js';

/** Matchmaking name the S1.4.1 `GameRoom` is registered under. */
export const GAME_ROOM_NAME = 'skervik_game';

/**
 * Builds a fresh Colyseus `Server` with the `GameRoom` registered for
 * matchmaking — no `listen()` call: the caller binds a port/transport (the
 * real entry point, or a test harness).
 */
export function createGameServer(): Server {
  const gameServer = new Server();
  gameServer.define(GAME_ROOM_NAME, GameRoom);
  return gameServer;
}
