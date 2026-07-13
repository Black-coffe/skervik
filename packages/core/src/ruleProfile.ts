// @skervik/core — the rule-profile aggregate (S2.1.1, M2 config backbone).
//
// Turns the LOCKED product invariant — "Rule Profiles are config objects, not
// code branches (`classic | balanced | blitz`); the multi-mode platform is ONE
// engine configured differently" (CLAUDE.md · spec §4.1 · ADR-0003/0004) — into
// real code. Before this, the engine's rules were eight module-local hardcoded
// `CLASSIC_*_PROFILE` constants that `validate`/`reduce`/`boardgen`/`devcards`
// read directly by name — the "code branch per mode" anti-pattern waiting to
// happen. This file is now the SINGLE source of truth for those values: the old
// per-domain constants are re-derived from `CLASSIC_PROFILE` (byte-identical),
// and the engine reads its knobs from `loadRuleProfile(state.profileId)`.
//
// Zero runtime deps (ADR-0003): pure data + a pure total loader.

import { buildTopology } from './board.js';
import type { DevCardKind, PortContent, ResourceType, TileKind } from './types.js';

/**
 * The registered rule-profile ids (CLAUDE.md's `classic | balanced | blitz`,
 * the S2.1.6 `twoPlayer` mode, and the S2.1.7a `expanded` 5–6 player board).
 * `'deep'` is reserved for M4 and deliberately NOT added yet.
 *
 * `'expanded'` is a real, resolvable {@link RuleProfileId} (so a live 5–6p
 * match's `GameState.profileId` typechecks and `loadRuleProfile('expanded')`
 * resolves), but it is deliberately ABSENT from {@link SHIPPING_PROFILE_IDS}
 * (the lobby-selectable allow-list) and the protocol's `ShippingProfileIdSchema`
 * — it is registered CORE-only and unreachable from any client until S2.1.7b
 * wires server seats + lobby routing to it (ADR-0013).
 */
export type RuleProfileId = 'classic' | 'balanced' | 'blitz' | 'twoPlayer' | 'expanded';

/** Board composition (radius + tile mix, token multiset, port mix) — `boardgen.ts`. */
export interface BoardProfile {
  /**
   * Board radius in hex rings (ADR-0013): 2 = Classic (19 tiles / 9 ports),
   * 3 = expanded 5–6 player board (37 tiles / 11 ports). The topology geometry
   * derives entirely from this via `buildTopology(radius, ports.length)`. This
   * is a PROFILE field, never a field of the `board.generated` event — Classic's
   * `radius: 2` is additive, so the M1 golden bytes are unchanged.
   */
  readonly radius: number;
  /** Tile kinds shuffled onto the tiles (length `3·r²+3·r+1` for radius `r`). */
  readonly tileMix: readonly TileKind[];
  /** Number tokens shuffled onto the non-desert tiles (one per non-desert tile). */
  readonly tokens: readonly number[];
  /** Port contents shuffled onto the fixed coastal port slots (length = port slots). */
  readonly ports: readonly PortContent[];
}

/** Development-card deck composition + buy cost — `devcards.ts`. */
export interface DevCardProfile {
  readonly deck: readonly DevCardKind[];
  readonly buyCost: Readonly<Record<ResourceType, number>>;
}

/** Setup-phase counts — `validate.ts`. */
export interface SetupProfile {
  readonly settlementsPerPlayer: number;
}

/** Production/bank constants — `validate.ts`. */
export interface ProductionProfile {
  /** Finite bank pool per resource type (Physical-Catan parity: 19). */
  readonly bankPerResource: number;
}

/** Build costs + per-player piece-supply limits — `validate.ts`. */
export interface BuildProfile {
  readonly costs: {
    readonly road: Readonly<Record<ResourceType, number>>;
    readonly settlement: Readonly<Record<ResourceType, number>>;
    readonly city: Readonly<Record<ResourceType, number>>;
  };
  readonly supply: {
    readonly roads: number;
    readonly settlements: number;
    readonly cities: number;
  };
}

/** Bank-trade rate available with no port — `validate.ts`. */
export interface BankTradeProfile {
  readonly baseRate: number;
}

/** Post-7 discard constants + the S2.2.1 friendly-robber catch-up gate — `validate.ts`. */
export interface RobberProfile {
  readonly handLimit: number;
  readonly halfDivisor: number;
  /** When `true`, the robber cannot steal from a player at/below {@link RobberProfile.friendlyRobberVpCeiling} PUBLIC VP (S2.2.1 catch-up). */
  readonly friendlyRobber: boolean;
  /** PUBLIC-VP protection threshold consumed only while {@link RobberProfile.friendlyRobber} is `true`. */
  readonly friendlyRobberVpCeiling: number;
}

/**
 * Server-enforced turn-timer durations (S2.1.4), in wall-clock milliseconds,
 * per decision phase. **SERVER-CONSUMED ONLY**: the Colyseus `GameRoom` resolves
 * `loadRuleProfile(state.profileId).timers` to arm its `this.clock`; the pure
 * engine (`reduce`/`validate`) NEVER reads this — durations are wall-clock
 * policy, not game logic, so keeping them out of the core preserves the
 * deterministic-isomorphic invariant (no clock in the core, no golden/serialized
 * state change: `GameState` still carries only `profileId`). Values are v1,
 * documented as tunable — calibrate against telemetry in M3.
 */
