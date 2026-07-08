# Map: packages/bots (@skervik/bots)
last-verified: 2026-07-08 (S2.4.1 merged `57efc8c`)

## Purpose
AI bots: decision engine seam + in-process match simulator. Bots consume @skervik/core only; no authority (seed-blind). In-process delivery model for M2; separate bot process deferred to M5 scale.

## Entry points & files
- index.ts: BOTS_VERSION, exports Bot interface, createHeuristicBot(), decideAction, simulateMatch, SimResult, SimulateMatchOptions
- heuristic/v0.ts: decideAction(state, playerId) — canonical v0 bot brain; MOVED byte-identical from S1.7.2 scriptedDriver; expansion-first greedy (roads→settlements→cities)+bank-trade; deterministic tie-breaks (topology/resource order); no seed param
- bot.ts: Bot interface (id, decide(state, playerId)); createHeuristicBot() wraps v0; seam intentionally thin (scoring module deferred to S2.4.2)
- harness.ts: simulateMatch(opts) — in-process full-match runner; acts as BOTH bots (seed-blind) AND mock-authority (validate+reduce fold); reuses S1.7.2 genesis bootstrap; hard cap THROWS loud on max-turns/illegal/deadlock

## Key types & contracts
- Bot: {id: string, decide(state, playerId): PlayerIntent | null}; pure function, NO seed param (no authority)
- SimulateMatchOptions: {seed, playerIds, bots: Record<PlayerId, Bot>, maxTurns?}
- SimResult: {finalState, events, winnerId, turns}
- decideAction(state, playerId): PlayerIntent | null — reactive, single-intent-per-call
- simulateMatch: deterministic, byte-identical to S1.7.2 proof match (278 turns to 10 VP, reproducible)

## Dependencies
Runtime: ONLY @skervik/core (no server deps, no ambient-RNG guard applies)
Dev: tsup, typescript

## Gotchas
1. **No seed param in Bot.decide** — bots are structurally seed-blind; only the server's validate() sees the real seed (authority boundary)
2. **v0 seed-fragility carry-forward** — greedy expansion-first v0 does NOT terminate on every seed (fresh seed stalled ~turn 200, never recovered at 20000-turn cap); S1.7.2 always pinned ONE proven seed (see [[e2e-scripted-driver-expansion]]); S2.4.2 ×3-difficulty scored brain MUST be robust across arbitrary seeds for bot-fill/single-player
3. **simulateMatch fails loud, never hangs** — hard max-turns cap (default 6000) THROWS on cap/illegal/deadlock
4. **scriptedDriver.ts is now a re-export shim** (S2.4.1: decideAction moved to bots; server E2E imports from bots)
5. **Delivery model = in-process** (S2.4.3 wires bot into server #queue via forcedAction seam); separate process = M5 post-scale decision
