# Map: packages/core (@skervik/core)
last-verified: 2026-07-08 (S2.2.4 merged, main HEAD 0aeeb4f)

## Purpose
Pure, deterministic, isomorphic rule engine for Skervik — zero runtime deps.
Event-sourced (intent→validate→events→reduce→state), commit-reveal fair RNG
(seed never in GameState, only seedHash). Identical execution on client (predict)
and server (authority).

## Entry points & files
- index.ts: re-export barrel (CORE_VERSION, types, reduce/replay, validate, RNG, board/boardgen); exports computePublicVictoryPoints (S2.2.1)
- types.ts: GameState, GameEvent (28 variants), PlayerIntent (18 variants), RejectReason (append-only union, incl. 'VICTIM_PROTECTED' S2.2.1), resource/board shapes; new GameState.finalRound? (S2.2.3), new GameFinalRoundStartedEvent (S2.2.3); types.test.ts exhaustiveness switch covers all 28 GameEvent variants
- reduce.ts: reduce(state, event) → new GameState; pure, never mutates input; replay(state, events[]); case 'game.finalRoundStarted' (S2.2.3) sets state.finalRound fact; 'game.ended' case unchanged (reused by final round); 'dice.rolled' case with total=7 (S2.2.4) increments sevensRolled when catchUp.eventTiles true, else stays absent
- validate.ts: validate(state, intent, playerId, seed) → {ok: true, events[]} | {ok: false, reason}; owns CLASSIC_SETUP_PROFILE, CLASSIC_VICTORY_PROFILE, CLASSIC_ROBBER_PROFILE, GAMEPLAY_SLOT map; victory pipeline (computeVictoryPoints, computeLongestRoad, computeLargestArmy) runs post-action; computePublicVictoryPoints(state, playerId) excludes hidden-VP-devcard (S2.2.1 friendly robber, S2.2.3 hiddenVp threshold); module-private thresholdVp helper = hiddenVp ? computePublicVictoryPoints : computeVictoryPoints (S2.2.3); computeFinalWinner = highest full VP → fewest buildings → earliest seat (S2.2.3 tie-break); appendAwardsAndVictory win-check: branches on catchUp.finalRound — off → emit game.ended; on & not-triggered → emit game.finalRoundStarted; on & already-triggered → emit nothing; turn-end path (intent.endTurn): when state.finalRound set AND next current === triggeredBy, append game.ended with computeFinalWinner winner; rollDice 7-branch (S2.2.4): if catchUp.eventTiles, after discard/robber setup, checks eventStorm = ((sevensRolled+1) % eventTilesInterval === 0), then REUSES computePovertyGrants() to emit poverty.tokensGranted (same event, same pool, same trailing-player mechanics as S2.2.2)
- rng.ts: rollDie(seed, index), deriveValue(seed, index) [1..6 and [0,1)]; mulberry32-counter mode (no mutable generator state); Seed type (opaque string)
- board.ts: buildTopology() → BoardTopology (19 tiles, 54 vertices, 72 edges); AxialCoord, TileId, VertexId, EdgeId, PortSlot (9 fixed coastal slots)
- boardgen.ts: generateBoard(seed) → BoardLayout; BOARD_GEN_STREAM slot map; CLASSIC_BOARD_PROFILE
- replay.ts: parseEventLog(ndjson) → EventLogLine[]; replayLog(genesis, entries) → final GameState; EventLogLine schema for disk/wire