export interface TimerProfile {
  /**
   * How long BEFORE the hard deadline the client should start visibly warning
   * (the room projects `turnSoftWarnAt = turnDeadline − softWarningMs`). Must be
   * less than every hard deadline below.
   */
  readonly softWarningMs: number;
  /** `'roll'` phase hard deadline (the turn's mandatory first step). */
  readonly rollMs: number;
  /** `'main'` phase hard deadline (build/buy/trade/play/endTurn). */
  readonly mainMs: number;
  /** `'robber'` + a non-empty `playersToDiscard` hard deadline (post-7 discards). */
  readonly discardMs: number;
  /** `'robber'` move (+ steal) hard deadline, once discards have cleared. */
  readonly robberMs: number;
  /**
   * Consecutive force-completed turns before a seat is flagged `idle` (anti-AFK,
   * S2.1.4) — a resilience/matchmaking hint S2.3.3 bot-fill will later consume,
   * NOT a game rule and NOT a karmic ban (the seat is only flagged, never removed).
   */
  readonly afkThreshold: number;
}

/**
 * Deterministic catch-up knobs (roadmap principle 3 — *catch-up over
 * runaway-leader*). The tech-spec §180 `RuleProfile.catchUp` sub-profile; S2.2.2
 * introduces it with the first member, `robinHood` (poverty tokens for trailing
 * players). Every knob is a pure-from-state balance dial — NO seed, NO PRNG, so
 * `verify.ts` stays randomness-only. `friendlyRobber` (S2.2.1) pragmatically
 * stays in {@link RobberProfile}; S2.2.3/S2.2.4 catch-up flags will join here.
 */
export interface CatchUpProfile {
  /**
   * When `true`, a TRAILING player (PUBLIC VP ≤ leader's public VP −
   * {@link CatchUpProfile.robinHoodVpGap}) earns +1 poverty token on a non-7
   * dice roll that produces ZERO resources for them (self-compensation for
   * empty rolls, S2.2.2). Off on every shipping preset.
   */
  readonly robinHood: boolean;
  /** Trailing threshold: a player is trailing when public VP ≤ leader's public VP − this. */
  readonly robinHoodVpGap: number;
  /** Max poverty tokens a player may hold — accrual stops at this cap (anti-farming). */
  readonly robinHoodTokenCap: number;
  /** Discounted bank ratio (N:1) a held poverty token unlocks; spending it consumes one token. */
  readonly robinHoodExchangeRate: number;
  /**
   * When `true`, reaching `victory.vpToWin` does NOT end the game instantly
   * (S2.2.3) — it starts a Splendor-style FINAL ROUND: every OTHER player gets
   * exactly one more turn, then the game ends and the highest FULL VP wins
   * (deterministic tie-break). Removes the "won because my turn came first"
   * asymmetry. Off on every shipping preset.
   */
  readonly finalRound: boolean;
  /**
   * When `true`, held VP dev cards are EXCLUDED from the win/trigger threshold
   * (S2.2.3) — the threshold reads PUBLIC VP only, so a stockpiled hidden VP
   * card can't spring a surprise win. Hidden VP is still revealed and counted
   * in the final standings. Off on every shipping preset.
   *
   * **S2.2.6 measurement note:** this is an INFORMATION-HIDING mechanic —
   * its value is that OPPONENTS cannot see who is about to win and so cannot
   * coordinate against them, not a mechanical rule change. `@skervik/bots`'
   * heuristic bots never read hidden VP either (every VP read goes through
   * `computePublicVictoryPoints`, `eval/features.ts:184`), so a bot cohort is
   * symmetrically blind to what this flag hides — but that is not why the
   * effect is unmeasurable. It is unmeasurable because our bots never
   * coordinate against a leader at all, visible or not, so there is no
   * collusion channel for hiding information to disrupt. The balance-sim's
   * earlier "hiddenVp measurably HURTS comebacks" finding was an artifact of
   * a confounded metric and was retracted in S2.2.5a; do not infer from this
   * flag's placement in `CatchUpProfile` that enabling it helps OR hurts
   * trailing players — that question is not answerable by this harness.
   */
  readonly hiddenVp: boolean;
  /**
   * When `true`, a storm (7-roll) on a deterministic cadence (every
   * {@link CatchUpProfile.eventTilesInterval}-th storm, counted by
   * `GameState.sevensRolled`) ALSO grants the trailing player(s) a poverty
   * token — REUSING the `robinHood` machinery (same helper, same event, same
   * shared pool/cap) as a SECOND emission site (S2.2.4). The robber/discard
   * flow of the storm is completely unchanged. Off on every shipping preset.
   */
  readonly eventTiles: boolean;
  /**
   * Every Nth storm is an "event tile" (provisional balance knob, S2.2.4) —
   * dead while {@link CatchUpProfile.eventTiles} is `false`.
   */
  readonly eventTilesInterval: number;
}

/** Victory threshold + award minimums/values — `validate.ts`. */
export interface VictoryProfile {
  readonly vpToWin: number;
  readonly longestRoadMin: number;
  readonly largestArmyMin: number;
  readonly longestRoadVP: number;
  readonly largestArmyVP: number;
}

/**
 * A complete rule profile: the single config object the whole engine reads its
 * knobs from. Fixed at `match.started` (carried in the log via
 * `GameState.profileId`), so replay + the S1.7.3 fair-RNG verifier resolve the
 * SAME rules — event-sourcing integrity.
 */
