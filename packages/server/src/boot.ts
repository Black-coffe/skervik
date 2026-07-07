// @skervik/server — the REAL HTTP+WS boot (S1.7.1, ADR-0011). The first time
// the server actually `listen()`s: one Fastify HTTP server on one port serves
// the REST surface (`GET /health`, `POST /auth/guest`) AND the Colyseus
// matchmaking + WebSocket traffic, so 3-4 real `@colyseus/sdk` clients connect
// over a socket and land in one `GameRoom`.
//
// ── Why this boot shape (ADR-0011, from the S1.7.1 spike) ───────────────────
// The obvious shape — `new Server({ transport: new WebSocketTransport({ server:
// fastify.server }) })` + `gameServer.serverless()`/`listen()` — DOUBLE-BINDS
// HTTP: colyseus core's `bindRouterToTransport` does
// `server.prependListener('request', …)`, so both Fastify and the colyseus
// router answer every request (incl. `/health`) → `ERR_HTTP_HEADERS_SENT`.
// Instead: Fastify OWNS the HTTP server; we bind Colyseus WS via
// `transport.attachToServer(fastify.server)` (WS upgrades ONLY, no `request`
// listener) and MOUNT the matchmaking HTTP handler into Fastify ourselves — the
// SDK POSTs `/matchmake/<method>/<roomName>`, and `matchMaker.controller.
// invokeMethod` (colyseus's documented framework-interop API) returns the flat
// seat reservation the 0.17 client consumes. We never call `bindRoutes()`.
//
// `GameRoom` authoritative logic is untouched — this is bootstrap wiring only.
import { WebSocketTransport } from '@colyseus/ws-transport';
import cors, { type FastifyCorsOptions } from '@fastify/cors';
import type { Seed } from '@skervik/core';
import { GAME_ROOM_NAME } from '@skervik/protocol';
import { matchMaker, Server } from 'colyseus';
import Fastify, { type FastifyInstance } from 'fastify';

import { type GuestStore, InMemoryGuestStore } from './auth/guestStore.js';
import { GameRoom, type GameRoomOptions } from './room/GameRoom.js';
import { registerGuestAuthRoute } from './routes/guestAuth.js';
import { registerHealthRoute } from './routes/health.js';

/** Default port — matches the S1.6.5 client's `ws://localhost:2567` default. */
export const DEFAULT_PORT = 2567;
/** Default bind host — all interfaces (dev + container). */
export const DEFAULT_HOST = '0.0.0.0';

export interface CreateHttpServerOptions {
  /** Durable ndjson match-log dir (S1.4.4b) passed through to every room. */
  readonly matchesDir?: string;
  /** Seat cap per room (default 4, Classic M1). */
  readonly maxSeats?: number;
  /**
   * A fixed secret PRNG seed for every room (S1.7.2 E2E seam) — reproducible
   * board + rolls so a scripted match runs identically twice. Production omits
   * it (each room mints a fresh CSPRNG seed). Stays a server secret; never
   * serialized or broadcast.
   */
  readonly seed?: Seed;
  /** Inject a guest store (tests); defaults to the in-memory M1 impl. */
  readonly guestStore?: GuestStore;
  /**
   * CORS origin for the REST surface (Fastify CORS). Dev-permissive default
   * (`true` = reflect the request origin); tighten to the real client origin(s)
   * in production. Documented as a deliberate M1 dev default.
   */
  readonly corsOrigin?: FastifyCorsOptions['origin'];
}

/** A live boot handle: the composed server plus lifecycle controls. */
export interface HttpServerHandle {
  readonly fastify: FastifyInstance;
  readonly gameServer: Server;
  readonly guestStore: GuestStore;
  /** Bind the port and start serving HTTP + WS; resolves with the bound address. */
  listen(port?: number, host?: string): Promise<{ port: number; host: string }>;
  /** Gracefully stop the game server and close the HTTP/WS server. */
  close(): Promise<void>;
}

/**
 * Compose Fastify + the Colyseus game server on one port (see the file header
 * for the ADR-0011 boot shape). Does NOT listen — call the returned
 * {@link HttpServerHandle.listen}. Backward-compatible with the boot-free
 * `createGameServer()` factory the existing unit tests use (that path is
 * unchanged; this is the additive real-boot composition).
 */
