---
story: m2-gate-07
spec: m2-gate
status: todo
tier: 2
worker: worker-code
tracer: false
wave: 5
blocked_by: []
---

# Snapshot schema carries profileId + vpToWinOverride

## Goal
Review C3/M2: `PublicGameStateSchema` omits `profileId` and `vpToWinOverride`, and zod
strips unknown keys — a mid-match reconnect on an `expanded` match re-renders the
radius-2 Classic board (client derives topology from `gameState.profileId`, defaulting
to classic), and the effective victory threshold vanishes from client state. After this
story both optional fields survive the snapshot and a client test proves the reconnect
path keeps the expanded board.

## Requirements
> reconnect + bot-fill robust (no karmic bans)
> 2–6 players
> `PublicGameStateSchema` strips `profileId` (reconnect
> on expanded re-renders a Classic board) and never carried `vpToWinOverride`

## Files
- packages/protocol/src/messages.ts
- packages/protocol/src/messages.test.ts
- packages/client/src/net/

## Non-goals
- Both fields stay OPTIONAL (absent-key contract) — no default, no required.
- Do NOT touch core, GameRoom, board code, or hud/store logic — if the store needs a
  change for the test to pass, that is NEEDS_CONTEXT, not an improvisation.
- Do NOT rewrite existing snapshot tests — add, don't reshape.

## Map slice
packages/protocol/src/messages.ts:592-613 (PublicGameStateSchema), packages/client/src/net/wsClient.ts:170-181, packages/client/src/board/matchTopology.ts:41, packages/client/src/hud/store.ts:300+:414

## Acceptance criteria
- [ ] `PublicGameStateSchema` accepts and PRESERVES optional `profileId` and
      `vpToWinOverride` (roundtrip test: a payload carrying both parses with both).
- [ ] A client test proves a snapshot for an `expanded` match keeps
      `gameState.profileId === 'expanded'` through the wsClient parse path (the
      reconnect-board regression of review C3).
- [ ] Protocol + client suites green.

## Verification
`pnpm --filter @skervik/protocol test -- --reporter=dot && pnpm --filter @skervik/client test -- --reporter=dot`

## Implementation notes
<!-- appended by the worker -->

## Findings
<!-- appended by the worker ONLY on a wall -->
