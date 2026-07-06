# ADR-0011: Colyseus version alignment — client on `@colyseus/sdk@0.17`, server stays `colyseus@0.17`

- Status: **accepted** — Queen decision 2026-07-06 (engineering stack choice, not a CLAUDE.md locked input; server 0.17 stack was already owner-accepted at S1.4.1)
- Date: 2026-07-06
- Spec: docs/specs/m1-vertical-slice (E1.7 — unblocks S1.7.1 real server boot + the whole M1 gate)
- Revisits: the S1.6.5 `colyseus.js@^0.16.22` client pin (a worker call that assumed there was no 0.17 client line)
- Builds on: ADR-0009 (server architecture — Colyseus `colyseus@0.17.x` + `@colyseus/schema@4` chosen at S1.4.1 as "latest, `next` 0.18/5.0 avoided")

## Context

E1.7's first story (S1.7.1) stands up the **first real server boot** — the first time a
real client speaks to the server over a real socket (M1 to date was verified against
mocks: the core is pure, the server room was unit-tested boot-free, the S1.6.5 WS client
against a mock transport). S1.7.1's mandated Step-0 version-compat spike **failed at a
STOP-gate**, exposing a hard incompatibility:

- **Server:** `colyseus@0.17.x` + `@colyseus/schema@4.0.x` (chosen at S1.4.1, ADR-0009).
- **Client:** `colyseus.js@^0.16.22` + bundled `@colyseus/schema@^3` (pinned at S1.6.5; the
  worker believed "there is no 0.17.x client line" — the line was **renamed**
  `colyseus.js` → `@colyseus/sdk`, which the worker did not find at the time).

**The break (reproduced twice, isolated from Fastify):** the seat-reservation response
shape changed between colyseus majors. A `0.17` server answers
`POST /matchmake/joinOrCreate/<room>` with a **flat** body
`{ name, sessionId, roomId, processId }`. The `0.16` client's
`Client.consumeSeatReservation` (`colyseus.js@0.16.22` `Client.mjs:106`) reads a **nested**
shape — `response.room.name`, `buildEndpoint(response.room, …)` — and throws
`TypeError: Cannot read properties of undefined (reading 'name')` **before any WebSocket
connect**. This is a matchmaking-protocol break; the schema v3↔v4 risk S1.6.5 flagged is
never even reached because the socket never opens. The two majors are **wire-incompatible
at matchmaking** — no server-side Schema or message-bus work can bridge it.

The M1 gate (S1.7.2's scripted 3–4-client match) cannot exist until client and server
speak the same colyseus major. This is the version-alignment fork the S1.7.1 story
reserved for the Queen.

## Decision

**Align both sides on colyseus major 0.17. Move the client to `@colyseus/sdk@^0.17.x`
(the renamed successor of `colyseus.js`); keep the server on its current `colyseus@0.17.x`
+ `@colyseus/schema@4`. Both sides land on `@colyseus/schema@4`.**

Concretely:
1. **Client dependency swap** — `packages/client`: drop `colyseus.js@^0.16`, add
   `@colyseus/sdk@^0.17.x` (the exact patch confirmed against the installed server major;
   the package is already present transitively via `@colyseus/testing`, so the resolution
   is known-good). Retarget the S1.6.5 net layer (`net/wsClient.ts` imports `Client`;
   `net/connection.ts` parses `ServerError`/close codes) to the 0.17 SDK API surface.
2. **Server unchanged** — no downgrade. S1.4.1's deliberate 0.17 + schema-v4 choice stands;
   the server room, its Schema projection, and the `@colyseus/testing` stack are untouched.
3. **Re-verify the S1.6.5 net contract against the real 0.17 SDK** — re-run (and fix, if the
   API drifted) the S1.6.5 mock-room net/store tests so `joinOrCreate`, `onMessage`,
   `onStateChange`, `room.send`, `leave`/`onLeave`, `sessionId`, and the `ServerError` /
   close-code shapes `connection.ts` depends on are confirmed on the 0.17 `Client`. The
   end-to-end proof (a real 0.17 client joining the real-booted 0.17 server) lands in S1.7.1,
   where the boot exists.

### Companion decision — the Fastify one-port boot shape

The S1.7.1 spike also found that the story's *preferred* boot shape —
`new Server({ transport: new WebSocketTransport({ server: fastify.server }) })` +
`gameServer.serverless()` + `fastify.listen()` — **double-binds HTTP**: colyseus core's
`bindRouterToTransport` calls `server.prependListener('request', …)`, so both Fastify and
the colyseus router answer every request (incl. `/health`) → `ERR_HTTP_HEADERS_SENT`.

**The one-port boot MUST use `attachToServer(fastify.server)`** (which binds **WS upgrades
only**, no `request` listener, leaving Fastify to own all HTTP) **and mount the colyseus
matchmaking HTTP handler into Fastify** (the `/matchmake/*` routes the client POSTs to —
via a proxy to the colyseus router or core's node matchmaking middleware). The bare
`serverless()` + shared-server shape is rejected. (The Express `express: (app) => {…}`
integration colyseus ships is not applicable — the stack is Fastify, ADR-0004.)

## Options considered

1. **(Chosen) Client → `@colyseus/sdk@0.17`, server stays 0.17.**
   - + No server downgrade: preserves S1.4.1's considered choice, the schema-v4 projection,
     and the whole S1.4.x server suite.
   - + Both sides on `@colyseus/schema@4` — unifies the major, retires the v3/v4 flag.
   - + `@colyseus/sdk@0.17` is the current, maintained client line and already resolvable in
     the tree.
   - − Touches `packages/client` net layer (S1.6.5 code) + re-verifies its net tests. Bounded:
     the net layer is small and mock-tested; API deltas surface immediately in typecheck/tests.
2. **(Rejected) Server → `colyseus@0.16` + `@colyseus/schema@3`.**
   - − A downgrade that moves backward; touches server deps, the Schema projection, and the
     `@colyseus/testing` stack; re-verifies the whole S1.4.x server suite. Larger blast radius
     to un-fix an oversight that lives on the client side.
3. **(Rejected) Keep both majors, bridge the matchmaking response server-side.**
   - − Fragile shape-shimming across a wire-protocol break; fights both libraries; no upstream
     support; would rot at the next patch. The break is protocol-level, not config-level.

## Consequences

- **S1.7.1 is unblocked** and folds the client SDK migration in as its first step (same
  `feat/s1.7.1-guest-auth` branch, resumed with full context), then the corrected
  `attachToServer` + mounted-matchmaking boot, then the real-socket join proof, then
  guest-auth/routes.
- **S1.6.5's `colyseus.js@0.16` pin is superseded**; the net layer retargets to
  `@colyseus/sdk@0.17`. Its framework-free/mock-tested design (structural `RoomLike`) means
  the retarget is contained to the `connect()` wrapper + the `Client` import + the
  `ServerError`/close-code parsing.
- **The S1.6.5 schema v3↔v4 flag is retired** — both sides on schema v4 (no cross-major
  Schema sync).
- **Determinism / core / protocol are untouched** — this is a transport-library alignment,
  not a rules or wire-envelope change (the `{v,type,payload}` protocol envelopes and the
  core engine are colyseus-agnostic).
- **Follow-up:** if the 0.17 SDK API differs materially from the 0.16 `Client` surface
  `connection.ts` assumed (close-code / `ServerError.code` extraction for the version-reject
  path), that adaptation is made in S1.7.1 and noted; lead-review gates it before merge.
