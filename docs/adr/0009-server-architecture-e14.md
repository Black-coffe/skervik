# ADR-0009: E1.4 server architecture — state-sync, event-log format, seed boundary, package deps

- Status: accepted (Forks 1 & 4); **Forks 2 & 3 PENDING OWNER RATIFICATION** (raised 2026-07-03)
- Date: 2026-07-03
- Spec: docs/specs/m1-vertical-slice (E1.4 — S1.4.1 room, S1.4.2 intent pipeline, S1.4.3 commit-reveal RNG, S1.4.4 log persist)

> **⚠️ Ratification note (Queen, 2026-07-03).** Forks 1 (state-sync) and 4 (deps/
> boundaries) rest on already-locked principles and are accepted — **S1.4.1 (room)
> proceeds under them.** Forks 2 (retire the tech-spec §6.4 `EventLogLine` envelope
> for bare-`GameEvent` ndjson + consciously re-golden the A2 determinism fixture) and
> 3 (store the seed reveal in match metadata, not the event log) each deviate from a
> written artifact and **await owner sign-off before S1.4.2/S1.4.3/S1.4.4 ship**
> (those stories are HELD, not dispatched, until then).

## Context

E1.4 is the core→networked-server transition — the most consequential M1 fork.
`@skervik/core` is complete and deterministic (E1.1–E1.3, 210 tests): `validate(state,
intent, playerId, seed)` never throws and returns `{ok, events[]} | {ok:false, reason}`;
`reduce(state, event)` is pure; `replay(initial, events)` folds a log; the raw `seed`
is the server-secret 4th `validate` arg and is **never** on `GameState` (only `seedHash`
is public — ADR-0003, A1, `docs/wiki/seed-handling.md`). `@skervik/server` and
`@skervik/protocol` are honest stubs (colyseus/@colyseus/schema/fastify/zod NOT
installed).

Four forks must be settled once so S1.4.1–S1.4.4 can be materialized without
relitigating architecture. The five locked principles (CLAUDE.md) constrain every
answer: authoritative server; deterministic **isomorphic** core (`reduce` runs
identically server & client); stateful rooms sticky-by-room; event sourcing;
provably-fair commit-reveal RNG.

Two facts verified against the code drive the sharp decisions:

- `GameState` **never holds the seed** (`seed-handling.md`), so any public projection
  of it is safe to serialize by construction.