## Key types & contracts
- GameState: matchId, phase, turn, currentPlayerId, players[], eventIndex (PRNG stream index), seedHash (commit step, SHA256(seed)), board?, buildings?, pendingRoadVertexId?, bank?, longestRoadHolder?, largestArmyHolder? (S1.3.4 awards); profileId? (S2.1.1) — immutable, plain objects only, JSON-serializable
- GameEvent discriminated union: MatchStartedEvent, BoardGeneratedEvent, DiceRolledEvent (dieA, dieB, total as facts), ResourcesProducedEvent (grants + full bank state as facts), TurnEndedEvent, SettlementPlacedEvent/RoadPlacedEvent/CityBuiltEvent (payouts/nextPhase as facts), award.longestRoad/award.largestArmy (holder + value as facts), game.ended (rankings, finalStandings as facts, phase→finished) (S1.3.4)
- PlayerIntent discriminated union: RollDiceIntent, EndTurnIntent, PlaceSettlementIntent, PlaceRoadIntent, MoveRobberIntent, DiscardIntent, TradeIntent (S1.3.1+, S1.3.2)
- ValidateResult: {ok: true, events: GameEvent[]} | {ok: false, reason: RejectReason}
- RejectReason: union of ~25 reasons incl. new 'VICTIM_PROTECTED' (friendly robber gate, S2.2.1); append-only for audit/replay
- RobberProfile (S2.2.1): handLimit, halfDivisor, friendlyRobber (bool), friendlyRobberVpCeiling (PUBLIC-VP protection threshold)
- CatchUpProfile (S2.2.2–S2.2.4, ruleProfile.ts:121-164): robinHood/robinHoodVpGap/robinHoodTokenCap/robinHoodExchangeRate (S2.2.2); finalRound (bool, Splendor-style round-to-end, S2.2.3), hiddenVp (bool, dev-card VP excluded from trigger threshold, S2.2.3); NEW eventTiles (bool, 7-roll cadence grants poverty tokens, S2.2.4) + eventTilesInterval (count modulo, S2.2.4) — all off on shipping presets; two test-only profiles (EVENT_TILES_TEST_PROFILE_ID `'__event_tiles_test__'` interval 2, EVENT_TILES_ROBIN_HOOD_TEST_PROFILE_ID both flags true) in PROFILE_REGISTRY, NOT client-selectable
- GameState.finalRound? (types.ts:378-381, S2.2.3 optional additive field): { triggeredBy: PlayerId, triggeredOnTurn: number } — ABSENT under finalRound:false, never written when off (golden byte-frozen); present once game.finalRoundStarted lands
- GameState.sevensRolled? (types.ts:393, S2.2.4 optional additive field): cumulative 7-roll count (cadence anchor for event-tile grants) — ABSENT under eventTiles:false, never written when off (golden byte-frozen); incremented in reduce's dice.rolled case when total=7
- GameFinalRoundStartedEvent (types.ts:850-854, S2.2.3): { type: 'game.finalRoundStarted', triggeredBy: PlayerId, triggeredOnTurn: number } — emitted when a player reaches vpToWin while finalRound:on; NEVER emitted under finalRound:false
- Seed: opaque string, passed to validate() as 4th param only, NEVER stored in GameState (A1 invariant)
- reduce signature: (state: GameState, event: GameEvent) → GameState
- validate signature: (state, intent, playerId, seed) → ValidateResult
- computePublicVictoryPoints signature: (state: GameState, playerId: PlayerId) → number (excludes hidden-VP-devcard, used by friendly robber filter)

## Dependencies
Runtime: NONE (ADR-0003, zero-dep policy verified in package.json)
Dev: @types/node, tsup, typescript, vitest

## Tests
eventTiles.test.ts: 14 tests (S2.2.4 eventTiles + robinHood combos, cadence grants, cap behavior, robber/discard unchanged)
replay.test.ts, rng.test.ts, types.test.ts, reduce.test.ts, board.test.ts, boardgen.test.ts, setup.test.ts, production.test.ts, victory.test.ts, and others: ~308 cases total
Total: 322 tests, all regression/golden guards + determinism verification + contract checking; E2.2 (all catch-up mechanics) complete

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
10. **Victory checks ONLY on the acting player's turn** — computeVictoryPoints() is invoked post-action in the turn sequence (S1.3.4); early winners are checked immediately after their action that triggered the win (e.g., build settlement crossing threshold). This prevents mid-turn interference (opponent building during the active player's turn does not trigger a check).
11. **Longest road is longest-simple-path, opponent buildings break chains** — the DFS engine (computeLongestRoad, longestRoadLength) enforces this; roads cannot pass through or around opponent settlements/cities (S1.3.4 victory.test.ts).
12. **Largest army is strict-exceed, ties stay with incumbent** — first to largestArmyMin (3) knights gets the award; later players must exceed the incumbent's count to steal it, not tie (S1.3.4 CLASSIC_VICTORY_PROFILE.largestArmyMin=3).
13. **Friendly-robber victim gate uses PUBLIC-VP only** — computePublicVictoryPoints(state, playerId) excludes hidden dev-cards to prevent a dishonest server from leaking dev-card hand via robber eligibility filtering (S2.2.1). When friendlyRobber=true, a candidate with PUBLIC-VP ≤ ceiling is rejected; validate + forcedAction.ts both apply this gate.
14. **Final round is deterministic-from-state (S2.2.3)** — NO seed slot, NO new PRNG. Trigger, round-completion (when next player === triggeredBy), threshold measure (via thresholdVp helper), and winner (computeFinalWinner: full VP → fewest buildings → earliest seat) are all pure functions of state + profile. verify.ts is untouched; golden replay/verify byte-frozen under finalRound:false.
15. **Hidden-VP threshold swap uses PUBLIC-VP (S2.2.3)** — when hiddenVp:true, the win/trigger threshold reads computePublicVictoryPoints (dev-card VP excluded, no leak); hidden VP is revealed ONLY in game.ended finalStandings (always full VP). thresholdVp helper wraps the conditional; reuse computePublicVictoryPoints/computeVictoryPoints unchanged.
16. **finalRound field is additive/absent when off (S2.2.3)** — the trigger event (game.finalRoundStarted) is NEVER emitted under finalRound:false, so state.finalRound is never written → serialized state byte-IDENTICAL to today (Classic golden/replay/verify frozen). Same "absent key = fact never happened" optionality as povertyTokens/devCards.
