# DESIGN.md — Skervik UI/UX constitution

> Binding visual & interaction rules for all Skervik UI work (client code,
> mockups, art briefs, UI specs). Strategic context: [PRODUCT.md](PRODUCT.md).
> Lore & naming source: `docs/wiki/lore-primer.md`. Authored 2026-07-03
> (owner-commissioned design pass); E1.6 stories MUST cite this file.
> Reference mockup: `docs/design/mockups/game-table.html`.

**Mood formula** (test every visual decision against it):
_"Chart-room at dusk, ≈1900: kerosene light over the navigation chart —
gray water, wet granite, brass instruments."_ Not steampunk costume, not
viking kitsch, not cartoon pastel, not grimdark, not SaaS chrome.

## 1. Two-surface model

The game screen is two layers with different registers:

- **The Chart (Лоция)** — the Pixi canvas: board, pieces, sea, mist, storm.
  This is the _brand_ surface: painterly, atmospheric, the light source of
  the screen. All drama lives here.
- **The Instruments** — every DOM/React surface around and above the canvas
  (HUD, trade panel, lobby, dialogs, dashboards). _Product_ register:
  calm, exact, dense where useful, zero decoration that doesn't convey state.

Rule of thumb: atmosphere on the canvas, information in the instruments.
Never decorate instruments with canvas drama (no fog overlays on buttons);
never encode game-critical information only in canvas atmosphere.

## 2. Color tokens

