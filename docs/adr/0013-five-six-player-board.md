# ADR-0013: 5–6 player mode — expanded radius-3 board delivered as a `BoardProfile`

- Status: **accepted** (owner sign-off 2026-07-13 — geometry ratified: 37 tiles / 96 vertices / 132 edges, tileMix 8/6/8/8/6 + 1 desert, 36 tokens, 11 ports; **bots routed through the per-radius topology to play the expanded board** — single-player + bot-fill functional at 5–6, quality re-tune deferred to M3)
- Date: 2026-07-13
- Spec: docs/specs/m2-mode-platform (E2.1 — new story **S2.1.7**, the last buildable M2 gate gap: acceptance criterion "2–6 players")
- Builds on: ADR-0003 (core is pure, zero-runtime-dep, deterministic; no wall-clock/ambient RNG), ADR-0009 Fork 2/3 (bare-`GameEvent` log; `board.generated` is a replayable event; seed stays a `validate` arg), ADR-0002 (Pixi client renders whatever topology core hands it). Discharges the **verify board-leg carry-forward** (`memory/` → verify-profile-blindness-carryforward).

## Context

E2.1's acceptance criterion is "2–6 players." Everything up to 4 players already
works: `validate.ts:142 snakeOrder()` + the setup FSM are N-agnostic (2/3/4
exercised), `adaptiveDuration.ts:32 ADAPTIVE_MAX_PLAYERS = 6` already admits 6
seats, and the 2-player mode (S2.1.6) shipped. The single missing piece is a
**board large enough for 5–6 players**: the Classic board is 19 tiles / 54
vertices, which cannot seat 5–6 flotillas without starving everyone for space.

This is the **first genuinely board-diverging profile**. Every prior non-Classic
profile (balanced-deck randomness, twoPlayer) reused the *standard* radius-2
board, so a latent seam has never been exercised: **the board is a radius-2
singleton baked throughout the codebase.** `board.ts:76-79` hardcodes
`RADIUS = 2` and `PORT_SLOT_COUNT = 9` at module scope; `validate.ts:133` caches
**one** `cachedTopology ??= buildTopology()`; the bots (`features.ts:31`,
`v0.ts:32`) and client (`GameTable.tsx:17`) each build a module-scope `TOPO =
buildTopology()`; and `verify.ts:189` recomputes `board.generated` against a
hardcoded `buildTopology()` that ignores the profile's board entirely. Delivering
a bigger board means turning that singleton into a per-match, profile-resolved
value — the substance of this decision.

Two facts verified against the code make the delivery clean:

- **`boardgen.generateBoard(seed, topology, board)` already takes a `BoardProfile`**
  (`boardgen.ts:134`), and `RuleProfile.board: BoardProfile` already exists
  (`ruleProfile.ts:218`). The red-token (6/8) adjacency constraint
  (`boardgen.ts:103-123`) is topology-driven via `buildTileAdjacency`, so it
  adapts to any board size with no change. **Board *contents* are already config.**
- **Board *geometry* (radius, port count) is the only thing still hardcoded.**
  `buildTopology()` walks rings `1..RADIUS` and spaces `PORT_SLOT_COUNT` slots
  evenly around whatever coastline results — both are pure functions of two
  scalars. Parameterising them is the core code change; everything downstream
  (vertices, edges, ports, adjacency) derives automatically.

Legal constraint (CLAUDE.md): the layout must be **original**. Catan's own 5–6
extension (30 tiles, 11 ports) is a distant calibration point for *density only*,
never a template — the counts below are designed from Skervik's own resource set
and balance goals, not copied.

## Options

1. **Radius-3 hexagon (37 tiles), one shared expanded board, delivered via
   `BoardProfile.radius`** — flip one scalar; all geometry derives; seed-recompute
   and verify stay first-class. Slightly sparse at 5p (7.4 tiles/player).
2. **Custom irregular ~30-tile board** — denser, closer to a "5–6 feel", but the
   shape is not a complete hex ring, so `enumerateTileCoords()`'s clean ring-walk
   no longer produces it; you need an explicit hand-authored coord list, bespoke
   coastline/port discovery, and a second topology code path — more code, harder
   to keep seed-recomputable, costlier undo.