export interface RuleProfile {
  readonly id: RuleProfileId;
  /** Human label (i18n key comes later, S2.5.4 lobby). */
  readonly name: string;
  /**
   * Randomness source. `'dice'` is the Classic 2d6 roll; `'balanced_deck'` is a
   * FLAG only here — the number-deck draw mechanic is S2.1.2, not this story.
   */
  readonly randomness: 'dice' | 'balanced_deck';
  /**
   * Parallel-phases trade knob (S2.1.5). `false` (every shipping preset) is the
   * M1 single-offer behavior — at most one open `openTradeOffer`, a second
   * `proposeTrade` while one is open rejected with `TRADE_OFFER_ALREADY_OPEN`.
   * `true` lets a match hold MULTIPLE concurrent open offers (one per proposer,
   * in `GameState.openTradeOffers`) so negotiation isn't a one-at-a-time
   * bottleneck (the anti-"dead time" product goal). Kept OFF on all shipping
   * presets until the client multi-offer HUD exists (deferred) — a mode that
   * opens offers the UI can't render would be a broken UX; its liveness is
   * proven by the internal {@link PARALLEL_TRADE_TEST_PROFILE}. Enabling it on a
   * real preset (likely Blitz, for pace) is a one-line follow-up once that HUD
   * lands. Trade is NOT seed-derived, so this touches no RNG/verify surface.
   */
  readonly parallelTrade: boolean;
  readonly board: BoardProfile;
  readonly devCards: DevCardProfile;
  readonly setup: SetupProfile;
  readonly production: ProductionProfile;
  readonly build: BuildProfile;
  readonly bankTrade: BankTradeProfile;
  readonly robber: RobberProfile;
  /**
   * Deterministic catch-up knobs (S2.2.2) — `robinHood` poverty tokens for
   * trailing players. Off on every shipping preset; resolved via
   * `state.profileId` inside the engine like every other knob.
   */
  readonly catchUp: CatchUpProfile;
  readonly victory: VictoryProfile;
  /**
   * Server-enforced turn-timer durations (S2.1.4) — read ONLY by the Colyseus
   * room to arm `this.clock`, never by `reduce`/`validate` (grep-confirmed).
   */
  readonly timers: TimerProfile;
  /**
   * How many NEUTRAL/phantom blocking settlements to place at match genesis
   * (S2.1.6, the 2-player mode). ABSENT on every profile except `twoPlayer` —
   * so Classic/Balanced/Blitz (and their golden fixtures) stay byte-frozen: no
   * neutral placement runs when this is undefined. When set, the deterministic
   * board policy (`neutral.ts`) places this many neutral settlements on the
   * highest-production legal vertices at genesis, forcing the two real players
   * to spread and compete on the full standard board (the "phantom on the
   * standard board" mechanic — no board topology change, no seed draw). v1
   * value, documented tunable — calibrate against 2p telemetry in M3.
   */
  readonly neutralSettlements?: number;
}

/**
 * Three load-bearing coherence checks (S2.2.6), each proven against
 * `validate.ts`/`reduce.ts` by reading the code, not by sampling — throws on
 * the first violation. Run ONCE per registry entry at MODULE INITIALIZATION
 * (see the loop below {@link PROFILE_REGISTRY}), never from
 * `loadRuleProfile` — that resolves a FROZEN constant on every
 * `reduce`/`validate` call, and a registry entry cannot change between
 * calls, so re-checking there would cost cycles on every event and catch
 * nothing new. An incoherent profile must fail loudly at import, not at
 * turn 200 of a live match.
 */
export function validateRuleProfile(profile: RuleProfile): void {
  // G1 — `validate.ts`'s event-storm cadence computes
  // `(sevensRolled + 1) % eventTilesInterval`; at `interval: 0` that is
  // `NaN === 0`, which is always `false` — the mechanic silently never
  // fires. The real invariant is "the cadence CAN fire", which is
  // `Number.isInteger(v) && v >= 1`, not merely `v >= 1`: `NaN < 1` and
  // `Infinity < 1` are BOTH `false`, so a bare `< 1` check lets both slip
  // through, and `(s + 1) % NaN`/`(s + 1) % Infinity` are never `0` either —
  // the exact permanently-dead-flag defect this guard exists to catch.
  // Checked unconditionally (not only while `eventTiles` is on): the value
  // is nonsensical regardless of whether the flag is currently enabled, and
  // would silently break the moment someone flips it on without touching
  // this field.
  if (
    !Number.isInteger(profile.catchUp.eventTilesInterval) ||
    profile.catchUp.eventTilesInterval < 1
  ) {
    throw new Error(
      `Rule profile "${profile.id}": catchUp.eventTilesInterval must be an ` +
        `integer >= 1 (got ${profile.catchUp.eventTilesInterval}) — a non-integer ` +
        'or non-positive value makes the event-storm cadence check permanently ' +
        'false, a silently dead flag.',
    );
  }
  // G2 — `reduce.ts`'s `spendPovertyToken` has exactly ONE call site, gated
  // on `event.povertyDiscount`, which `validate.ts` can only set behind a
  // short-circuiting `profile.catchUp.robinHood &&`. With `robinHood:false`,
  // any poverty token `eventTiles` grants can never be spent by any player.
  if (profile.catchUp.eventTiles && !profile.catchUp.robinHood) {
    throw new Error(
      `Rule profile "${profile.id}": catchUp.eventTiles requires ` +
        'catchUp.robinHood — eventTiles grants poverty tokens, and only the ' +
        'robinHood-gated bank-trade discount can ever spend one.',
    );
  }
  // G3 — the discount must beat the universal bank rate or it is a
  // surcharge, not a catch-up mechanic. It need NOT beat a 2:1 port: there
  // `bestBankRate` already returns the port's rate, `intent.count` matches
  // it, the normal (non-discount) path handles the trade, and no token is
  // spent — harmless. So only the upper bound against `baseRate` is a real
  // invariant; asserting anything more would reject a valid config.
  if (
    profile.catchUp.robinHoodExchangeRate < 1 ||
    profile.catchUp.robinHoodExchangeRate >= profile.bankTrade.baseRate
  ) {
    throw new Error(
      `Rule profile "${profile.id}": catchUp.robinHoodExchangeRate must be ` +
        `in [1, ${profile.bankTrade.baseRate}) (the bank's base rate), got ` +
        `${profile.catchUp.robinHoodExchangeRate}.`,
    );
  }
  // G4 (S2.1.7a / ADR-0013 invariant 6) — the board arrays must be internally
  // consistent for the profile's `radius`, or `generateBoard` would zip
  // mismatched-length arrays and silently drop/undefine tiles. Checked at import
  // for EVERY registered profile (the loop below `PROFILE_REGISTRY`), so a
  // mis-sized expanded board fails at module load, never at turn 200 of a match.
  const { radius, tileMix, tokens, ports } = profile.board;
  // tile count for a radius-r hexagon is 3r² + 3r + 1 (r=2 → 19, r=3 → 37).
  const expectedTiles = 3 * radius * radius + 3 * radius + 1;
  if (tileMix.length !== expectedTiles) {
    throw new Error(
      `Rule profile "${profile.id}": board.tileMix.length must be ${expectedTiles} ` +
        `(3·r²+3·r+1 for radius ${radius}), got ${tileMix.length}.`,
    );
  }
  // one token per NON-desert tile.
  const nonDesertTiles = tileMix.filter((kind) => kind !== 'desert').length;
  if (tokens.length !== nonDesertTiles) {
    throw new Error(
      `Rule profile "${profile.id}": board.tokens.length must be ${nonDesertTiles} ` +
        `(one per non-desert tile), got ${tokens.length}.`,
    );
  }
  // ports.length must equal the port slots the topology carves for this radius —
  // `buildTopology` carves exactly `ports.length` slots (ports.length is the one
  // source of truth for portSlotCount), so this binds the geometry to the config.
  const portSlots = buildTopology(radius, ports.length).portSlots.length;
  if (ports.length !== portSlots) {
    throw new Error(
      `Rule profile "${profile.id}": board.ports.length (${ports.length}) must equal ` +
        `the ${portSlots} port slots the radius-${radius} topology carves.`,
    );
  }
}

