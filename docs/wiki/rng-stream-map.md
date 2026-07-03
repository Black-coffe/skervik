---
domain: fairness
tags: [rng, determinism, board-generation]
related: [fair-rng-commit-reveal, deterministic-core]
last-verified: 2026-07-03
---

# RNG stream-index map

Every random draw in `@skervik/core` goes through `deriveValue(seed, streamIndex)`
(`rng.ts`) — never an ambient generator (ADR-0003, [[deterministic-core]]). Two
independent producers currently derive `streamIndex` from different sources; this
doc is the single place that tracks both, so no future story accidentally makes
them collide.

## 1. Gameplay draws — `state.eventIndex`

`validate.ts` draws gameplay randomness (currently just dice) at
`rollDie(seed, state.eventIndex)` — the same counter that becomes the emitted
event's `index`. This is a small, densely-packed range: `0, 1, 2, ...` counting
every event ever applied in the match.

_(Future note, not yet implemented: the M1 plan (§3) anticipates events needing
multiple draws — e.g. robber-steal victim pick — via
`streamIndex = state.eventIndex * K + slot` with a documented per-event slot map.
That scheme lands with S1.2.1+; until then `streamIndex === state.eventIndex`
exactly, one draw per event.)_

## 2. Board generation — reserved band (S1.1.2, `boardgen.ts`)

Board generation (`generateBoard`) runs once during setup and needs many draws
(tile shuffle, token shuffle with bounded retry, port shuffle). It does **not**
draw from `state.eventIndex` — colliding with the small, ever-growing gameplay
range above would eventually reuse the same `(seed, streamIndex)` pairs for
unrelated draws. Instead it draws from a fixed, reserved band far outside any
realistic `eventIndex` value, defined as `BOARD_GEN_STREAM` in `boardgen.ts`:

| Draw | Stream index | Slots consumed |
|---|---|---|
| Tile-kind shuffle (19 items → 18 draws) | `TILE_KIND_SHUFFLE = 1_000_000` | `1_000_000 .. 1_000_017` |
| Port-content shuffle (9 items → 8 draws) | `PORT_SHUFFLE = 1_000_100` | `1_000_100 .. 1_000_107` |
| Token shuffle, attempt `k` (18 items → 17 draws) | `TOKEN_SHUFFLE_BASE + k * TOKEN_SHUFFLE_STRIDE` = `1_001_000 + k * 100` | `1_001_000 + k*100 .. + 16` |

- `TOKEN_SHUFFLE_STRIDE = 100` — comfortably wider than the 17 slots one attempt
  consumes, so consecutive attempts never overlap.
- `TOKEN_RETRY_BOUND = 64` — the red-token (no adjacent 6/8) constraint is
  checked after each attempt; the first satisfying attempt wins. On exhaustion
  (all 64 attempts fail — never observed for any tested seed) the last attempt's
  tokens are used and `BoardLayout.redConstraintSatisfied` is `false`; generation
  never throws (ADR-0003). Max index reached at exhaustion:
  `1_001_000 + 63*100 + 16 = 1_007_316` — still far below the tile-kind/port bands
  of any *other* match's board generation would need, and far above any
  `state.eventIndex` a single match's event log reaches.

All three shuffles are independent draws from the same `seed` — recomputable by
anyone with the revealed seed, same as gameplay rolls ([[fair-rng-commit-reveal]]).

### Golden-seed regression point

For `seed = 'skervik-golden-seed-1'` (the same golden seed `rng.test.ts` uses),
`generateBoard` satisfies the red-token constraint on **attempt 4** (`attemptsUsed
=== 4`, i.e. stream indices `1_001_300..1_001_316` were the winning token
shuffle). Asserted in `boardgen.test.ts`'s golden test — a change to the
algorithm, the profile constants, or this stream-index map will fail that test.

## 3. Event-sourcing note

`generateBoard` is called once by the server (or a test) to produce a
`BoardLayout`; the caller wraps it into a `board.generated` event carrying the
*full* layout (`tileKinds`, `tileTokens`, `portContents`, `robberTileId`).
Replay (`reduce`) applies that event as data — it never re-invokes
`generateBoard` — so the reserved band above only matters at generation time,
not at replay time (`docs/wiki/deterministic-core.md`).
