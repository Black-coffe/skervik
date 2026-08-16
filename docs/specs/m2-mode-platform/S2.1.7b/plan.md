# S2.1.7b — 5–6 player expanded board: CONSUMERS (plan)

**Epic:** E2.1 (rule profiles engine) · **Tier:** T3 · **Spec slug:** `S2.1.7b`
**Governed by:** ADR-0013 (accepted) · ADR-0008 (trilingual) · ADR-0003 (pure zero-dep core) ·
DESIGN.md §2.2 (flotilla palette) · `docs/wiki/board.md`
**Depends on:** S2.1.7a ✅ merged (`cac69af`) — `buildTopology(radius, portSlotCount)`,
`topologyForRadius` memo (`board.ts:287`, memo at `:283`), `EXPANDED_PROFILE` (radius 3, 37/36/11),
verify board-leg discharged.

## Goal

Make the radius-3 `expanded` board **reachable in production for 5–6 players**. S2.1.7a built the
board; nothing outside `packages/core` can reach it — the server hardcodes 4 seats and a no-arg
`buildTopology()`, the client builds five module-level radius-2 topologies and has only 4 flotilla
identities, the bots evaluate a radius-2 board at module load, and `expanded` is absent from
`SHIPPING_PROFILE_IDS`. After this pack: a player picks **Grand Chart / Большая лоция / Велика
лоція** in the lobby, gets a 5–6 seat room on the 37-tile board, humans and bots play it, the client
renders and auto-fits it, and the fairness recompute verifies it — all proven by 5–6p e2e.

Also folded in (all live, all small):
- **S2.1.7a follow-up 1** — the tautological G4 ports clause (`ruleProfile.ts:354-359`).
- **S2.1.7a follow-up 2** — `boardgen.test.ts` 26-vs-64 comment nit.
- **S2.7.2 board auto-fit zoom** (OPEN, owner-accepted) — its own spec says auto-fit is what makes
  the 37-tile board fit at all, so it is a dependency of this build, not a parallel polish item.
- **`harness.ts:91` bug** — `generateBoard(seed, buildTopology(), profile.board)` feeds a radius-2
  topology to a radius-3 board profile. Today unreachable (nothing selects `expanded`); the moment
  this pack lands it becomes a live corruption path, so it is fixed in wave 1.

*(S2.1.7a follow-up 3 — `topologyForRadius` memo — is ALREADY implemented and is not planned here.)*

## Assumptions needing confirmation

1. **Client stores `profileId` from `match.started`.** `MatchStartedEvent` carries it
   (`protocol/src/messages.ts:312`) and the lobby chose it, but no scout confirmed a store field.
   Story 03 must locate it in `hud/store.ts`; if absent, story 03 adds it (its `## Files` already
   covers the store). **Recon question if the worker cannot find it:** *which client store field
   holds the active match's `profileId` after `match.started`?*
2. **Two new flotilla identities are an OWNER decision, not a worker's.** DESIGN.md §2.2 lists
   exactly four *owner-locked* identities from the lore primer; seats 5–6 currently reuse seat 0/1
   colors silently (`flotillaColors.ts:19-24`, `% 4`). Story 05 carries a concrete planner proposal
   (below) so it is executable, but the owner may override the names/colors/emblems. **This is the
   one item that genuinely wants a human before wave 2 dispatches.**
3. **No test snapshots the whole `RuleProfile` object.** Decision 1 adds fields to every preset
   literal; if a registry snapshot test exists, story 01 updates it deliberately (see tradeoff).
4. **`matchMetadata` / ADR-0012 `matches.profile` persistence is additive-safe.** If the server
   persists the full profile object as JSON, it gains two integer fields. Additive, but story 04
   must confirm no pg schema/contract test pins the object shape.
5. **`neutral.ts` radius-2 assumption stays unexercised.** `neutral.ts:65/94` place neutral
   settlements against a default radius-2 topology and their comments say other sizes need a future
   forced-placement story. `EXPANDED_PROFILE = {...CLASSIC_PROFILE}` and Classic has no neutral
   settlements, so the path is not reached — story 01 **locks that with a guard** (G6) rather than
   leaving it to luck.

## Decisions

### D1 — Seat count lives on the core `RuleProfile` (`minSeats` / `maxSeats`)

**Taken:** add `readonly minSeats: number` and `readonly maxSeats: number` to `RuleProfile`
(not to `BoardProfile` — seats are a match property; `twoPlayer` is 2/2 on a radius-2 board).
Values: classic/balanced/blitz `2..4`, twoPlayer `2..2`, expanded `5..6`.

