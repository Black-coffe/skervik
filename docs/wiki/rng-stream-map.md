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

## 1. Gameplay draws — `eventIndex * K + slot` (S1.2.1)

`validate.ts` draws gameplay randomness at `rollDie(seed,
gameplayStreamIndex(state.eventIndex, slot))` (`gameplayStreamIndex`, `rng.ts`) —
**never** a bare `rollDie(seed, state.eventIndex)` anymore. `state.eventIndex`
is the same counter that becomes the resolving event's `index`; `K = 8` fixed
slots are reserved per event so an event needing several draws (e.g. the
robber steal-pick, S1.3.1) never collides with itself or a later event.
**This scheme is fixed as of S1.2.1 — never renumber a slot once shipped**; an
auditor's post-match recomputation depends on the mapping staying stable.

`gameplayStreamIndex(eventIndex, slot) = eventIndex * 8 + slot` (`rng.ts`,
generic — knows only `K`). `validate.ts` owns the actual slot map (parallel to
`boardgen.ts` owning `BOARD_GEN_STREAM`, §2 below):

| Event | Slot | Draw |
|---|---|---|
| `dice.rolled` (roll production) | `0` | die A |
| `dice.rolled` (roll production) | `1` | die B |
| _reserved_ | `2`–`7` | later same-event draws (e.g. robber steal-pick, S1.3.1) |

### Headroom guard

`gameplayStreamIndex` throws rather than silently colliding with the
board-gen reserved band (§2) if a draw would ever reach it: the guard is
`eventIndex * K + K <= 1_000_000`, i.e. `eventIndex <= 124_999`. With `K = 8`
this can only trip at `eventIndex >= 125_000` — unreachable in any real
Classic match (a 60-minute session, plan §1, lands nowhere close to
125,000 events). The bound is duplicated as a literal in `rng.ts` (not
imported from `boardgen.ts`) to avoid a `rng.ts` -> `boardgen.ts` import
cycle, since `boardgen.ts` already imports `shuffle` from `rng.ts`.

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
