# Map: packages/server (@skervik/server)
last-verified: 2026-07-08 (S2.4.3 merged `1da5022`; bot-fill in-process seam live)

## Purpose
Authoritative game room & REST stub. Colyseus stateful room holds the plain `GameState` + private seed; `@colyseus/schema` mirrors only the public lobby/late-join projection (seedHash/phase/currentPlayerId/seats). No gameplay flows through the Schema yet — that's `event.batch` broadcasts (S1.4.2). No seed reveal (S1.4.3), no event-log persistence (S1.4.4). S2.4.3 wires bot seats into the room via `#queue` forced-action seam (in-process delivery, no separate bot process — M5 decision).

## Entry points & files
- index.ts: SERVER_VERSION, createGameServer(), GAME_ROOM_NAME, GameRoom/GameRoomOptions re-export
- room/GameRoom.ts: Colyseus `Room` subclass; authoritative plain GameState (matchId/phase/turn/currentPlayerId/players/eventIndex/seedHash); private `#seed` (Seed type), private `#bots: Map<PlayerId, Bot>` (S2.4.3); onCreate/onJoin/onLeave/onDispose lifecycle; sha256Hex() helper; `#queue` serialization guard (S2.1.4); GameRoomOptions.bots? array (S2.4.3) + botActionCap? (test seam); `#maybeAutoStart()` shared by onCreate (bot-only) + onJoin; `#scheduleBotTurnIfNeeded()` + `#driveBotTurn()` on-queue bot executor
- schema/RoomSchema.ts: minimal `@colyseus/schema` projection (seedHash/phase/currentPlayerId/seats); SeatSchema ADDITIVE fields (S2.4.3): isBot: boolean (default false, ''=human), botDifficulty: string ('easy'|'medium'|'hard', ''=human); createRoomSchema factory (initializes empty seats ArraySchema)
- room/botFill.e2e.test.ts: NEW S2.4.3, 6 E2E tests (@colyseus/testing, bootOnPort 2569), bot-seat creation + single-player room flow + bot-turn dispatch
- e2e/scriptedDriver.ts: S2.4.1 — thin re-export shim; decideAction(state, playerId) moved to @skervik/bots (canonical v0 bot brain); S1.7.2 E2E suite 103/103 green UNCHANGED (parity proof)

## Key types & contracts
- GameRoom extends Colyseus `Room<{ state: RoomSchema }>` — the authority. Clients never mutate state.
- gameState: authoritative plain GameState (S1.4.1 set at onCreate, matches core's types exactly); never serialized via Schema (ADR-0009 Fork 1)
- `#seed`: private JS field (true, not a room property), Seed type, generated at onCreate via crypto.randomBytes(32), held server-side only, passed ONLY to validate()'s 4th arg, revealed post-game to match metadata (S1.4.3, ADR-0009 Fork 3)
- `#bots`: Map<PlayerId, Bot> (S2.4.3) — imported from @skervik/bots, populated in onCreate with 'bot-N' seat IDs via createHeuristicBot({difficulty}), indexed by their synthetic playerId; bot.decide(state, playerId) seed-blind + no client arg
- StateSnapshotMessage: {v, type: 'state.snapshot', payload: GameState} — sent once on onJoin; safe to serialize (no seed in GameState)
- RoomSchema: pure public projection — no hidden state, no game data
- SeatSchema: playerId, seatIndex, connected, isBot (S2.4.3, default false/''), botDifficulty (S2.4.3, 'easy'|'medium'|'hard' or ''=human)
- GameRoomOptions (S2.4.3): bots?: ReadonlyArray<{difficulty}> (populated in onCreate → #bots map), botActionCap?: number (test seam, default 100)

## Dependencies
Runtime: colyseus 0.17.10, @colyseus/schema 4.0.27, @skervik/core, @skervik/protocol, @skervik/bots (S2.4.3: bot creation + execution in GameRoom)
Dev: @colyseus/testing (S1.4.2+); @colyseus/testing bootOnPort (S2.4.3 botFill.e2e.test.ts)
Imports: @skervik/core (GameState, PlayerId, Seed types), @skervik/protocol (StateSnapshotMessage), @skervik/bots (Bot, createHeuristicBot)

## Gotchas
1. **Seed is NEVER in GameState** — only seedHash is public; raw seed stays in `#seed` private field and `validate()`'s 4th param (ADR-0009 Fork 3, seed-handling.md).
2. **Schema is NEVER the authoritative state** — it's a lobby/late-join projection only; gameplay is `event.batch` broadcasts (S1.4.2).
3. **Bot-drive seam (S2.4.3)** — bots execute via `#driveBotTurn()` enqueued onto the EXISTING `#queue` (shared serialization guard with human intents, no second apply path). Bot.decide has NO seed param → seed-blind. Events logged identically (no timestamp/marker) → replay byte-identical. Fallback is `resolveForcedAction` (as S2.1.4 setup forced-placement uses); per-turn `botActionCap` guard prevents infinite loops.
4. **Bot seats created in onCreate, not onJoin** — bots have no live Client; synthetic playerId='bot-N'; isBot=true+botDifficulty=code stored in RoomSchema for late-joiners to see bot occupancy.
5. **No grace timer, no reconnect yet** — M1 shell only; M2 handles disconnect (onLeave just marks seat.connected = false). Bot-fill (filling a human seat with a bot on disconnect) is E2.3, separate story.
6. **onDispose is empty** — no persistence/timers/cleanup needed at M1 scope (S1.4.4 adds log append, S1.4.3 adds seed reveal to metadata).
7. **node:crypto is a runtime dep** — randomBytes + createHash; this is where the server's crypto trust boundary lives (only trusted server touches it, never client or log).
8. **Minimal projection avoids Schema-churn cost** — full GameState in memory + state.snapshot on join is strictly cheaper than delta-syncing a hand/board/VP mirror in Schema (Fork 1 rationale vs. Fork 1 rejected).
