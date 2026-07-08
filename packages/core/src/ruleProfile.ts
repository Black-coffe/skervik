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

import type { DevCardKind, PortContent, ResourceType, TileKind } from './types.js';

/**
 * The selectable rule-profile ids (CLAUDE.md's `classic | balanced | blitz`,
 * plus the S2.1.6 `twoPlayer` mode). `'deep'` is reserved for M4 and
 * deliberately NOT added yet.
 */
export type RuleProfileId = 'classic' | 'balanced' | 'blitz' | 'twoPlayer';

/** Classic board composition (tile mix, token multiset, port mix) — `boardgen.ts`. */
export interface BoardProfile {
  /** 19 tile kinds shuffled onto the 19 tiles. */
  readonly tileMix: readonly TileKind[];
  /** 18 number tokens shuffled onto the 18 non-desert tiles. */
  readonly tokens: readonly number[];
  /** 9 port contents shuffled onto the 9 fixed port slots. */
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
   */
  readonly hiddenVp: boolean;
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
 * Balanced — Classic with the `balanced_deck` randomness FLAG set. The
 * number-deck draw mechanic that replaces dice is S2.1.2; here only the flag is
 * live, so play is byte-identical to Classic until that story lands. (Later
 * knobs activated by their own stories: the balanced deck itself — S2.1.2.)
 */
export const BALANCED_PROFILE: RuleProfile = {
  ...CLASSIC_PROFILE,
  id: 'balanced',
  name: 'Balanced',
  randomness: 'balanced_deck',
};

/**
 * Blitz — Classic with a lower victory threshold (`vpToWin: 8`) for a shorter
 * game. `vpToWin` is a knob the engine ALREADY consumes, so this is live
 * config: a Blitz match ends earlier. (Later knobs activated by their own
 * stories: adaptive board/duration — S2.1.3.) Blitz also runs TIGHTER turn
 * timers (S2.1.4): roughly half Classic's windows for a faster game.
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

/** The shipping profiles — one entry per {@link RuleProfileId} (exhaustive). */
const SHIPPING_PROFILES: Readonly<Record<RuleProfileId, RuleProfile>> = {
  classic: CLASSIC_PROFILE,
  balanced: BALANCED_PROFILE,
  blitz: BLITZ_PROFILE,
  twoPlayer: TWO_PLAYER_PROFILE,
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
};

/**
 * Resolves a {@link RuleProfileId} to its {@link RuleProfile} — a pure, total,
 * deterministic function (no wall-clock, no RNG, no I/O). An unknown id (only
 * reachable from an untrusted/deserialized value the type system can't check)
 * throws a typed error rather than silently falling back, so a corrupt
 * `profileId` surfaces loudly instead of quietly picking Classic rules.
 */
export function loadRuleProfile(id: RuleProfileId): RuleProfile {
  const profile = PROFILE_REGISTRY[id];
  if (profile === undefined) {
    throw new Error(`Unknown rule profile id: ${String(id)}`);
  }
  return profile;
}