3. **Register per-preset expanded variants now** (`classic6`, `balanced6`,
   `blitz6`) so any mode plays big at 5–6 — but this depends on the *unsolved*
   adaptive-profile-override delivery seam and multiplies presets (Law 2).

## Decision

### Decision 1 — Board size/shape: **radius-3 hexagon, 37 tiles (Option 1)**

One expanded board, a **radius-3 hexagon = 37 tiles / 96 vertices / 132 edges /
42 boundary edges** (derived: `tiles(r) = 3r²+3r+1`; Euler + the standard
hex-perimeter `6(2n-1)` for side `n=r+1` give the vertex/edge/boundary counts —
verified against the known radius-2 values 19/54/72/30). It is chosen because it
is the **boring, reversible** option: the entire geometry is a pure function of
`RADIUS`, so the change is "make one module constant a parameter" rather than
"author and maintain a second board shape." Option 2's custom board buys marginally
better density at the price of an irregular topology that breaks the ring-walk and
duplicates the coastline/port logic — a materially more expensive undo for a
feel-tuning gain we can get another way (Decision 4).

**On density.** Radius-3 gives 6.2 tiles/player at 6p and 7.4 at 5p, versus
Classic's 4.75 at 4p (and 6.3 at 3p) — a touch sparser than Catan's 5-tile/player
extension. This is acceptable because:

- **Match *length* is not driven by board size.** `estimateMatchMinutes`
  (`adaptiveDuration.ts:58`) keys off `playerCount × vpToWin`, not tile count; the
  60-min ceiling is already enforced by lowering `vpToWin` (e.g. 6p-Classic
  estimates 82 min → adaptive trims `vpToWin` to ~6 to fit). A bigger board does
  not blow the clock.
- **Endgame contention stays tight by the piece math, not the tile count.** The
  distance-2 settlement rule caps a 96-vertex board at ~32 non-adjacent
  settlements; 6 players × 5 settlements = 30 — the board fills to ~94% capacity,
  so late-game spots are genuinely scarce. Per-player supply needs no change
  (Decision 4).
- **If 5–6p playtests still feel sprawly, the fix is the existing
  `neutralSettlements` lever (S2.1.6), not a reshape.** Phantom blocking
  settlements on high-production vertices force spread and contention *without*
  touching topology or the seed — a tested mechanic already in the engine. This
  is the revisit path, and it is why Option 2's density edge is not worth its cost.

### Decision 2 — The expanded `BoardProfile` (concrete counts for owner sign-off)

| Quantity            | Classic (radius 2)        | **Expanded (radius 3)**            |
| ------------------- | ------------------------- | ---------------------------------- |
| Tiles               | 19                        | **37**                             |
| Vertices / Edges    | 54 / 72                   | **96 / 132**                       |
| Boundary edges      | 30                        | **42**                             |
| Deserts             | 1                         | **1**                              |
| Resource tiles      | 18                        | **36**                             |
| Number tokens       | 18                        | **36**                             |
| Port slots          | 9                         | **11**                             |
| Tiles / player      | 4.75 (4p)                 | **7.4 (5p) / 6.2 (6p)**            |

**`tileMix` — length 37** (one desert; resource ratio preserves Classic's
`4:3:4:4:3` timber:clay:fleece:barley:iron, doubled, keeping clay + iron the
scarce/premium resources that drive the economy):

- timber ×8, clay ×6, fleece ×8, barley ×8, iron ×6, desert ×1  → **37**

**`tokens` — length 36** (one per non-desert tile; symmetric, flattened
triangular distribution — extremes rarest, 6/8 among the mode; **8 red (6/8)
tokens**, comfortably placeable pairwise-non-adjacent on 37 tiles so the existing
bounded red-constraint retry stays satisfiable):

- `[2,2, 3,3,3,3, 4,4,4,4, 5,5,5,5, 6,6,6,6, 8,8,8,8, 9,9,9,9, 10,10,10,10, 11,11,11,11, 12,12]`
- i.e. 2×2, 3×4, 4×4, 5×4, 6×4, 8×4, 9×4, 10×4, 11×4, 12×2 (no 7)  → **36**

