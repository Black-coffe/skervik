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
 * The selectable rule-profile ids (CLAUDE.md's `classic | balanced | blitz`).
 * `'deep'` is reserved for M4 and deliberately NOT added yet.
 */
export type RuleProfileId = 'classic' | 'balanced' | 'blitz';

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

/** Post-7 discard constants — `validate.ts`. */
export interface RobberProfile {
  readonly handLimit: number;
  readonly halfDivisor: number;
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
  readonly board: BoardProfile;
  readonly devCards: DevCardProfile;
  readonly setup: SetupProfile;
  readonly production: ProductionProfile;
  readonly build: BuildProfile;
  readonly bankTrade: BankTradeProfile;
  readonly robber: RobberProfile;
  readonly victory: VictoryProfile;
  /**
   * Server-enforced turn-timer durations (S2.1.4) — read ONLY by the Colyseus
   * room to arm `this.clock`, never by `reduce`/`validate` (grep-confirmed).
   */
  readonly timers: TimerProfile;
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

/** The profile registry — one entry per {@link RuleProfileId}. */
const PROFILE_REGISTRY: Readonly<Record<RuleProfileId, RuleProfile>> = {
  classic: CLASSIC_PROFILE,
  balanced: BALANCED_PROFILE,
  blitz: BLITZ_PROFILE,
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
