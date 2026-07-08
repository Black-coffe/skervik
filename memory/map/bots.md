# Map: packages/bots (@skervik/bots)
last-verified: 2026-07-08 (S2.4.2 + S2.4.2a merged `62400ca`, `8129962`)

## Purpose
AI bots: decision engine seam + in-process match simulator. Bots consume @skervik/core only; no authority (seed-blind). In-process delivery model for M2; separate bot process deferred to M5 scale.

## Entry points & files
- index.ts: BOTS_VERSION, exports Bot interface, createHeuristicBot(), v0.decideAction (re-export shim), simulateMatch, SimResult, SimulateMatchOptions
- heuristic/v0.ts: decideAction(state, playerId) — canonical v0 bot brain; MOVED byte-identical from S1.7.2 scriptedDriver; expansion-first greedy (roads→settlements→cities)+bank-trade; deterministic tie-breaks (topology/resource order); FROZEN (S1.7.2 gate 103/103 green)
- heuristic/v1.ts: decideV1(state, playerId, difficulty, rng) — S2.4.2 scored brain (dispatcher over shared eval module); ×3 difficulty (hard=argmax, medium=light noise, easy=top-K); weight order: settlement 100>city 55>road 40>knight 35>bankTrade 25>buyDevCard 20>endTurn (building always preferred); robber victims by PUBLIC VP respecting isStealable (S2.2.1); roads only toward open settlements (never dead-end); bank-trade fallback anti-stall; dev-card path for board-locked (low weight=termination fallback); seed-robust: 24 seed ×3 difficulty all terminate (≤489t, tail 40/120)
- eval/features.ts: shared pure EVALUATION module — reusable for v1 + M4 advisor; TOPO (cached buildTopology), pipWeight, vertexProductionValue, vertexResourceDiversity, blockingValue, vpProximity, vertexPortValue, countOwned, buildingsOf, isOpenSettlementSite, distanceOk, touchesOwnRoad/Network, vertexOccupied
- eval/evaluate.ts: WEIGHT layer — Difficulty type (easy|medium|hard), Weights interface (production/diversity/port/settlement/city/road/knight/bankTrade/devCard/robberBlocking/victimVp weights), evaluateVertex(state, playerId, difficulty, vertexId)→{score, features}, evaluateAction(state, playerId, intent, difficulty)→{score, features}, FEATURE_WEIGHTS per difficulty (easy zeros port/robberBlocking for naive play, low devCard to unlock board-lock at 9VP, all share endTurn=0)
- rng.ts: BotRng class — independent bot seed (NEVER the match seed, authority-blind), stateful counter over core's pure deriveValue(botSeed, index); BotRng.next()→[0,1), BotRng.pick(items)→T (deterministic, never empty); DEFAULT_BOT_SEED constant
- bot.ts: Bot seam (id, decide(state, playerId)) — pure 2-arg, seed-free, structural no-authority; createHeuristicBot({difficulty?, seed?})→Bot; id=v1-${difficulty}; decide closes over difficulty+rng (independent seed)
- harness.ts: simulateMatch(opts)→SimResult — in-process full-match runner; plays BOTH bots (seed-blind) + mock-authority (validate+reduce fold); reuses S1.7.2 genesis bootstrap; hard cap THROWS loud on max-turns/illegal/deadlock

## Key types & contracts
- Bot: {id: string, decide(state, playerId): PlayerIntent | null}; pure function, NO seed param (no authority)
- BotRng: stateful counter over deriveValue; deterministic, match-seed-blind, tests reproducible (same bot seed+match=same choices)
- Difficulty: 'easy'|'medium'|'hard'; feature set + selection noise (hard deterministic, medium 25% explore prob, easy top-3 pick)
- Weights: {production, diversity, port, settlementBase, cityBase, cityProduction, productionBottleneck, road, roadOpensSpot, bankTrade, devCard, knight, endTurn, robberBlocking, victimVp}
- SimulateMatchOptions: {seed, playerIds, bots: Record<PlayerId, Bot>, maxTurns?}
- SimResult: {finalState, events, winnerId, turns}

## Dependencies
Runtime: ONLY @skervik/core (no server deps, no ambient-RNG guard applies)
Dev: tsup, typescript, vitest

## Tests
22 tests (v1.test.ts 8 + eval.test.ts 8 + harness.test.ts 4 + bot.test.ts 1 + index.test.ts 1); seed-sweep 24×3 all pass; no core/server/protocol change since S2.4.2a

## Gotchas
1. **No seed param in Bot.decide** — bots are structurally seed-blind; only the server's validate() sees the real seed (authority boundary)
2. **v0 seed-fragility was ROOT-CAUSED to CORE bank bug** — NOT bot quality; [[core-bank-conservation-bug]] fixed in S2.4.2a; v0 still FROZEN for S1.7.2 gate parity
3. **v1 match-seed-blind via BotRng** — bot's own seed (default constant) feeds selection noise; never receives/uses match seed → provably cannot predict dice/deck
4. **simulateMatch fails loud, never hangs** — hard max-turns cap (default 6000) THROWS on cap/illegal/deadlock
5. **scriptedDriver.ts is now a re-export shim** (S2.4.1: decideAction moved to bots; server E2E imports from bots)
6. **Delivery model = in-process** (S2.4.3 wires bot into server #queue via forcedAction seam); separate process = M5 post-scale decision
7. **eval module is reusable** — features.ts+evaluate.ts pure, no side effects, `{score, features}` output designed for M4 advisor to consume "why" breakdowns (owner directive 2026-07-07)