/**
 * The Classic profile — the SINGLE source of truth for every rule value the
 * engine consumes. These are the exact literals that previously lived as the
 * eight `CLASSIC_*_PROFILE` module constants in `boardgen`/`devcards`/`validate`
 * (moved here verbatim, not changed); those modules now re-derive their
 * back-compat named exports from this object. Byte-frozen: the M1 golden /
 * determinism / replay / verify suites are the parity proof.
 */
export const CLASSIC_PROFILE: RuleProfile = {
  id: 'classic',
  name: 'Classic',
  randomness: 'dice',
  // Single-offer trade (M1, byte-frozen) — Balanced/Blitz inherit this via
  // their `...CLASSIC_PROFILE` spread; no shipping preset opens parallel offers.
  parallelTrade: false,
  board: {
    // radius 2 → 19 tiles / 54 vertices / 72 edges / 9 port slots (byte-frozen).
    radius: 2,
    // 19 tile kinds (4 timber / 3 clay / 4 fleece / 4 barley / 3 iron / 1 desert).
    tileMix: [
      'timber',
      'timber',
      'timber',
      'timber',
      'clay',
      'clay',
      'clay',
      'fleece',
      'fleece',
      'fleece',
      'fleece',
      'barley',
      'barley',
      'barley',
      'barley',
      'iron',
      'iron',
      'iron',
      'desert',
    ],
    tokens: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    ports: [
      { kind: 'generic', rate: 3 },
      { kind: 'generic', rate: 3 },
      { kind: 'generic', rate: 3 },
      { kind: 'generic', rate: 3 },
      { kind: 'resource', rate: 2, resource: 'timber' },
      { kind: 'resource', rate: 2, resource: 'clay' },
      { kind: 'resource', rate: 2, resource: 'fleece' },
      { kind: 'resource', rate: 2, resource: 'barley' },
      { kind: 'resource', rate: 2, resource: 'iron' },
    ],
  },
  devCards: {
    // 25 cards: 14 knight, 2 road-building, 2 year-of-plenty, 2 monopoly, 5 VP.
    deck: [
      'knight',
      'knight',
      'knight',
      'knight',
      'knight',
      'knight',
      'knight',
      'knight',
      'knight',
      'knight',
      'knight',
      'knight',
      'knight',
      'knight',
      'roadBuilding',
      'roadBuilding',
      'yearOfPlenty',
      'yearOfPlenty',
      'monopoly',
      'monopoly',
      'victoryPoint',
      'victoryPoint',
      'victoryPoint',
      'victoryPoint',
      'victoryPoint',
    ],
    buyCost: { fleece: 1, barley: 1, iron: 1 },
  },
  setup: {
    settlementsPerPlayer: 2,
  },
  production: {
    bankPerResource: 19,
  },
  build: {
    costs: {
      road: { timber: 1, clay: 1 },
      settlement: { timber: 1, clay: 1, fleece: 1, barley: 1 },
      city: { iron: 3, barley: 2 },
    },
    supply: {
      roads: 15,
      settlements: 5,
      cities: 4,
    },
  },
  bankTrade: {
    baseRate: 4,
  },
  robber: {
    handLimit: 7,
    halfDivisor: 2,
    // Byte-frozen off (S2.2.1) — Balanced/Blitz/twoPlayer inherit `false` via
    // their `...CLASSIC_PROFILE` spread; liveness proven by the internal
    // FRIENDLY_ROBBER_TEST_PROFILE below, the S2.1.5 precedent.
    friendlyRobber: false,
    friendlyRobberVpCeiling: 2,
  },
  // Byte-frozen off (S2.2.2) — Balanced/Blitz/twoPlayer inherit `robinHood:false`
  // via their `...CLASSIC_PROFILE` spread; liveness proven by the internal
  // ROBIN_HOOD_TEST_PROFILE below, the S2.1.5/S2.2.1 precedent. The params are
  // provisional balance knobs (dead while `robinHood:false` → change no shipping
  // behavior), tuned by the M2 balance-sim workstream.
  catchUp: {
    robinHood: false,
    robinHoodVpGap: 2,
    robinHoodTokenCap: 3,
    robinHoodExchangeRate: 2,
    // Byte-frozen off (S2.2.3) — Balanced/Blitz/twoPlayer inherit both via their
    // `...CLASSIC_PROFILE` spread; liveness proven by the internal
    // FINAL_ROUND/HIDDEN_VP test profiles below. Off → the win/end path stays
    // byte-identical to M1 (instant `game.ended` on the acting player's full VP).
    finalRound: false,
    hiddenVp: false,
    // Byte-frozen off (S2.2.4) — Balanced/Blitz/twoPlayer inherit both via their
    // `...CLASSIC_PROFILE` spread; liveness proven by the internal
    // EVENT_TILES_ROBIN_HOOD test profile below. Off → storms never advance
    // `sevensRolled` or emit an extra `poverty.tokensGranted`, so the roll's
    // event batch stays byte-identical to M1.
    eventTiles: false,
    eventTilesInterval: 3,
  },
  victory: {
    vpToWin: 10,
    longestRoadMin: 5,
    largestArmyMin: 3,
    longestRoadVP: 2,
    largestArmyVP: 2,
  },
  // v1 turn timers (S2.1.4) — server-only, tunable against M3 telemetry. Soft
  // warning fires in the final 15s; hard deadlines are generous for a thoughtful
  // Classic game (2 min main, 1 min roll, 45s for a post-7 discard/robber move).
  timers: {
    softWarningMs: 15_000,
    rollMs: 60_000,
    mainMs: 120_000,
    discardMs: 45_000,
    robberMs: 45_000,
    afkThreshold: 2,
  },
};