**`ports` — length 11** (must equal the port-slot count; **one 2:1 port per
resource** is the fairness invariant carried from Classic, generics fill the
rest):

- generic 3:1 ×6, plus 2:1 for each of timber, clay, fleece, barley, iron  → **11**

**One desert (not two).** It keeps `generateBoard`'s "exactly one desert →
`.find` succeeds" assumption (`boardgen.ts:177`) byte-valid, gives a clean even
token count (36), and matches Classic's dead-tile ratio (2/37 ≈ 1/19). Port count
11 is the middle of the sensible band (10–13 for 42 boundary edges) that keeps the
symmetric "one 2:1 per resource" set intact while spacing slots ~3.8 boundary
edges apart (Classic: ~3.3); 2:1 access stays a contested premium rather than a
commodity in the larger economy. **These are v1 balance values, tunable against
5–6p telemetry in M3** — the *lengths* (37 / 36 / 11) are the load-bearing part
the worker must size arrays to; the exact mix within them can be re-tuned without
a schema change.

### Decision 3 — One profile, shared by 5 and 6 players, as its own registry preset

**One** expanded board serves **both** 5p and 6p (Catan precedent; and per-count
match length is already differentiated by `adaptiveDuration` via `playerCount`,
so the same board yields appropriately-sized games at each count). It ships as a
**single new registry preset**, `id: 'expanded'` — Classic rules on the big
board:

```
EXPANDED_PROFILE = { ...CLASSIC_PROFILE, id: 'expanded', name: 'Expanded', board: EXPANDED_BOARD }
```

where `EXPANDED_BOARD` is the `BoardProfile` of Decision 2 **plus `radius: 3`**
(see Decision 5). It inherits every Classic gameplay value (dice randomness,
catch-up off, supply, victory) unchanged — **the board is the only divergence**,
which is exactly the "config not code branch" invariant (Law 2): no `if
(players > 4)` appears anywhere in `reduce`/`validate`/`verify`.

**Why a preset, not a per-preset board-variant applied at lobby-time (Option 3):**
the engine resolves the board via `loadRuleProfile(state.profileId).board`, and
`GameState` carries **only** `profileId`. A board-variant that is *not* a
registered profile has no `profileId` to travel on — that is precisely the
open **adaptive-profile-override delivery seam**. Registering one frozen
`expanded` preset sidesteps the unsolved seam entirely: `loadRuleProfile('expanded')`
returns a profile whose `.board.radius` is 3, and the existing resolution path
just works. Playing *Balanced* or *Blitz* rules on the expanded board is a future
composition that the override seam (S2.5.4 / ADR-0012 `matches.profile`) unlocks —
**not** S2.1.7. Shipping one preset keeps this story minimal and defers the seam.

### Decision 4 — Per-player supply and VP threshold: **unchanged**

- **Supply stays 15 roads / 5 settlements / 4 cities per player.** These are
  *per-player* expansion ceilings, not board-contention knobs; board size does not
  change an individual's build economics. The totals fit the bigger board (6 × 15
  = 90 roads ≤ 132 edges; 6 × 5 = 30 settlements ≈ 94% of the ~32-settlement
  vertex capacity — a *feature*, it keeps the endgame tight). Changing supply would
  also shift the VP math (settlements/cities are VP) and desync the win threshold.
- **Base `vpToWin` stays 10.** The adaptive-duration calculator is the *only*
  length lever, and it already lowers `vpToWin` for 5–6p to fit the 60-min ceiling
  (`adaptiveDuration.ts`). Baking a board-specific VP into the preset would fight
  that single-lever design. **Caveat (a known dependency, not solved here):** for
  the adaptively-lowered `vpToWin` to reach the *live* match, the
  adaptive-profile-override seam must deliver it — until it does, the `expanded`
  preset plays at its literal `vpToWin: 10`, and the lobby shows the adaptive
  recommendation as advisory. Solving that delivery is the seam's job (ADR-0012
  `matches.profile` is its durable home), not S2.1.7's.

