# Map: packages/server (@skervik/server)
last-verified: 2026-07-03 (S1.4.1 merged)

## Purpose
Authoritative game room & REST stub. Colyseus stateful room holds the plain `GameState` + private seed; `@colyseus/schema` mirrors only the public lobby/late-join projection (seedHash/phase/currentPlayerId/seats). No gameplay flows through the Schema yet — that's `event.batch` broadcasts (S1.4.2). No seed reveal (S1.4.3), no event-log persistence (S1.4.4).

## Entry points & files
- index.ts: SERVER_VERSION, createGameServer(), GAME_ROOM_NAME, GameRoom/GameRoomOptions re-export
- room/GameRoom.ts: Colyseus `Room` subclass; authoritative plain GameState (matchId/phase/turn/currentPlayerId/players/eventIndex/seedHash); private `#seed` (Seed type); onCreate/onJoin/onLeave/onDispose lifecycle; sha256Hex() helper
- schema/RoomSchema.ts: minimal `@colyseus/schema` projection (seedHash/phase/currentPlayerId/seats); SeatSchema (playerId/seatIndex/connected); createRoomSchema factory (initializes empty seats ArraySchema)

## Key types & contracts
- GameRoom extends Colyseus `Room<{ state: RoomSchema }>` — the authority. Clients never mutate state.
- gameState: authoritative plain GameState (S1.4.1 set at onCreate, matches core's types exactly); never serialized via Schema (ADR-0009 Fork 1)
- `#seed`: private JS field (true, not a room property), Seed type, generated at onCreate via crypto.randomBytes(32), held server-side only, passed ONLY to validate()'s 4th arg, revealed post-game to match metadata (S1.4.3, ADR-0009 Fork 3)
- StateSnapshotMessage: {v, type: 'state.snapshot', payload: GameState} — sent once on onJoin; safe to serialize (no seed in GameState)
- RoomSchema: pure public projection — no hidden state, no game data
- SeatSchema: playerId, seatIndex, connected (no resources/hands)

## Dependencies
Runtime: colyseus 0.17.10, @colyseus/schema 4.0.27
Dev: @colyseus/testing (S1.4.2+)
Imports: @skervik/core (GameState, PlayerId, Seed types), @skervik/protocol (StateSnapshotMessage)

## Gotchas
1. **Seed is NEVER in GameState** — only seedHash is public; raw seed stays in `#seed` private field and `validate()`'s 4th param (ADR-0009 Fork 3, seed-handling.md).
2. **Schema is NEVER the authoritative state** — it's a lobby/late-join projection only; gameplay is `event.batch` broadcasts (S1.4.2).
3. **No grace timer, no bot-fill, no reconnect yet** — M1 shell only; M2 handles disconnect (onLeave just marks seat.connected = false).
4. **onDispose is empty** — no persistence/timers/cleanup needed at M1 scope (S1.4.4 adds log append, S1.4.3 adds seed reveal to metadata).
5. **node:crypto is a runtime dep** — randomBytes + createHash; this is where the server's crypto trust boundary lives (only trusted server touches it, never client or log).
6. **Minimal projection avoids Schema-churn cost** — full GameState in memory + state.snapshot on join is strictly cheaper than delta-syncing a hand/board/VP mirror in Schema (Fork 1 rationale vs. Fork 1 rejected).