- Every `GameEvent` already carries `index` (== the log line's `seq`), and a recorded
  `dice.rolled` roll is reproduced by `rollDie(seed, gameplayStreamIndex(event.index,
  slot))`. The RNG audit therefore needs **no** field that a bare `GameEvent` lacks.
  The current `EventLogLine` wire format (`replay.ts`) is a pre-E1.1 artifact covering
  only **3 of ~18** `GameEvent` variants (`MATCH_STARTED`/`DICE_ROLLED`/`TURN_ENDED`,
  UPPER_CASE + a `data` envelope + a `toGameEvent` mapper).

## Decision

### Fork 1 — State-sync: **Option A (broadcast `event.batch`; clients run `reduce`)**

The room holds the authoritative plain `GameState` + secret seed in room memory. A
**minimal `@colyseus/schema`** mirrors only the lobby/late-join public projection:
`seedHash`, `phase`, `currentPlayerId`, and the seat/player list (ids, seat order,
connection status). Gameplay does **not** flow through the Schema.

Per validated intent the room broadcasts an `event.batch` envelope carrying the
`GameEvent[]` `validate` produced; **every client folds them through its own bundled
`@skervik/core` `reduce`** to advance its local `GameState`. This is the direct payoff
of the isomorphic-core + event-sourcing principles — one rules codebase, one fold, no
shadow state model on the wire.

Late-join / reconnect snapshot: on `onJoin` the room sends **one** `state.snapshot`
message = the full **public** `GameState` (safe: it never contains the seed), after
which the joiner receives live `event.batch` deltas. Replay-from-log for a joiner is
**rejected** for M1 (needed only for spectator/replay, M3) — sending the in-memory
public state the room already holds is strictly cheaper.

Rejected — **Option B (mirror full public `GameState` into a `@colyseus/schema`, let
Colyseus delta-sync it)**: forces a second, hand-maintained representation of the whole
state tree in Schema classes that must be kept byte-aligned with the `GameState` type
forever, and makes the client a passive renderer — discarding the isomorphic-core
prediction/animation capability the whole architecture was built to enable.

### Fork 2 — Event-log persistence format: **Option B (persist bare `GameEvent` ndjson)**

The canonical match log is **one `GameEvent` per ndjson line** (`JSON.stringify(event)`),
at `matches/{id}/events.ndjson` (tech spec §6.4). `GameEvent` is already plain-JSON,
deterministic, and self-indexing (`index`), so it is the single source of truth for
"one recorded fact." The read path is `JSON.parse` per line → `replay(initialState,
events)`; core may expose a thin `parseGameEventLog(ndjson): GameEvent[]` for symmetry.

The RNG-audit story (S1.7.3) is cleanly supported: `event.index` **is** the base
stream index, so the verifier recomputes each `dice.rolled` via `rollDie(seed,
gameplayStreamIndex(event.index, 0|1))` and compares to the recorded `dieA`/`dieB` —
no separate `rngStreamIndex` field required.

The `EventLogLine` UPPER_CASE wire format + `toGameEvent` mapper are **retired** (there
are zero production logs — the repo is pre-alpha, so nothing to migrate). The
determinism-gate fixture is **consciously re-goldened**: `golden.events.ndjson` is
rewritten as bare-`GameEvent` lines and `golden.state.json` is regenerated (the
replayed state is unchanged — only the input encoding changes). The named CI
core-determinism job (A2) keeps guarding the same guarantee against the new fixture;
the guarantee actually strengthens, because the gate now replays the **exact** wire
representation the server and client use, with no translation layer to drift.

Rejected — **Option A (extend `EventLogLine` + `toGameEvent` to all ~18 variants)**:
commits the project to maintaining two parallel event representations for its entire
life — every current and future event type authored in two places, in sync forever.
That is the expensive, compounding, non-boring path; the one-time re-golden of Option B
is a bounded cost with a cheaper undo.

`ts` (wall-clock) and `actor` from the old §6.4 envelope are **dropped** from the
canonical log (`ts` is non-deterministic and must never enter a replayed line; `actor`
is derivable from the event). If analytics later needs timestamps, add a **sidecar**
metadata stream (`matches/{id}/meta.ndjson`) — never inline them into the replayable
event log.

### Fork 3 — Seed & commit-reveal boundary: **confirmed, with reveal stored OUTSIDE the event log**

- The room generates a crypto seed at `onCreate` (Node `crypto`, e.g. `randomBytes`),
  holds it in a **private room-memory field** — never in `GameState`, never in the
  `@colyseus/schema`, never broadcast, never logged.
- At `match.started` the room publishes `seedHash = sha256(seed)` into
  `GameState.seedHash` (already a public field).
- The raw seed is passed **only** as `validate`'s 4th arg.
- **The reveal does NOT go into `events.ndjson`.** `seed.reveal` is not a `GameEvent`
  and must never affect state, so injecting a non-`GameEvent` line would break Fork 2's
  "one line = one `GameEvent`, fully replayable" invariant. The revealed seed is written
  at `game.ended` to the **match metadata** (PostgreSQL `matches.seed`, per tech spec
  §6; a `matches/{id}/seed-reveal.json` sidecar is the local-dev equivalent before the
  DB exists).
- `GET /matches/{id}/verify` (S1.7.3) reads the event log (GameEvents) + the revealed
  seed from metadata, recomputes every `dice.rolled` via core, and compares to
  `seedHash` and the recorded faces. The audit boundary lives in the server REST layer,
  computing through core — never re-implementing RNG.

Leak vectors to police at review (add to the seed-handling checklist): (1) no seed
field on any `@colyseus/schema`; (2) server error handlers / rejection replies never
echo the room's seed (`validate` already never returns it); (3) structured logs emit
`seedHash` only, never `seed`; (4) the `state.snapshot` message sends public
`GameState`, which is seed-free by construction; (5) reveal happens strictly **after**
`game.ended`, never earlier.

Rejected — **appending a `seed.reveal` record to `events.ndjson`**: pollutes the pure
`GameEvent` log with a non-event, non-replayable line, coupling the fairness-reveal
concern to the determinism format. Storing it in match metadata keeps both clean.

### Fork 4 — Dependencies & package boundaries

- **`@skervik/server` gets `colyseus` + `@colyseus/schema` now** (E1.4's core need).
  **Fastify is deferred** — E1.4 ships no REST route; install it in the first story
  that needs one (S1.7.3 verify endpoint / a health route), per "no speculative
  deps." Pin both to the current stable major; the worker resolves exact versions with
  `pnpm add` and records them in the story. **Risk to spike in S1.4.1:** confirm the
  chosen Colyseus major runs clean under Node 22 + ESM + tsup; if not, that surfaces
  before any room logic is built.
- **`@skervik/protocol` gains the WS message envelope as a TYPE-ONLY definition now**
  (`{ v, type, payload }` for `intent`, `event.batch`, `state.snapshot`). E1.4 needs
  the shared shape so server and client import one definition; **zod runtime schemas
  stay deferred to S1.5.1**, so protocol acquires **no new runtime dep** in E1.4 — it
  remains type-only over `@skervik/core`.
- **`@skervik/core` stays zero-runtime-dep.** Dependency direction is
  server → {core, protocol}, protocol → core (type-only), core → nothing. The seed
  crypto lives in `@skervik/server` (the room), never in core; core's `rollDie` remains
  pure PRNG derivation.

## Consequences

- **Easier:** one rules codebase drives both authority and client prediction (Fork 1);
  a single, self-indexing event representation on wire, on disk, and in the determinism
  gate (Fork 2); the fairness audit falls out of `event.index` with no extra bookkeeping
  (Forks 2+3); protocol/core dependency graph stays acyclic and core stays pure (Fork 4).
- **Harder / debt accepted:** a one-time conscious re-golden of core's determinism
  fixture and retirement of the `EventLogLine`/`toGameEvent` layer (Fork 2 — a change
  to a "complete" package, but bounded and test-guarded); the client must bundle
  `@skervik/core` and cannot be a thin renderer (Fork 1 — intended); wall-clock
  timestamps leave the canonical log until a sidecar is added (Fork 2); Colyseus ESM/Node
  22 compatibility is an unretired spike risk (Fork 4, S1.4.1).
- **Per-story guidance:**
  - **S1.4.1 (room):** Colyseus `Room` subclass holding authoritative plain `GameState`
    + a private crypto `seed` generated at `onCreate`. A minimal `@colyseus/schema`
    mirrors only `seedHash`/`phase`/`currentPlayerId`/seat list. `onJoin` sends one
    `state.snapshot` (full public `GameState`); seat/connection management for
    late-join & reconnect. Installs `colyseus` + `@colyseus/schema`; spikes ESM/Node 22.
  - **S1.4.2 (intent pipeline):** `onMessage(intent envelope)` → `validate(room.state,
    intent, playerId, room.seed)` → on `ok`, fold `events` through `reduce` into the
    authoritative `room.state`, broadcast an `event.batch` envelope, and hand the events
    to the log-append path; on reject, reply privately to the sender with the
    `RejectReason`. Envelope type imported from `@skervik/protocol`.
  - **S1.4.3 (commit-reveal RNG):** wire the seed lifecycle of Fork 3 — crypto seed at
    create, `seedHash` into `GameState` at `match.started`, raw seed only into
    `validate`, reveal written to match metadata at `game.ended`. Implements the
    leak-prevention checklist; does **not** put the reveal in the event log.
  - **S1.4.4 (log persist):** append each validated `GameEvent` as one
    `JSON.stringify(event)` ndjson line to `matches/{id}/events.ndjson` (local FS now,
    S3 later); read path = `parseGameEventLog` + `replay`. **Includes** re-goldening
    core's determinism fixture to the bare-`GameEvent` format and retiring
    `EventLogLine`/`toGameEvent` (coordinate with the A2 CI gate).

## Invariants created

Copy verbatim into `docs/wiki/` (extend `seed-handling.md` / `server-authority.md`):

1. **The room is the only authority.** Clients send intents; only server-validated
   `GameEvent`s (broadcast as `event.batch`) mutate any client's state, via the same
   `@skervik/core` `reduce`. Clients never author events.
2. **The Colyseus `@colyseus/schema` holds only the public lobby/late-join projection**
   (`seedHash`, `phase`, `currentPlayerId`, seat list) — never the full game state,
   never a resource/hand/board field, and **never the seed**.
3. **The canonical match log is one `GameEvent` per ndjson line** — no separate wire
   format, no non-`GameEvent` lines. `event.index` is the RNG-audit base index. Non-
   deterministic metadata (timestamps) lives only in a sidecar, never inline.
4. **The raw seed lives only in room memory and `validate`'s 4th arg.** It is revealed
   only after `game.ended`, only into match metadata (never the event log, never a
   Schema, never a broadcast, never a log line beyond `seedHash`).
5. **Dependency direction is fixed:** server → {core, protocol}; protocol → core
   (type-only); core → nothing. `@skervik/core` never gains a runtime dependency and
   never imports server or protocol.

## Revisit when

- Colyseus proves ESM/Node 22-incompatible or its Schema model fights the minimal-
   projection approach (S1.4.1 spike) — reopen Fork 1/Fork 4 before building room logic.
- The client can no longer bundle `@skervik/core` (bundle-size or licensing pressure) —
   reopen Fork 1 (would force a server-authoritative full-state-sync model).
- Analytics/replay UI needs authoritative wall-clock timing or `actor` on the log —
   add the sidecar rather than reopening Fork 2.
- A required random event cannot reproduce from `event.index` alone — reopen Fork 2's
   "no `rngStreamIndex` field" simplification before shipping that event type.