### Decision 5 — The code changes + the verify board-leg discharge

Three changes, all config-driven, Classic byte-frozen:

1. **Parameterise geometry.** `buildTopology(radius = 2, portSlotCount = 9)` —
   defaults preserve every existing no-arg call (all tests, all Classic paths) at
   radius 2 byte-for-byte. Add `radius` to `BoardProfile` (`ruleProfile.ts:25`);
   Classic's board gets `radius: 2` (additive, no golden change — `radius` is not
   in the `board.generated` *event*, only in the profile). **`portSlotCount` is
   derived from `board.ports.length`, never a second source** — they are zipped in
   `generateBoard`, so one number governs both. Runtime callers pass
   `buildTopology(board.radius, board.ports.length)`.

2. **Turn the topology singleton into a per-radius memo.** This is the real
   scope. `validate.ts:133`'s module-level `cachedTopology ??= buildTopology()`
   assumes one board for the whole process; replace it with a small
   `topologyForRadius(radius)` memo (a `Map<number, BoardTopology>`, pure, no
   wall-clock) and resolve the radius from `loadRuleProfile(state.profileId).board`.
   The same applies to every runtime module-scope `buildTopology()` that must
   follow the active match: **server** `GameRoom.ts:743`, **client**
   `GameTable.tsx:17` / `devFixture.ts` (the client already knows `profileId` from
   `match.started`), and the **bots** (`features.ts:31`, `v0.ts:32`,
   `harness.ts:91`) if bot-fill on expanded matches is in scope for S2.1.7 (see
   Consequences — flag, may be a follow-up). Pure `buildTopology()` calls inside
   *tests* that only exercise Classic may stay as-is (default radius 2).

3. **Fix `verify.ts` to resolve topology AND board from the profile — the
   board-leg discharge.** `verify.ts:187-221` currently does `topology ??=
   buildTopology(); generateBoard(seed, topology)` — hardcoded Classic topology,
   and it never passes the profile's `board` (it rides `generateBoard`'s Classic
   default). Change it to
   `const { board } = loadRuleProfile(state.profileId ?? 'classic');
   const topology = topologyForRadius(board.radius);
   const layout = generateBoard(seed, topology, board);`
   Now the fairness recompute reproduces the *correct* board for **any** profile,
   not just Classic — this is what discharges the verify board-leg carry-forward
   (S2.1.6's twoPlayer used the standard board and left it open; the expanded
   board is the first divergence that forces and proves the fix).

**Classic stays byte-frozen:** `buildTopology(2, 9) === buildTopology()`;
`generateBoard` unchanged; the `board.generated` event shape is unchanged (no
`radius` field on it); `board.test.ts`'s 19/54/72 asserts still hold at radius 2.
Test work: parameterise `board.test.ts` to *also* assert 37/96/132 at radius 3;
add an expanded-board golden fixture + an expanded `verify` round-trip test; add a
`validateRuleProfile` **G4** guard (see Invariant 6) so a mis-sized expanded array
fails loudly at import, in the style of the existing G1–G3 checks.

## Consequences

- **Easier:** 5–6 player play lands as pure config — one preset, one `radius`
  scalar, zero rule branches; the verify board-leg is discharged, so fairness
  audit is correct for every profile going forward; adaptive-duration already
  covers 5–6p match length; endgame contention is tuned by existing piece math and
  the existing `neutralSettlements` lever, so no new balance machinery is needed.
- **Harder / debt accepted:** the **topology singleton becomes per-match** — every
  module-scope `buildTopology()` cache (validate, server, client, bots) must route
  through a per-radius memo keyed off the active `profileId`. This is a wider touch
  than "add a profile," and any missed call site silently renders/validates the
  *wrong* board for an expanded match (a fail-quiet shape — mitigate by grepping
  all `buildTopology(` sites, listed in the recon, and by the expanded golden +
  verify tests). **Bots on the expanded board** (`features.ts`/`v0.ts` build a
  Classic `TOPO` at module load) will misplay unless converted — decide whether
  bot-fill for 5–6p is in S2.1.7 or a follow-up. **Server seats:**
  `GameRoom.ts:58 DEFAULT_MAX_SEATS = 4` and the lobby must admit `maxSeats` 5–6
  and select the `expanded` profile at those counts (a server/lobby change, not
  core). The **adaptively-lowered `vpToWin` cannot reach a live match** until the
  override seam is solved (Decision 4 caveat).
