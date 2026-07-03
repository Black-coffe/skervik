# Map: packages/core (@skervik/core)
last-verified: 2026-07-03 (mid-S1.2.1, uncommitted changes present)

## Purpose
Pure, deterministic, isomorphic rule engine for Skervik — zero runtime deps.
Event-sourced (intent→validate→events→reduce→state), commit-reveal fair RNG
(seed never in GameState, only seedHash). Identical execution on client (predict)
and server (authority).

## Entry points & files
- index.ts: re-export barrel (CORE_VERSION, types, reduce/replay, validate, RNG, board/boardgen)
- types.ts: GameState, GameEvent (7 variants), PlayerIntent (4 variants), RejectReason, resource/board shapes
- reduce.ts: reduce(state, event) → new GameState; pure, never mutates input; replay(state, events[])
- validate.ts: validate(state, intent, playerId, seed) → {ok: true, events[]} | {ok: false, reason}; owns CLASSIC_SETUP_PROFILE, GAMEPLAY_SLOT map
- rng.ts: rollDie(seed, index), deriveValue(seed, index) [1..6 and [0,1)]; mulberry32-counter mode (no mutable generator state); Seed type (opaque string)
- board.ts: buildTopology() → BoardTopology (19 tiles, 54 vertices, 72 edges); AxialCoord, TileId, VertexId, EdgeId, PortSlot (9 fixed coastal slots)
- boardgen.ts: generateBoard(seed) → BoardLayout; BOARD_GEN_STREAM slot map; CLASSIC_BOARD_PROFILE
- replay.ts: parseEventLog(ndjson) → EventLogLine[]; replayLog(genesis, entries) → final GameState; EventLogLine schema for disk/wire

## Key types & contracts
- GameState: matchId, phase, turn, currentPlayerId, players[], eventIndex (PRNG stream index), seedHash (commit step, SHA256(seed)), board?, buildings?, pendingRoadVertexId?, bank? — immutable, plain objects only, JSON-serializable
- GameEvent discriminated union: MatchStartedEvent, BoardGeneratedEvent, DiceRolledEvent (dieA, dieB, total as facts), ResourcesProducedEvent (grants + full bank state as facts), TurnEndedEvent, SettlementPlacedEvent (payout as fact), RoadPlacedEvent (nextPlayerId, nextPhase as facts)
- PlayerIntent discriminated union: RollDiceIntent, EndTurnIntent, PlaceSettlementIntent, PlaceRoadIntent
- ValidateResult: {ok: true, events: GameEvent[]} | {ok: false, reason: RejectReason}
- Seed: opaque string, passed to validate() as 4th param only, NEVER stored in GameState (A1 invariant)
- reduce signature: (state: GameState, event: GameEvent) → GameState
- validate signature: (state, intent, playerId, seed) → ValidateResult

## Dependencies
Runtime: NONE (ADR-0003, zero-dep policy verified in package.json)
Dev: @types/node, tsup, typescript, vitest

## Tests
replay.test.ts: 4 describe blocks (golden fixture parsing, RNG stream audit, replay determinism, idempotency)
rng.test.ts: 5 test cases (deriveValue golden outputs, range [0,1), repetition, call-order independence, seed variation)
types.test.ts: 3 describe blocks (GameState serialization, GameEvent/Intent discrimination, RejectReason enum)
reduce.test.ts, board.test.ts, boardgen.test.ts, setup.test.ts, production.test.ts: ~36 real cases total
Total: 41 tests, all regression/golden guards + determinism verification + contract checking

## Gotchas
1. **Seed is NEVER in GameState** — FIX-PLAN A1 (49fcbb5). Only seedHash travels with state. Seed passed to validate() as 4th param, revealed post-match for RNG audit. This is the commit-reveal invariant.
2. **Determinism is absolute** — no Date.now(), Math.random(), I/O, Map/Set. All randomness from seed + eventIndex via gameplayStreamIndex(). Plain objects only (ADR-0003).
3. **Events are immutable facts, not recipes** — validate computes once (rolls, payouts, production math), results travel as event data. reduce() applies, never recomputes.
4. **RNG slot map is LOCKED forever** — GAMEPLAY_SLOT.DICE_A=0, DICE_B=1 (slots 2-7 reserved S1.3.1+). Cannot renumber; auditors recompute from seed+slots.
5. **BoardTopology memoized** — buildTopology() cached once per module (pure, deterministic, radius-2 invariant).
6. **Bank exhaustion all-or-nothing per resource** — if bank lacks full amount owed of a resource, nobody gets any of it this roll (not partial splits).
7. **Fixtures are frozen, regenerate on algorithm change** — golden.events.ndjson + golden.state.json checked in; replay.test.ts regression guard fails if core shape changes.
8. **CLASSIC_PRODUCTION_PROFILE hardcoded** — bankPerResource=19 (physical-Catan parity), not parameterized; swappable in validate.ts only if future profiles needed.
9. **Topology cached globally** — topology() in validate.ts reuses one buildTopology() result; thread-safe for Node (single-threaded), but not concurrent.
10. **Current: S1.2.1 mid-flight** — map captures uncommitted changes on feat/s1.2.1-production; production/bank logic live but not yet merged to main (dice + production events wired end-to-end, S1.3.1 robber deferred).