/**
 * Balanced — Classic with `randomness: 'balanced_deck'` (S2.1.2): number
 * production draws WITHOUT REPLACEMENT from the 36-outcome 2d6 deck instead
 * of an independent roll each turn, reducing DICE VARIANCE (a run of the
 * same number, or a long drought of a resource, is structurally impossible
 * within one 36-draw cycle).
 *
 * **S2.2.6 honesty note:** the S2.2.5/S2.2.5a balance-sim, once its
 * comeback metric was corrected for the `vpToWin`-confound, found NO
 * measured effect on leader runaway for Balanced vs. Classic (both share
 * `vpToWin: 10`, so the sim's matched-cut contrast is clean; there is
 * simply no signal). Dice variance and runaway-leader are two DIFFERENT
 * pains with two different cures — Balanced answers the first, not the
 * second. Do not describe or market Balanced as a catch-up mode.
 */
export const BALANCED_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  id: 'balanced',
  name: 'Balanced',
  randomness: 'balanced_deck',
};

/**
 * Blitz — Classic with a lower victory threshold (`vpToWin: 8`) for a
 * shorter game. `vpToWin` is a knob the engine ALREADY consumes, so this is
 * live config: a Blitz match ends earlier. Blitz also runs TIGHTER turn
 * timers (S2.1.4): roughly half Classic's windows for a faster game.
 *
 * **S2.2.6 honesty note:** the balance-sim's bot harness is ACTION-CAPPED,
 * not wall-clocked, so Blitz's turn timers have never been exercised by any
 * measurement — the sim's Blitz numbers isolate `vpToWin: 8` alone. Separately,
 * the corrected matched-cut comeback metric shows Blitz has FEWER comebacks
 * than Classic in every trailing-count stratum (a shorter race mechanically
 * favours whoever is already ahead when the clock, i.e. `vpToWin`, runs out
 * sooner) — Blitz is a pace lever, not a catch-up lever, and should not be
 * described as one.
 */
export const BLITZ_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  id: 'blitz',
  name: 'Blitz',
  victory: {
    ...CLASSIC_PROFILE.victory,
    vpToWin: 8,
  },
  timers: {
    softWarningMs: 10_000,
    rollMs: 30_000,
    mainMs: 60_000,
    discardMs: 30_000,
    robberMs: 30_000,
    afkThreshold: 2,
  },
};

/**
 * Two-player — Classic in every rule value (standard board, costs, VP) EXCEPT
 * it places {@link RuleProfile.neutralSettlements} NEUTRAL blocking settlements
 * at genesis (S2.1.6). Two real players on the full 19-tile board don't compete
 * for space, producing a dull solo-build; a handful of neutral blockers on the
 * best vertices (a DETERMINISTIC board policy, `neutral.ts` — NOT a seed draw)
 * forces them to spread and contest, reusing the existing distance rule to
 * block. The neutral is excluded from turns/production/robber/trade/VP (it's not
 * a real player). `neutralSettlements` is v1 (2) and documented tunable.
 *
 * `twoPlayer` is modeled as its own profile id (like Balanced/Blitz), so
 * "2-player Balanced" isn't expressible yet — making player-count orthogonal to
 * rule-mode (a flag any profile sets when 2 seats) is a deferred refinement; the
 * distinct-id path is the simplest coherent thing now (Law 2, plan §S2.1.6).
 */
export const TWO_PLAYER_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  id: 'twoPlayer',
  name: 'Two-Player',
  neutralSettlements: 2,
};

/**
 * The expanded 5–6 player board (ADR-0013 Decision 2): a radius-3 hexagon —
 * 37 tiles / 96 vertices / 132 edges / 42 boundary edges / 11 port slots. The
 * geometry derives entirely from `radius: 3` via `buildTopology(3, 11)`; the
 * arrays below only need the RIGHT LENGTHS (37 / 36 / 11 — the load-bearing
 * part) — the exact mix is v1 balance, tunable against 5–6p telemetry in M3
 * without a schema change. `validateRuleProfile` G4 checks the lengths at import.
 */