- **Per-story guidance (S2.1.7):** (a) add `radius` to `BoardProfile` + `EXPANDED_BOARD`
  + `EXPANDED_PROFILE` in `ruleProfile.ts`, register it; (b) parameterise
  `buildTopology`; (c) introduce `topologyForRadius` and route validate + verify +
  server + client through it; (d) fix `verify.ts` to resolve board+topology from
  the profile; (e) `validateRuleProfile` G4 guard; (f) tests: radius-3 topology
  asserts, expanded golden, expanded verify round-trip; (g) server: raise
  `maxSeats` to 6 and route ≥5 seats to `expanded`. Classic golden/determinism/
  replay/verify suites must stay green untouched (the parity proof).

## Invariants created

Copy verbatim into `docs/wiki/` (extend `board.md` / the board-generation notes):

1. **The expanded board is config, never a code branch.** Board size flows from
   `RuleProfile.board.radius`; no `if (playerCount > 4)` (or equivalent) ever
   appears in `reduce`/`validate`/`verify`. 5–6p is one registered profile
   (`expanded`), Classic rules on a radius-3 board.
2. **Topology is a pure function of `(radius, ports.length)` and is resolved
   per-match from the active profile.** `buildTopology(radius, portSlotCount)` is
   pure; runtime code obtains its topology via `topologyForRadius(loadRuleProfile(
   state.profileId).board.radius)`, never a process-global Classic singleton.
   `portSlotCount` is always `board.ports.length` — one source of truth.
3. **`verify` recomputes `board.generated` from `loadRuleProfile(state.profileId).board`
   — both geometry (radius) and contents — never a hardcoded Classic topology.**
   (Permanent: this is the board-leg fairness discharge.)
4. **Classic (radius 2 → 19/54/72, 9 ports, 18 tokens) is byte-frozen.** Adding
   `radius: 2` to its board is additive; `radius` is a *profile* field, never a
   field of the `board.generated` event, so golden bytes are unchanged.
5. **One expanded board profile serves both 5 and 6 players;** per-count
   differences are handled by `adaptiveDuration` (via `playerCount`), not by
   per-count boards. Per-player supply (15/5/4) and base `vpToWin` (10) are
   independent of board size.
6. **An expanded `BoardProfile` must be internally consistent, checked loudly at
   import (`validateRuleProfile` G4):** `tileMix.length === 3·r² + 3·r + 1` (the
   tile count for `radius r`), `tokens.length ===` non-desert tile count
   (`tileMix.length` minus the desert count), and `ports.length === ` the port
   slots the topology carves. A malformed board fails at module load, never at
   turn 200 of a live match.

## Revisit when

- 5–6p playtests find radius-3 **too sparse / low-interaction** → first reach for
  the `neutralSettlements` lever (no topology change); only if that is
  insufficient reconsider Option 2's custom board.
- The **adaptive-profile-override seam is solved** (S2.5.4 / ADR-0012
  `matches.profile`) → the `expanded` board becomes composable atop *any* preset
  (Balanced/Blitz on the big board) and the adaptively-lowered `vpToWin` reaches
  the live match — retire the single-preset interim of Decision 3.
- **Bot quality on the expanded board** proves poor (heuristic weights tuned for
  19 tiles) → re-tune bot evaluation for radius-3, or gate bot-fill to ≤4p.
- A board neither radius-2 nor radius-3 is wanted (e.g. a 7–10p mode, M3) → the
  radius parameter already supports it; re-confirm the token/port density formulae
  scale before shipping that size.
- Real M3 match-length telemetry contradicts the v1 tile/token/port mix → re-tune
  the *contents* (mix within the fixed 37/36/11 array lengths) without a schema
  change.
