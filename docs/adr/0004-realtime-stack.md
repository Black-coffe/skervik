# ADR-0004: Realtime/server stack

- Status: accepted
- Date: 2026-06-30
- Spec: docs/specs/roadmap (M1 E1.4, M2 E2.5)

## Context
Turn-based multiplayer needs stateful game rooms, state sync, reconnection, and a
matchmaker, on an OSS, low-cost, single-language (with the core) footing. Traffic is
cheap (one event per turn); the bottleneck is open WebSocket connections (tech spec §8).

## Options
1. **Node.js + Colyseus (rooms) + Fastify (REST)** — one language with the core (isomorphism), batteries-included rooms/sync/reconnect/matchmaker, OSS.
2. Custom `ws` server — full control, but rebuild rooms/sync/reconnect ourselves.
3. Elixir/Phoenix or Go — higher connection ceilings, but a second language and lower OSS contributor pool; loses core isomorphism.

## Decision
**Option 1.** Node + Colyseus + Fastify. Deciding factor: sharing the deterministic
core (ADR-0003) between client and server demands TypeScript on both; Colyseus gives
stateful rooms/reconnect/matchmaker out of the box; Fastify gives fast REST + schema
validation. WSS for realtime, HTTPS/REST for the rest; JSON now, MessagePack later.

## Consequences
- Easier: one language, fast start, low ops cost; sticky-by-room scaling is simple.
- Harder: Node's per-node connection ceiling is lower than Elixir/Go.
- Debt accepted: if we hit the ceiling, move *only the realtime layer* to Elixir/Go in M5, keeping core as the portable spec — a deferred "door", not built now.

## Invariants created
- State lives in one node per room (**sticky-by-room**); periphery (auth/lobby/matchmaking/presence) is stateless + horizontally scalable via Redis.
- Realtime over WSS; everything non-realtime over HTTPS/REST (OpenAPI 3.1).

## Revisit when
- A single node's concurrent-connection limit becomes the binding constraint on CCU (M5 trigger).