export const EXPANDED_BOARD: BoardProfile = {
  radius: 3,
  // 37 tiles: timber×8, clay×6, fleece×8, barley×8, iron×6, desert×1 — Classic's
  // 4:3:4:4:3 resource ratio doubled (clay + iron stay the scarce premiums).
  tileMix: [
    'timber',
    'timber',
    'timber',
    'timber',
    'timber',
    'timber',
    'timber',
    'timber',
    'clay',
    'clay',
    'clay',
    'clay',
    'clay',
    'clay',
    'fleece',
    'fleece',
    'fleece',
    'fleece',
    'fleece',
    'fleece',
    'fleece',
    'fleece',
    'barley',
    'barley',
    'barley',
    'barley',
    'barley',
    'barley',
    'barley',
    'barley',
    'iron',
    'iron',
    'iron',
    'iron',
    'iron',
    'iron',
    'desert',
  ],
  // 36 tokens (one per non-desert tile): symmetric flattened-triangular spread,
  // 8 red (6/8) tokens — pairwise-non-adjacent-placeable on 37 tiles, so the
  // bounded red-token retry in boardgen stays satisfiable. No 7.
  tokens: [
    2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10,
    10, 10, 11, 11, 11, 11, 12, 12,
  ],
  // 11 ports: generic 3:1 ×6 + one 2:1 per resource (the Classic fairness
  // invariant — one 2:1 per resource — carried onto the larger coastline).
  ports: [
    { kind: 'generic', rate: 3 },
    { kind: 'generic', rate: 3 },
    { kind: 'generic', rate: 3 },
    { kind: 'generic', rate: 3 },
    { kind: 'generic', rate: 3 },
    { kind: 'generic', rate: 3 },
    { kind: 'resource', rate: 2, resource: 'timber' },
    { kind: 'resource', rate: 2, resource: 'clay' },
    { kind: 'resource', rate: 2, resource: 'fleece' },
    { kind: 'resource', rate: 2, resource: 'barley' },
    { kind: 'resource', rate: 2, resource: 'iron' },
  ],
};

/**
 * Expanded — Classic rules on the radius-3 {@link EXPANDED_BOARD} (ADR-0013
 * Decision 3). The board is the ONLY divergence from Classic (no rule branch,
 * Law 2): every gameplay value — dice randomness, catch-up off, supply 15/5/4,
 * `vpToWin: 10` — is inherited via the `...CLASSIC_PROFILE` spread. Registered
 * and resolvable CORE-only; NOT lobby-selectable until S2.1.7b (see
 * {@link RuleProfileId} / {@link SHIPPING_PROFILE_IDS}).
 */
export const EXPANDED_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  id: 'expanded',
  name: 'Expanded',
  board: EXPANDED_BOARD,
};

/**
 * The lobby-selectable preset ids, in display order (S2.5.4) — the runtime
 * counterpart of {@link RuleProfileId} a caller can enumerate without
 * importing the profile bodies themselves. This is the ALLOW-LIST a lobby
 * (client) and the authoritative wire boundary (server, `GameRoom.onAuth`)
 * check a join's requested `profileId` against, since {@link PROFILE_REGISTRY}
 * below is keyed by `string` and additionally resolves six measurement-only
 * ids (`EXPERIMENTAL_PROFILE_IDS`) that must never be reachable from a client.
 *
 * `'expanded'` is a registered {@link RuleProfileId} (resolvable via
 * {@link loadRuleProfile}) but deliberately EXCLUDED here: it is not
 * lobby-selectable until S2.1.7b wires 5–6 seats + routing (ADR-0013). So this
 * list is a CURATED SUBSET of `RuleProfileId`, not one entry per id.
 */
export const SHIPPING_PROFILE_IDS: readonly RuleProfileId[] = [
  'classic',
  'balanced',
  'blitz',
  'twoPlayer',
];

/**
 * The resolvable presets — one entry per {@link RuleProfileId} (exhaustive, so
 * `loadRuleProfile` is total over the id union). Note `expanded` is here (a real
 * resolvable profile) even though it is NOT in {@link SHIPPING_PROFILE_IDS}
 * (the narrower lobby-selectable subset) — see that export's docstring.
 */
const SHIPPING_PROFILES: Readonly<Record<RuleProfileId, RuleProfile>> = {
  classic: CLASSIC_PROFILE,
  balanced: BALANCED_PROFILE,
  blitz: BLITZ_PROFILE,
  twoPlayer: TWO_PLAYER_PROFILE,
  expanded: EXPANDED_PROFILE,
};

/**
 * INTERNAL, NON-SHIPPING profile id used ONLY to prove the `parallelTrade`
 * config path in tests (S2.1.5) — deliberately absent from {@link RuleProfileId}
 * and the protocol's `profileId` enum (`packages/protocol`), so NO client can
 * select it. It exists because no shipping preset enables `parallelTrade` yet
 * (the multi-offer client HUD is deferred), yet the flag's live behavior still
 * needs coverage — the S2.1.1 precedent of proving a knob via a distinct
 * profile. Resolved through {@link loadRuleProfile} like any other id (the
 * registry KEY selects it), so the parallel `validate`/`reduce` branches run
 * under the same `state.profileId` mechanism they will in production.
 */
export const PARALLEL_TRADE_TEST_PROFILE_ID = '__parallel_trade_test__';

