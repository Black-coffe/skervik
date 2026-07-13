# Board topology & generation — invariants

Source of truth: `docs/adr/0013-five-six-player-board.md` (5–6 player expanded board) + the
board-generation contract (S1.1.1/S1.1.2). Binding for any code that builds or verifies a board.

1. **The board is config, never a code branch.** Board size flows from `RuleProfile.board.radius`;
   no `if (playerCount > 4)` (or equivalent) ever appears in `reduce`/`validate`/`verify`. 5–6p is
   one registered profile (`expanded`) — Classic rules on a radius-3 board.

2. **Topology is a pure function of `(radius, ports.length)`, resolved per-match from the active
   profile.** `buildTopology(radius, portSlotCount)` is pure; runtime code obtains its topology via
   `topologyForRadius(loadRuleProfile(state.profileId).board.radius)`, never a process-global Classic
   singleton. `portSlotCount` is always `board.ports.length` — one source of truth.

3. **`verify` recomputes `board.generated` from `loadRuleProfile(state.profileId).board`** — both
   geometry (radius) and contents — never a hardcoded Classic topology. (Permanent: this is the
   verify board-leg fairness discharge — closes [[verify-profile-blindness-carryforward]].)

4. **Classic (radius 2 → 19 tiles / 54 vertices / 72 edges, 9 ports, 18 tokens) is byte-frozen.**
   Adding `radius: 2` to its board is additive; `radius` is a *profile* field, never a field of the
   `board.generated` event, so golden bytes are unchanged.

5. **One expanded board profile serves both 5 and 6 players;** per-count differences are handled by
   `adaptiveDuration` (via `playerCount`), not per-count boards. Per-player supply (15/5/4) and base
   `vpToWin` (10) are independent of board size.

6. **An expanded `BoardProfile` must be internally consistent, checked loudly at import
   (`validateRuleProfile` G4):** `tileMix.length === 3·r² + 3·r + 1` (tile count for radius `r`);
   `tokens.length ===` non-desert tile count; `ports.length ===` the topology's port slots. A
   malformed board fails at module load, never at turn 200 of a live match.

## Geometry reference

| Radius | Tiles | Vertices | Edges | Boundary edges | Ports | Tokens | Used by |
|---|---|---|---|---|---|---|---|
| 2 (Classic) | 19 | 54 | 72 | 30 | 9 | 18 | classic / balanced / blitz / twoPlayer |
| 3 (Expanded) | 37 | 96 | 132 | 42 | 11 | 36 | `expanded` (5–6 players) |

Formulae: `tiles(r) = 3r² + 3r + 1`; boundary edges `= 6(2r+1)` for the outer ring.

Expanded `tileMix` (v1, M3-tunable within the fixed length 37): timber×8, clay×6, fleece×8,
barley×8, iron×6, desert×1. Tokens (36): `2×2, 3×4, 4×4, 5×4, 6×4, 8×4, 9×4, 10×4, 11×4, 12×2`
(no 7; 8 red 6/8). Ports (11): generic 3:1 ×6 + one 2:1 per resource.

## Delivery split (S2.1.7)

- **S2.1.7a (core)** — parameterize `buildTopology`; add `radius` to `BoardProfile`; register
  `EXPANDED_BOARD`/`EXPANDED_PROFILE`; `topologyForRadius` memo (replace the `validate.ts` singleton);
  verify board-leg fix; G4 guard; core tests (radius-3 asserts + expanded golden + expanded verify
  round-trip). Classic byte-frozen. No consumer wiring yet (server/client/bots still call no-arg
  `buildTopology()` = radius 2 = correct for Classic; `expanded` unreachable in prod until S2.1.7b).
- **S2.1.7b (consumers)** — route server (`GameRoom`), client (`GameTable`), bots
  (`features.ts`/`v0.ts`/`harness.ts`) through `topologyForRadius` keyed off the active `profileId`;
  server `maxSeats` up to 6 + lobby routes ≥5 seats to `expanded`; cross-process 5–6p e2e (single-player
  with bots + verify). **Every `buildTopology(` call site must route through the memo — a missed one
  silently renders/validates the WRONG board (fail-quiet); the expanded golden + verify tests guard it.**