Dark, environmental theme is the **native and only M1 theme** (scene: evening
match, the board must glow; ALT-2 "environmental" surface is justified — the
surface IS the world's sea). A light theme is a possible M4 exploration, not
an M1 concern. CSS uses OKLCH; the canvas layer uses the frozen sRGB hex
equivalents below (Pixi needs numeric colors — keep the two columns in sync,
they are generated, not hand-picked; see `docs/design/` notes).

### 2.1 Environment & instruments

| Token               | OKLCH                   | sRGB (canvas) | Role                                                                       |
| ------------------- | ----------------------- | ------------- | -------------------------------------------------------------------------- |
| `--bg-abyss`        | `oklch(0.15 0.02 235)`  | `#040c12`     | page & sea background                                                      |
| `--surface`         | `oklch(0.20 0.02 235)`  | `#0d181e`     | HUD panels, cards                                                          |
| `--surface-2`       | `oklch(0.24 0.02 230)`  | `#152127`     | rails, toolbars, hover                                                     |
| `--line`            | `oklch(0.32 0.02 235)`  | `#29353c`     | 1px borders, dividers                                                      |
| `--ink`             | `oklch(0.93 0.005 235)` | `#e5e8eb`     | primary text (16:1 on abyss)                                               |
| `--muted`           | `oklch(0.70 0.015 235)` | `#96a0a7`     | secondary text (≥6.7:1)                                                    |
| `--primary`         | `oklch(0.80 0.14 75)`   | `#f2af48`     | "kerosene" — primary actions, active turn, selection                       |
| `--on-primary`      | `oklch(0.18 0.02 235)`  | `#091319`     | text on primary fills (9.8:1)                                              |
| `--accent`          | `oklch(0.72 0.09 200)`  | `#56b6bb`     | "sea-glass" — links, info, focus ring                                      |
| `--danger`          | `oklch(0.62 0.19 25)`   | `#e24947`     | storm, destructive actions, timer critical                                 |
| `--success`         | `oklch(0.70 0.12 150)`  | `#63b376`     | confirmations, "deal sealed"                                               |
| `--chart-paper`     | `oklch(0.88 0.03 85)`   | `#e1d6c2`     | aged chart paper — number tokens, board labels ONLY (never a DOM panel bg) |
| `--chart-paper-ink` | `oklch(0.30 0.03 60)`   | `#392a1e`     | ink on chart paper (9.6:1)                                                 |
| `--hot-number`      | `oklch(0.55 0.18 25)`   | `#c53637`     | 6/8 tide marks                                                             |

Usage discipline: **Restrained** on instruments — kerosene amber ≤10% of any
instrument surface, reserved for the current-turn indicator, the primary
action, and the active selection. If everything is amber, nothing is.

### 2.2 Flotilla (player) colors — data palette

Owner-locked identities (lore-primer). Color NEVER appears without the
flotilla emblem glyph (a11y invariant: symbol + color).

| Flotilla             | Token          | OKLCH                  | sRGB      | Emblem                    |
| -------------------- | -------------- | ---------------------- | --------- | ------------------------- |
| Буревестник / Petrel | `--fl-petrel`  | `oklch(0.60 0.13 255)` | `#4682cc` | petrel silhouette         |
| Косатка / Orca       | `--fl-orca`    | `oklch(0.95 0 0)`      | `#eeeeee` | orca fin (black on white) |
| Морж / Walrus        | `--fl-walrus`  | `oklch(0.60 0.14 45)`  | `#c26030` | walrus tusks              |
| Нарвал / Narwhal     | `--fl-narwhal` | `oklch(0.78 0.10 190)` | `#60ccc5` | narwhal horn              |
| Мурена / Moray       | `--fl-moray`   | `oklch(0.62 0.13 145)` | `#4f9257` | moray silhouette          |
| Манта / Manta        | `--fl-manta`   | `oklch(0.55 0.14 330)` | `#a1548f` | manta ray silhouette      |

Seats 5-6 of the `expanded` (Grand Chart) 5-6 player board (S2.1.7b-05).

Separability: petrel vs narwhal differ in lightness (0.60 vs 0.78), not just
hue — verified for deutan/protan reads. Moray (hue 145, L 0.62) vs narwhal
(hue 190, L 0.78) are likewise separated by lightness, not hue alone — the
two closest hues on the wheel. Manta (hue 330) occupies its own unused hue
region. Orca is achromatic. On the canvas, pieces additionally differ by
flag shape per flotilla when budget allows.

### 2.3 Resource colors — data palette

Resources are NEVER hue-only: each has a unique icon silhouette AND the tile
pattern (proto's stroke-pattern approach is correct — keep it).

| Resource                | Token          | OKLCH                  | sRGB      |
| ----------------------- | -------------- | ---------------------- | --------- |
| Лес / Timber            | `--res-timber` | `oklch(0.55 0.10 150)` | `#428252` |
| Глина / Clay            | `--res-clay`   | `oklch(0.58 0.11 40)`  | `#b16246` |
| Руно / Fleece           | `--res-fleece` | `oklch(0.86 0.02 90)`  | `#d6d1c3` |
| Ячмень / Barley         | `--res-barley` | `oklch(0.74 0.11 95)`  | `#c0aa54` |
| Железо / Iron           | `--res-iron`   | `oklch(0.58 0.02 255)` | `#737b86` |
| Мглистая банка / Desert | `--res-desert` | `oklch(0.66 0.03 70)`  | `#9e8f7f` |

Desert (the misty sandbank) produces nothing, but its board tile still needs a
fill — a **barren grey-dun**, deliberately ~0.20 darker in lightness than
`--res-fleece`/`--chart-paper` so a desert tile never reads as a pale-cream
resource or as a chart-paper number disc. Added 2026-07-05 (owner-approved S1.6.1
follow-up nit); the OKLCH↔sRGB pair is generated (Ottosson OKLab transform), not
hand-picked, per this section's discipline. Robber starts here (S1.1.2).

### 2.4 Hard bans (color)

- No gradients on instrument fills (buttons, panels, pills). Flat fills +
  1px `--line` borders. Gradients belong to the canvas sky/sea only.
- No `--chart-paper` as a DOM panel background — parchment panels are the
  №1 "Catan-like" trade-dress risk and the cream-bg AI cliché at once.
- No gradient text, no glassmorphism, no colored side-stripe borders.
- No pure black `#000` and no pure white `#fff` text (use tokens).

## 3. Typography

All three faces are OFL, self-hosted (AGPL project — no CDN calls), and MUST
cover RU + UA (ґ є і ї) + EN. Never render UI text into canvas textures —
text lives in DOM for i18n/scaling/screen readers (canvas exception: tide
marks / numbers on board tokens, which are locale-independent digits).

| Face         | Family                                 | Role                                                                                                                                                  |
| ------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument   | **Inter** (fallback `system-ui`)       | all UI: labels, buttons, body, tables. `font-feature-settings: "tnum"` on every numeric cell/timer.                                                   |
| Chart & lore | **PT Serif** (fallback Georgia)        | match title, island names, lore flavor lines, end-of-match "Большой атлас" screens. Period-correct ≈1900 print flavor. Never for buttons/labels/data. |
| Ledger       | **JetBrains Mono** (fallback Consolas) | seed hash, event log entries, replay timestamps — the "telegraph/ledger" voice of fairness surfaces.                                                  |

Scale: fixed rem, ratio 1.2 — `12 / 14 (base) / 17 / 20 / 24 / 29px`.
Weights: 400/500/600 only. Line-height 1.5 body, 1.2 headings.
No fluid clamp() type on instruments. Display ceiling 29px in-game
(the board is the hero, not the headings).

## 4. Space, shape, depth

- **Spacing scale:** 4px base — `4 / 8 / 12 / 16 / 24 / 32 / 48`.
- **Radius:** `4px` controls, `8px` panels/cards, `999px` pills (resource
  counts, timers). Nothing else.
- **Borders:** 1px `--line` everywhere; elevation via background step
  (`--surface` → `--surface-2`), not shadows. One shadow allowed: floating
  layers (trade panel, dialogs, toasts) get `0 8px 24px oklch(0 0 0 / 0.5)`.
- **Z-scale (semantic, no arbitrary values):** `--z-board 0`, `--z-hud 10`,
  `--z-trade 20`, `--z-dialog 30`, `--z-toast 40`, `--z-tooltip 50`.
- **Hit targets:** ≥44×44px for anything clickable during play; ≥8px gaps
  between adjacent destructive/constructive actions.

## 5. Iconography

Line icons, 1.5–2px stroke, rounded caps, drawn on a 24px grid — "engraved
instrument" style, consistent across the whole surface. Resources and
flotillas get filled silhouette glyphs (they must read at 14px). No emoji as
UI icons (emoji allowed only inside chat/reactions content). No off-the-shelf
icon pack mixing: pick one set (recommend Lucide as base — OFL-compatible,
stroke-consistent) and extend with custom nautical glyphs in the same grammar.

## 6. Game screen layout (Экран партии)

Desktop ≥1280px zoning (mockup: `docs/design/mockups/game-table.html`):

```
┌────────────────────────────────────────────────────────────┐
│ top bar: match id · Честный жребий chip · phase · timer    │
├──────────┬──────────────────────────────────┬──────────────┤
│ players  │                                  │ ship's log   │
│ rail     │        THE CHART (canvas)        │ (events,     │
│ (left,   │   board, pieces, mist, storm     │  chat,       │
│  fixed)  │                                  │  trade       │
│          │                                  │  history)    │
├──────────┴──────────────────────────────────┴──────────────┤
│ bottom deck: my hand (resources) · actions · tide-lot die  │
└────────────────────────────────────────────────────────────┘
```

- **Players rail (left):** one card per flotilla — emblem + color chip,
  Renown (public), hand size, ventures count, timer state, connection state.
  Active player's card carries the kerosene edge + emblem glow. NEVER
  reorder cards mid-match (stable layout beats "active first").
- **Ship's log (right):** collapsible; every event one mono line
  (`14:32 · Косатка → Морж: 2 руно ⇄ 1 железо`). Trade history is part of
  the log, filterable. On ≤1024px the log collapses to a drawer.
- **Bottom deck:** my resources as icon+count pills (icon first — colorblind
  read), action buttons in FIXED positions all match long (build, trade,
  venture, end turn). Buttons disable, they never disappear or shift.
- **Top bar:** phase indicator ("Постановка · Прилив · Торговля · Стройка"),
  turn timer (mm:ss, tabular), and the fairness chip (see §8).
- **Mobile (≤768px):** rails become top strip (players) + bottom sheet
  (hand/actions); canvas gets full width; log is a tab. Same components,
  structural collapse — no separate mobile design language.

## 7. Trade UI constitution (the heart — S1.6.4)

Lore anchor: _"слово капитана твёрже якорной цепи"_ — a sealed deal is
logged and irrevocable, so the UI must make sealing deliberate and
error-proof.

1. **Stable geometry.** The offer builder is a fixed panel (not a modal
   chasing the cursor); give/receive columns never swap sides; buttons never
   move between renders. Latency must not reflow controls.
2. **Two-step seal.** Compose → explicit "Скрепить сделку" confirm with a
   150ms disabled-then-armed guard against double-click; the confirm shows
   the full deal in words ("Вы отдаёте 2 руно, получаете 1 железо").
3. **Expressive but bounded:** counter-offer edits the incoming offer
   in-place (pre-filled), quick-reactions (predefined, localized) instead of
   free-text pressure; embargo is an explicit, visible, reversible action.
4. **Everything leaves a trace:** every offer/counter/accept/decline lands
   in the ship's log with timestamps. No verbal-only state.
5. **Anti-misclick:** accept and decline are ≥16px apart, decline is the
   quiet style, accept is primary; offers to me arrive as a docked card in
   the trade zone — NEVER as a screen-blocking modal during my planning.
6. **Server truth:** an offer is "pending seal" until the server event
   returns; the pending state is visibly distinct (pulse on the wax-seal
   icon); optimistic UI may preview but never confirm.

## 8. Fairness & realtime stats (dashboards)

Fairness is a UI feature (PRODUCT.md principle 3). M1 surfaces:

- **Fairness chip (top bar):** wax-seal icon + first 8 chars of `seedHash`
  in Ledger mono. Click → "Честный жребий" panel: full hash, commit
  explanation in plain words (3 locales), and post-match the revealed seed +
  "recompute every roll" link (replay verify).
- **Tide-lot panel (toggleable, docked to the log):**
  - Histogram: rolled counts per 2–12 **overlaid on the expected
    probability curve** — the single most trust-building chart; bars in
    `--accent`, expected curve line in `--muted`, current roll highlighted
    in `--primary`.
  - Per-player income strip: resources gained per flotilla (emblem + count).
  - Roll ticker: last N rolls as dice-pair glyphs.
- **Timers:** turn timer in top bar; per-player micro-timers on rail cards.
  States: normal (`--muted`) → warning at 25% (`--primary`) → critical at
  10% (`--danger` + gentle pulse; the ONLY pulsing element on screen).
- Post-M1 (M3 spectator/analytics) inherits these tokens and chart grammar —
  don't invent a second dashboard language.

Chart grammar (binding for any stats surface): flat fills, no 3D, no
gradients in marks; axes/gridlines in `--line`; labels `--muted` 12px
tabular; one categorical encoding = flotilla colors WITH emblems; empty
states teach ("Жребий ещё не брошен — распределение появится после первого
прилива").

## 9. Motion

- Instruments: 150–250ms, `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint
  family). State changes only: panel open/close, pill count change (number
  ticks up/down), button feedback, toast in/out. No page-load choreography.
- The Chart (canvas): slow ambient allowed and encouraged — mist alpha
  pulse (proto's is right), water shimmer, storm pass on a 7-roll, piece
  placement drop (200ms). Ambient loops must be _slow_ (≥4s period) and
  must pause under `prefers-reduced-motion` (swap to static frame).
- Dice/tide roll: ≤900ms from intent to settled result, skippable by click;
  the result number is readable within the first 300ms (don't gate
  information on theatrics).
- `prefers-reduced-motion: reduce` — every animation (DOM AND canvas) gets
  a crossfade-or-instant alternative. This is a merge gate, not a nicety.

## 10. i18n & a11y merge gates (bind every E1.6 story)

- Zero hardcoded user-facing strings — i18n keys only, all 3 locales in the
  same PR (ADR-0008). Terms come from lore-primer glossary keys.
- Layout budget: UA/RU run ~25–35% longer than EN — test panels at the
  longest locale; buttons size by content + min-width, never fixed-width
  truncation. No ALL-CAPS styling on Cyrillic UI text (readability +
  width explosion) — weight/size carry emphasis instead.
- Numbers, dates, timers: tabular numerals, locale-aware formatting.
- Contrast floors: 4.5:1 body, 3:1 large text & essential graphics — the
  token table above is pre-verified; new color pairs must be checked.
- Keyboard: every instrument action reachable by keyboard; visible focus
  ring (`--accent`, 2px offset 2px); focus order = visual order. Canvas
  interactions get instrument-layer equivalents (build via board click OR
  via a keyboard-navigable build menu listing legal spots).
- Screen readers: menus/lobby/dialogs fully labeled (M1); live regions for
  turn changes and incoming offers (`aria-live="polite"`).
- Hit targets ≥44px; `:hover`-only affordances forbidden (touch parity).

## 11. Component vocabulary (M1 inventory)

Build exactly these, reuse everywhere; every interactive component ships all
states (default/hover/focus/active/disabled/loading/error) or it doesn't
merge: Button (primary/quiet/danger) · Pill (resource, count, timer) ·
PlayerCard (rail) · Panel (docked, collapsible) · Dialog (rare; see §7.5) ·
Toast · Tooltip · OfferCard (incoming/outgoing/history states) ·
OfferBuilder · LogLine · Histogram · Tabs · LocaleSwitcher · SeedChip ·
PhaseIndicator · TimerDisplay · EmptyState.

No component library dependency for M1 instruments (they are few and
specific); headless primitives (e.g. Radix) may be adopted for
Dialog/Tooltip a11y plumbing if a story justifies it — visual layer stays
ours either way.

## 12. Verdict on the E0.4 proto (what carries into S1.6.1)

Keep the _patterns_, not the code (proto dir is slated for deletion):

- ✅ **Keep:** tile stroke-patterns as second visual cue (a11y-correct);
  y-flattened 2.5D extrusion read; zero-state-in-canvas discipline;
  drag-pan/wheel-zoom feel; mist alpha pulse (add reduced-motion pause).
- 🔁 **Replace:** all proto colors with §2 tokens (proto greens/browns were
  placeholders and sit too close to "Catan pasture/desert" reads — legal +
  brand risk); `backgroundColor: 0x0f1220` → `--bg-abyss` `#040c12`;
  number-disc `0xf4ecd8` → `--chart-paper`; hot-number `0xa61b1b` →
  `#c53637`; monospace canvas digits → keep digits-only (locale-safe) but
  render at 2× and scale down for crispness.
- ➕ **Add in S1.6.1:** sea texture/gradient beneath tiles (the Chart should
  read as water, not void); tide-mark tokens as chart-paper discs with
  probability pips (dots under the number = roll frequency — teaches odds
  without reading rules); hover/selection states for legal placement spots
  in `--primary`.

## 13. The slop test (run before merging any UI diff)

1. Would a player fluent in Linear/Figma-grade tools trust this instrument
   panel, or pause at an off component?
2. Could someone guess "board game → parchment + wood + meeples" from the
   screen? If yes, it's the category reflex — we are an expedition
   instrument, not a tavern table.
3. Is any information hue-only? Is any string mono-lingual? Is any button
   moving? Any of these = not done.