/**
 * Classic in every rule value EXCEPT `parallelTrade: true` — the internal
 * fixture behind {@link PARALLEL_TRADE_TEST_PROFILE_ID}. Its `.id` stays
 * `'classic'` (inherited via the spread; {@link RuleProfileId} has no test
 * member) — the registry key, not `.id`, is what resolves it.
 */
export const PARALLEL_TRADE_TEST_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  parallelTrade: true,
};

/**
 * INTERNAL, NON-SHIPPING profile id used ONLY to prove the `friendlyRobber`
 * config path in tests (S2.2.1) — deliberately absent from
 * {@link RuleProfileId} (and the protocol's `profileId` enum), so no client
 * can select it. No shipping preset enables `friendlyRobber` yet (assigning
 * catch-up flags to specific presets is a batched product decision once E2.2
 * exists), yet the flag's live behavior still needs coverage — the S2.1.5
 * precedent of proving a knob via a distinct profile.
 */
export const FRIENDLY_ROBBER_TEST_PROFILE_ID = '__friendly_robber_test__';

/**
 * Classic in every rule value EXCEPT `robber.friendlyRobber: true` — the
 * internal fixture behind {@link FRIENDLY_ROBBER_TEST_PROFILE_ID}. Its `.id`
 * stays `'classic'` (inherited via the spread; {@link RuleProfileId} has no
 * test member) — the registry key, not `.id`, is what resolves it.
 */
export const FRIENDLY_ROBBER_TEST_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  robber: {
    ...CLASSIC_PROFILE.robber,
    friendlyRobber: true,
    friendlyRobberVpCeiling: 2,
  },
};

/**
 * INTERNAL, NON-SHIPPING profile id used ONLY to prove the `robinHood`
 * poverty-token catch-up path in tests (S2.2.2) — deliberately absent from
 * {@link RuleProfileId} (and the protocol's `profileId` enum), so no client can
 * select it. No shipping preset enables `robinHood` yet (assigning catch-up
 * flags to specific presets is a batched product decision once E2.2 exists),
 * yet the flag's live behavior still needs coverage — the S2.1.5/S2.2.1
 * precedent of proving a knob via a distinct profile.
 */
export const ROBIN_HOOD_TEST_PROFILE_ID = '__robin_hood_test__';

/**
 * Classic in every rule value EXCEPT `catchUp.robinHood: true` — the internal
 * fixture behind {@link ROBIN_HOOD_TEST_PROFILE_ID}. Its `.id` stays `'classic'`
 * (inherited via the spread; {@link RuleProfileId} has no test member) — the
 * registry key, not `.id`, is what resolves it.
 */
export const ROBIN_HOOD_TEST_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  catchUp: {
    ...CLASSIC_PROFILE.catchUp,
    robinHood: true,
  },
};

/**
 * INTERNAL, NON-SHIPPING profile ids used ONLY to prove the S2.2.3 `finalRound`
 * / `hiddenVp` catch-up paths in tests — deliberately absent from
 * {@link RuleProfileId} (and the protocol's `profileId` enum), so no client can
 * select them. No shipping preset enables either flag yet (assigning catch-up
 * flags to specific presets is a batched product decision once E2.2 exists),
 * yet the flags' live behavior still needs coverage — the S2.1.5/S2.2.1/S2.2.2
 * precedent of proving a knob via a distinct profile.
 */
export const FINAL_ROUND_TEST_PROFILE_ID = '__final_round_test__';
export const HIDDEN_VP_TEST_PROFILE_ID = '__hidden_vp_test__';
export const FINAL_ROUND_HIDDEN_VP_TEST_PROFILE_ID = '__final_round_hidden_vp_test__';

/**
 * Classic in every rule value EXCEPT `catchUp.finalRound: true` — the internal
 * fixture behind {@link FINAL_ROUND_TEST_PROFILE_ID}. Its `.id` stays
 * `'classic'` (inherited via the spread; {@link RuleProfileId} has no test
 * member) — the registry key, not `.id`, is what resolves it.
 */
export const FINAL_ROUND_TEST_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  catchUp: {
    ...CLASSIC_PROFILE.catchUp,
    finalRound: true,
  },
};

/**
 * Classic in every rule value EXCEPT `catchUp.hiddenVp: true` — the internal
 * fixture behind {@link HIDDEN_VP_TEST_PROFILE_ID}.
 */
export const HIDDEN_VP_TEST_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  catchUp: {
    ...CLASSIC_PROFILE.catchUp,
    hiddenVp: true,
  },
};

/**
 * Classic in every rule value EXCEPT BOTH `catchUp.finalRound: true` and
 * `catchUp.hiddenVp: true` — the internal fixture behind
 * {@link FINAL_ROUND_HIDDEN_VP_TEST_PROFILE_ID}, proving the combined semantics
 * (public threshold starts the final round; hidden VP revealed decides the
 * winner after it completes).
 */
export const FINAL_ROUND_HIDDEN_VP_TEST_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  catchUp: {
    ...CLASSIC_PROFILE.catchUp,
    finalRound: true,
    hiddenVp: true,
  },
};

/**
 * INTERNAL, NON-SHIPPING profile id used ONLY to prove the S2.2.4
 * `eventTiles` catch-up path in tests — deliberately absent from
 * {@link RuleProfileId} (and the protocol's `profileId` enum), so no client
 * can select it. No shipping preset enables `eventTiles` yet (assigning
 * catch-up flags to specific presets is a batched product decision now that
 * all four E2.2 mechanics exist), yet the flag's live behavior still needs
 * coverage — the S2.1.5/S2.2.1/S2.2.2/S2.2.3 precedent of proving a knob via
 * a distinct profile. There is deliberately no `eventTiles`-alone fixture
 * (S2.2.6, guard G2): `eventTiles:true` with `robinHood:false` grants
 * poverty tokens nobody can ever spend, so `validateRuleProfile` rejects it
 * — this fixture always pairs the two flags.
 */