**Rejected:** a server-side `profileId → seats` map. It reads cheaper (no core change, no preset
literal touched) but produces **two sources of truth**, and the client needs the same number —
`lobbyStore.MAX_LOBBY_BOTS` must become preset-aware, and the client imports core directly today
(`LobbyScreen.tsx:10` consumes `SHIPPING_PROFILE_IDS`). A server-only map means the client either
duplicates it or guesses, which is exactly the drift shape this repo keeps paying for.

**Byte-freeze tradeoff — stated explicitly, as required.** Adding these fields *changes the
`CLASSIC_PROFILE` object literal.* The constraint we are honoring is "golden fixtures and the
classic event stream must not change byte-wise": `minSeats`/`maxSeats` are **profile** fields, never
fields of any event payload, so `board.generated` and the whole classic event stream are unchanged —
byte-identical goldens, byte-identical replay. This is the **same precedent S2.1.7a set with
`radius: 2`** and the same reasoning ADR-0013 Invariant 4 recorded. What we *are* spending: the
"no preset literal changed" convention now formally covers rule flags only, not additive seat
metadata. If a test snapshots a whole profile object, that snapshot changes and the change is
visible in lead-review (assumption 3). Accepted; the alternative buys a frozen literal at the cost
of a permanently split seat definition.

### D2 — Per-match topology seam, one per package

Everything routes through core's already-memoized `topologyForRadius(radius, portSlotCount)` with
`portSlotCount = board.ports.length` (ADR-0013 Invariant 2 — one source of truth). The seam differs
per package because the profile arrives differently:

- **server** — `GameRoom` already holds `#profileId` (`GameRoom.ts:485`). Resolve at `:743`:
  `const { board } = loadRuleProfile(this.#profileId)` → `topologyForRadius(board.radius,
  board.ports.length)`. One call site. Note the ordering bug this creates: `maxClients` is assigned
  at `:474` *before* `#profileId` at `:485`, and D1 makes seats profile-derived — the worker must
  resolve `profileId` first.
- **client** — one new module `board/matchTopology.ts` exporting `topologyForProfile(profileId)`
  (thin wrapper: `loadRuleProfile` → `topologyForRadius`), plus a `useMatchTopology()` hook reading
  the active `profileId` from the HUD store. The five module-level `buildTopology()` constants
  (`GameTable.tsx:19`, `useBuildPlacement.ts:22`, `useRobberPlacement.ts:22`,
  `useSetupPlacement.ts:20`, `useVenturePlacement.ts:33`) become hook calls; `devFixture.ts:30`
  takes an explicit `profileId` parameter defaulting to `'classic'`.
- **bots** — no module-level `TOPO`. `v0.ts:31` and `features.ts:31` already receive `state`, so
  they resolve `loadRuleProfile(state.profileId ?? 'classic')` per call; the core memo makes this
  free. Same for `BANK_PER_RESOURCE = 19` (`v0.ts:249`) — derive from the profile, the pattern
  `features.ts:162` already uses.

**Rejected:** passing a `BoardTopology` down as a prop/argument through every client component and
bot function. Fewer imports, but it widens ~15 signatures and the memo already makes lookup cheap.

### D3 — Lobby routes to seats via the PRESET, not via a seat-count field