export async function createHttpServer(
  options: CreateHttpServerOptions = {},
): Promise<HttpServerHandle> {
  const guestStore = options.guestStore ?? new InMemoryGuestStore();

  // Fastify owns the single HTTP server (REST + the mounted matchmaking route).
  const fastify = Fastify({ logger: false });
  await fastify.register(cors, { origin: options.corsOrigin ?? true });
  registerHealthRoute(fastify);
  registerGuestAuthRoute(fastify, guestStore);

  // Colyseus WS transport with NO http server of its own (`noServer`) — it is
  // attached to Fastify's server below, so the two never fight over the port.
  const transport = new WebSocketTransport({ noServer: true });
  const gameServer = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
  });
  const roomOptions: GameRoomOptions = {
    ...(options.matchesDir !== undefined ? { matchesDir: options.matchesDir } : {}),
    ...(options.maxSeats !== undefined ? { maxSeats: options.maxSeats } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  };
  gameServer.define(
    GAME_ROOM_NAME,
    GameRoom,
    Object.keys(roomOptions).length > 0 ? roomOptions : undefined,
  );

  // Mount matchmaking into Fastify (ADR-0011): the SDK POSTs
  // `/matchmake/<method>/<roomName>` with the join options as the body;
  // `invokeMethod` reserves a seat and returns the flat `{ name, sessionId,
  // roomId, processId }` the 0.17 client consumes, then WS-connects to
  // `/<processId>/<roomId>` (handled by `attachToServer` below). On a
  // matchmaking error we mirror the colyseus HTTP shape so the SDK surfaces a
  // `ServerError` (it throws on any `>= 400` with `{ error }`/`{ message }`).
  fastify.post('/matchmake/:method/:roomName', async (request, reply) => {
    const { method, roomName } = request.params as { method: string; roomName: string };
    try {
      return await matchMaker.controller.invokeMethod(
        method,
        roomName,
        (request.body as Record<string, unknown> | undefined) ?? {},
      );
    } catch (error) {
      const code = (error as { code?: number }).code;
      const status = typeof code === 'number' && code >= 400 && code <= 599 ? code : 500;
      reply.code(status);
      return { error: error instanceof Error ? error.message : 'MATCHMAKE_FAILED', code };
    }
  });

  // Bring the matchmaker up WITHOUT `bindRoutes()` (which would double-bind the
  // HTTP `request` listener — see the file header). `accept()` awaits the
  // constructor's `matchMaker.setup()` internally, so calling it here is safe.
  await matchMaker.accept();

  // Bind Colyseus WS upgrades onto Fastify's underlying `http.Server`. This adds
  // an `upgrade` listener only (no `request` listener), so Fastify keeps sole
  // ownership of HTTP. Must run before `listen()`.
  transport.attachToServer(fastify.server);

  return {
    fastify,
    gameServer,
    guestStore,
    async listen(port = DEFAULT_PORT, host = DEFAULT_HOST) {
      await fastify.listen({ port, host });
      const address = fastify.server.address();
      const boundPort =
        typeof address === 'object' && address !== null ? address.port : port;
      return { port: boundPort, host };
    },
    async close() {
      // Stop accepting/close rooms first, then the HTTP/WS server. `attachToServer`
      // leaves the http.Server to Fastify, so `fastify.close()` owns it.
      await gameServer.gracefullyShutdown(false).catch(() => undefined);
      await fastify.close();
    },
  };
}

/**
 * Real entry point (the `start` npm script): read `PORT`/`HOST`/`MATCHES_DIR`
 * from the environment, boot, and listen for real. Logs the bound address.
 */
export async function startServer(): Promise<HttpServerHandle> {
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['HOST'] ?? DEFAULT_HOST;
  const matchesDir = process.env['MATCHES_DIR'];
  const handle = await createHttpServer(matchesDir !== undefined ? { matchesDir } : {});
  const bound = await handle.listen(port, host);
  console.log(
    `[skervik/server] listening on http://${bound.host}:${bound.port} (HTTP + WS)`,
  );
  return handle;
}