export const EVENT_TILES_ROBIN_HOOD_TEST_PROFILE_ID = '__event_tiles_robin_hood_test__';

/**
 * Classic in every rule value EXCEPT BOTH `catchUp.eventTiles: true`
 * (interval 2) and `catchUp.robinHood: true` — the internal fixture behind
 * {@link EVENT_TILES_ROBIN_HOOD_TEST_PROFILE_ID}, proving the non-7
 * `robinHood` grant and the event-storm grant share one `povertyTokens` pool
 * and one cap.
 */
export const EVENT_TILES_ROBIN_HOOD_TEST_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  catchUp: {
    ...CLASSIC_PROFILE.catchUp,
    eventTiles: true,
    eventTilesInterval: 2,
    robinHood: true,
  },
};

/**
 * The profile registry: the shipping presets plus the internal
 * parallel-trade and friendly-robber test profiles. Keyed by `string` (not
 * {@link RuleProfileId}) so the non-shipping test ids have a home without
 * widening the public union — {@link SHIPPING_PROFILES} still guarantees
 * every `RuleProfileId` has an entry.
 */
const PROFILE_REGISTRY: Readonly<Record<string, RuleProfile>> = {
  ...SHIPPING_PROFILES,
  [PARALLEL_TRADE_TEST_PROFILE_ID]: PARALLEL_TRADE_TEST_PROFILE,
  [FRIENDLY_ROBBER_TEST_PROFILE_ID]: FRIENDLY_ROBBER_TEST_PROFILE,
  [ROBIN_HOOD_TEST_PROFILE_ID]: ROBIN_HOOD_TEST_PROFILE,
  [FINAL_ROUND_TEST_PROFILE_ID]: FINAL_ROUND_TEST_PROFILE,
  [HIDDEN_VP_TEST_PROFILE_ID]: HIDDEN_VP_TEST_PROFILE,
  [FINAL_ROUND_HIDDEN_VP_TEST_PROFILE_ID]: FINAL_ROUND_HIDDEN_VP_TEST_PROFILE,
  [EVENT_TILES_ROBIN_HOOD_TEST_PROFILE_ID]: EVENT_TILES_ROBIN_HOOD_TEST_PROFILE,
};

/**
 * Groups every INTERNAL, NON-SHIPPING `*_TEST_PROFILE_ID` constant declared
 * above behind one named export (S2.2.5) — the id set the balance-sim harness
 * (`@skervik/bots/src/sim`) sweeps to measure a catch-up flag's live effect
 * before S2.2.6 assigns it to a shipping preset. These are MEASUREMENT
 * profiles, not selectable modes: they must NEVER be added to
 * {@link RuleProfileId} and must NEVER reach a lobby or the protocol's
 * `profileId` enum — only {@link loadRuleProfile} (a server/sim-internal
 * resolver) accepts them. `vp9`/`balancedVp9` (S2.2.5 H3 measurement
 * scaffolding) and the `eventTiles`-alone fixture (superseded by guard G2,
 * S2.2.6) were removed with the measurement they served — see
 * `S2.2.6-honest-presets-and-guards.md`.
 */
export const EXPERIMENTAL_PROFILE_IDS = {
  parallelTrade: PARALLEL_TRADE_TEST_PROFILE_ID,
  friendlyRobber: FRIENDLY_ROBBER_TEST_PROFILE_ID,
  robinHood: ROBIN_HOOD_TEST_PROFILE_ID,
  finalRound: FINAL_ROUND_TEST_PROFILE_ID,
  hiddenVp: HIDDEN_VP_TEST_PROFILE_ID,
  finalRoundHiddenVp: FINAL_ROUND_HIDDEN_VP_TEST_PROFILE_ID,
  eventTilesRobinHood: EVENT_TILES_ROBIN_HOOD_TEST_PROFILE_ID,
} as const;

/** A measurement-only profile id from {@link EXPERIMENTAL_PROFILE_IDS} — never a {@link RuleProfileId}. */
export type ExperimentalProfileId =
  (typeof EXPERIMENTAL_PROFILE_IDS)[keyof typeof EXPERIMENTAL_PROFILE_IDS];

/**
 * Resolves a {@link RuleProfileId} (or, S2.2.5, an {@link ExperimentalProfileId}
 * measurement id) to its {@link RuleProfile} — a pure, total, deterministic
 * function (no wall-clock, no RNG, no I/O). Widening the parameter beyond
 * {@link RuleProfileId} is TYPE-ONLY: {@link PROFILE_REGISTRY} was already
 * keyed by `string` and has resolved every `*_TEST_PROFILE_ID` since S2.1.5 —
 * this only lets a caller (the balance-sim harness) pass one without a cast.
 * An unknown id (only reachable from an untrusted/deserialized value the type
 * system can't check) throws a typed error rather than silently falling back,
 * so a corrupt `profileId` surfaces loudly instead of quietly picking Classic
 * rules.
 */
export function loadRuleProfile(id: RuleProfileId | ExperimentalProfileId): RuleProfile {
  const profile = PROFILE_REGISTRY[id];
  if (profile === undefined) {
    throw new Error(`Unknown rule profile id: ${String(id)}`);
  }
  return profile;
}

// S2.2.6 — run every guard over every registry entry ONCE, at module
// initialization. `PROFILE_REGISTRY` is fully built by this point (every
// `const` above has been evaluated), so this is the entire registry, not a
// subset. An incoherent profile throws HERE, at import time, rather than
// silently shipping a dead flag.
for (const profile of Object.values(PROFILE_REGISTRY)) {
  validateRuleProfile(profile);
}