`JoinLobbySelectionSchema` (`messages.ts:706`) carries no seat count, and
`joinOptionsSecurity.e2e.test.ts:80` asserts a wire-supplied `maxSeats` is **rejected** — seats are
server-owned. So "lobby routes ≥5 to expanded" is implemented in the only direction the wire
supports: **choosing `expanded` IS choosing a 5–6 seat room** (the preset copy already says "5–6
captains / 5–6 капитанов / 5–6 капітанів"). Seats then flow profile → room, never client → room.
Matchmaking needs no change: `.filterBy(['profileId'])` (`index.ts:79`, `boot.ts:242`) already keeps
expanded players in their own queue.

**Rejected:** adding `seatCount` to `JoinLobbySelectionSchema` and mapping ≥5 → `expanded`
server-side. It is a new wire field, it creates a second way to express the same choice (what does
`{profileId:'classic', seatCount:6}` mean?), and it weakens the "wire cannot set seats" invariant
that has a dedicated e2e test guarding it.

### D4 — S2.7.2 auto-fit is its own story in a LATER wave, blocked_by the client topology story

Not a wave-mate. Two independent reasons: (a) **file collision** — both want
`board/GameTable.tsx`, and the wave rule forbids shared paths; (b) **real data dependency** — the
S2.7.2 spec requires the fit math be built "off the actual field extent (from topology/descriptors),
not a hardcoded radius-2 size", and that per-match extent only exists after story 03 lands the
topology seam. Sequencing satisfies both; merging them would produce one oversized story mixing a
mechanical 6-call-site migration with new fit geometry.

### D5 — E2e is ONE story, two files

`5–6p e2e (single + multi + verify)` stays one `worker-test` story with two new files: a boot-free
pinned-seed expanded match (template: `e2e/twoPlayerMatch.e2e.test.ts`) and a socket-based
multi-client one (template: `e2e/fullMatch.e2e.test.ts`, `N_SEATS=3` at `:59`). Splitting them
duplicates identical setup knowledge across two workers for no isolation gain; both are test-only,
so they cannot collide with production code, and `verify` is one extra assertion inside the boot-free
file rather than a third story.

### D6 — Two new flotilla identities (planner proposal, owner may override)

Seats 5–6 need identity, not a `% 6`: DESIGN.md §2.2 requires color + emblem + trilingual name, and
CLAUDE.md requires every new user-facing term authored in 3 languages at creation. Existing hues:
255 / achromatic / 45 / 190. Proposed additions, chosen for hue **and** lightness separability:

| Flotilla | Token | OKLCH | sRGB | Emblem |
|---|---|---|---|---|
| Мурена / Moray / Мурена | `--fl-moray` | `oklch(0.62 0.13 145)` | `#4f9257` | moray silhouette |
| Манта / Manta / Манта | `--fl-manta` | `oklch(0.55 0.14 330)` | `#a1548f` | manta ray silhouette |

Moray (145, L 0.62) vs narwhal (190, L 0.78) are separated by lightness for deutan/protan reads;
manta (330) occupies an unused hue region. Story 05 ships these values verbatim so no worker
invents identities; the owner can swap names/colors in review without changing any code shape.

### Tier justification — T3

Determinism-bearing: story 01 edits `packages/core` (profile registry + import-time guards) and
story 04 changes how the authoritative room resolves its board topology — a missed call site
renders or validates the *wrong board* fail-quietly (ADR-0013 Consequences names this exact risk).
Owner directive: engine/determinism-bearing code only via workers, **mandatory lead-review at the
end**. Per-story tiers are lower where the work is genuinely mechanical (client/bots migrations, T2).

## Stories by wave

Full-repo green is expected **after wave 2**, not after wave 1: story 01 widens
`SHIPPING_PROFILE_IDS` to include `expanded` (extracted into the earliest story because two wave-2
stories would otherwise both need to edit `ruleProfile.ts`), which can turn a client lobby test that
counts preset options red until story 05 lands. This is a deliberate, bounded cross-wave transient.

**Wave 1** (3 concurrent, disjoint packages)
- `S2.1.7b-01-core-seats-and-guards` — `minSeats`/`maxSeats` on every profile, `expanded` into
  `SHIPPING_PROFILE_IDS`, G4 ports clause bound to an independent boundary-edge formula, G5 seat
  guard, G6 neutral-settlements-imply-radius-2 lock, boardgen.test 26-vs-64 comment nit. *(core)*
- `S2.1.7b-02-bots-per-radius-topology` — **tracer**: kill the module-level `TOPO`, profile-derive
  the bank, fix `harness.ts:91`, and simulate a full 6-player expanded match to a winner. *(bots)*
- `S2.1.7b-03-client-per-match-topology` — `matchTopology.ts` seam + `useMatchTopology()`; migrate
  the 5 module-level topologies and `devFixture`. *(client board/hud/dev)*

**Wave 2** (2 concurrent, disjoint packages)
- `S2.1.7b-04-server-seats-and-topology` — protocol accepts `expanded` + bot cap 5; `GameRoom`
  takes `maxClients` from the profile and builds its topology from it. *(protocol + server)*
- `S2.1.7b-05-client-lobby-six-flotillas` — preset-aware bot cap, two new flotilla identities in 3
  locales + DESIGN.md + lore primer. *(client lobby/theme/i18n + docs)*

**Wave 3** (2 concurrent, disjoint)
- `S2.1.7b-06-board-auto-fit-zoom` — S2.7.2: fit the field extent to the available chart box,
  retire `TRADE_DOCK_OFFSET_PX`. *(client board scene)*
- `S2.1.7b-07-expanded-e2e` — boot-free 5–6p + socket multi-client + verify recompute. *(server e2e)*

**Integration gate (Queen / lead-review, after wave 3):**
`pnpm -s typecheck && pnpm -s -r lint && pnpm -s -r test && pnpm -s -r build && node scripts/check-core-no-runtime-deps.mjs`
plus `bash scripts/wave-check.sh docs/specs/m2-mode-platform/S2.1.7b` before each dispatch.

## Descoped

*(empty)*

## Plan deltas

*(empty)*

**Approved:** owner, 2026-08-16 — plan + D6 flotilla proposal (Moray + Manta) accepted verbatim.
