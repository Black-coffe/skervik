// @skervik/core — S2.1.1: the rule-profile aggregate, loader, and presets.
//
// Proves three things: (1) `loadRuleProfile` is a total function over the id
// registry and throws on an unknown id; (2) `CLASSIC_PROFILE` composes EXACTLY
// the values the eight former `CLASSIC_*_PROFILE` module constants held — the
// back-compat re-exports still equal the profile's sub-objects (byte-identical
// source of truth); (3) a knob the engine ALREADY consumes — `victory.vpToWin`
// — is live config: a Blitz match (`vpToWin: 8`) ends where the same position
// under Classic (`vpToWin: 10`) does not. The Classic-is-byte-frozen guarantee
// itself is proven by the untouched M1 suite (golden replay, determinism,
// `fullMatch.e2e` replay-equality, `verifyMatchRandomness`), not re-asserted
// here.

import { describe, expect, it } from 'vitest';

import { buildTopology } from './board.js';
import { CLASSIC_BOARD_PROFILE } from './boardgen.js';
import { CLASSIC_DEV_CARD_PROFILE } from './devcards.js';
import { reduce } from './reduce.js';
import {
  BALANCED_PROFILE,
  BLITZ_PROFILE,
  CLASSIC_PROFILE,
  EXPANDED_PROFILE,
  loadRuleProfile,
  type RuleProfile,
  type RuleProfileId,
  SHIPPING_PROFILE_IDS,
  TWO_PLAYER_PROFILE,
  validateRuleProfile,
} from './ruleProfile.js';
import type { GameState, PlayerState } from './types.js';
import {
  CLASSIC_BANK_TRADE_PROFILE,
  CLASSIC_BUILD_PROFILE,
  CLASSIC_SETUP_PROFILE,
  CLASSIC_VICTORY_PROFILE,
  validate,
} from './validate.js';

const SEED = 'skervik-ruleprofile-seed-1';

describe('loadRuleProfile', () => {
  it('is total over every RuleProfileId and returns the id it was asked for', () => {
    const ids: readonly RuleProfileId[] = ['classic', 'balanced', 'blitz'];
    for (const id of ids) {
      const profile = loadRuleProfile(id);
      expect(profile.id).toBe(id);
    }
  });

  it('returns the very same preset instances (deterministic, no per-call rebuild)', () => {
    expect(loadRuleProfile('classic')).toBe(CLASSIC_PROFILE);
    expect(loadRuleProfile('balanced')).toBe(BALANCED_PROFILE);
    expect(loadRuleProfile('blitz')).toBe(BLITZ_PROFILE);
  });

  it('throws a typed error on an unknown id (only reachable from untrusted input)', () => {
    // Cast: the type system forbids this, but a deserialized `profileId` could
    // carry a bad string — the loader must surface it loudly, not fall back.
    expect(() => loadRuleProfile('deep' as RuleProfileId)).toThrow(
      /unknown rule profile/i,
    );
  });
});

describe('CLASSIC_PROFILE composes the former module constants byte-for-byte', () => {
  it('re-derived back-compat exports equal the profile sub-objects', () => {
    expect(CLASSIC_BOARD_PROFILE).toBe(CLASSIC_PROFILE.board);
    expect(CLASSIC_DEV_CARD_PROFILE).toBe(CLASSIC_PROFILE.devCards);
    expect(CLASSIC_SETUP_PROFILE).toBe(CLASSIC_PROFILE.setup);
    expect(CLASSIC_BUILD_PROFILE).toBe(CLASSIC_PROFILE.build);
    expect(CLASSIC_BANK_TRADE_PROFILE).toBe(CLASSIC_PROFILE.bankTrade);
    expect(CLASSIC_VICTORY_PROFILE).toBe(CLASSIC_PROFILE.victory);
  });

  it('carries the exact Classic literal values (the frozen M1 rule set)', () => {
    expect(CLASSIC_PROFILE.randomness).toBe('dice');
    expect(CLASSIC_PROFILE.board.tileMix).toHaveLength(19);
    expect(CLASSIC_PROFILE.board.tokens).toEqual([
      2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
    ]);
    expect(CLASSIC_PROFILE.board.ports).toHaveLength(9);
    expect(CLASSIC_PROFILE.devCards.deck).toHaveLength(25);
    expect(CLASSIC_PROFILE.devCards.buyCost).toEqual({ fleece: 1, barley: 1, iron: 1 });
    expect(CLASSIC_PROFILE.setup.settlementsPerPlayer).toBe(2);
    expect(CLASSIC_PROFILE.production.bankPerResource).toBe(19);
    expect(CLASSIC_PROFILE.build.costs.city).toEqual({ iron: 3, barley: 2 });
    expect(CLASSIC_PROFILE.build.supply).toEqual({
      roads: 15,
      settlements: 5,
      cities: 4,
    });
    expect(CLASSIC_PROFILE.bankTrade.baseRate).toBe(4);
    expect(CLASSIC_PROFILE.robber).toEqual({
      handLimit: 7,
      halfDivisor: 2,
      friendlyRobber: false,
      friendlyRobberVpCeiling: 2,
    });
    expect(CLASSIC_PROFILE.victory).toEqual({
      vpToWin: 10,
      longestRoadMin: 5,
      largestArmyMin: 3,
      longestRoadVP: 2,
      largestArmyVP: 2,
    });
  });
});

describe('BALANCED / BLITZ presets are declarative deltas over Classic', () => {
  it('Balanced differs from Classic ONLY by the randomness flag (mechanic deferred to S2.1.2)', () => {
    expect(BALANCED_PROFILE.id).toBe('balanced');
    expect(BALANCED_PROFILE.randomness).toBe('balanced_deck');
    // Every knob the engine currently honors is shared with Classic — the
    // balanced-deck DRAW is not implemented here, only the flag.
    expect(BALANCED_PROFILE.board).toBe(CLASSIC_PROFILE.board);
    expect(BALANCED_PROFILE.devCards).toBe(CLASSIC_PROFILE.devCards);
    expect(BALANCED_PROFILE.build).toBe(CLASSIC_PROFILE.build);
    expect(BALANCED_PROFILE.victory).toBe(CLASSIC_PROFILE.victory);
  });

  it('Blitz differs from Classic ONLY by a lower vpToWin (8)', () => {
    expect(BLITZ_PROFILE.id).toBe('blitz');
    expect(BLITZ_PROFILE.randomness).toBe('dice');
    expect(BLITZ_PROFILE.victory.vpToWin).toBe(8);
    // Every other victory knob unchanged from Classic.
    expect(BLITZ_PROFILE.victory.longestRoadMin).toBe(
      CLASSIC_PROFILE.victory.longestRoadMin,
    );
    expect(BLITZ_PROFILE.victory.largestArmyMin).toBe(
      CLASSIC_PROFILE.victory.largestArmyMin,
    );
    expect(BLITZ_PROFILE.board).toBe(CLASSIC_PROFILE.board);
    expect(BLITZ_PROFILE.devCards).toBe(CLASSIC_PROFILE.devCards);
  });
});

describe('vpToWin is live config: Blitz ends a match Classic would not', () => {
  // A position worth 7 VP (3 cities + 1 settlement) where upgrading the
  // settlement to a 4th city lands the acting player on exactly 8 VP. No roads
  // and no knights, so no longest-road/largest-army award perturbs the tally.
  const topology = buildTopology();
  const vertices = topology.vertices.slice(0, 4).map((v) => v.id);
  const [cityA, cityB, cityC, settlementVertex] = vertices as [
    string,
    string,
    string,
    string,
  ];
  const RICH = { timber: 9, clay: 9, fleece: 9, barley: 9, iron: 9 };

  function makePlayer(id: string): PlayerState {
    return { id, name: id, victoryPoints: 0, resources: { ...RICH } };
  }

  /** player-1: 3 cities (6 VP) + 1 settlement (1 VP) = 7 VP, one city-upgrade from 8. */
  function nearWin(profileId: RuleProfileId): GameState {
    return {
      matchId: 'm-blitz',
      phase: 'main',
      turn: 12,
      currentPlayerId: 'player-1',
      players: [makePlayer('player-1'), makePlayer('player-2')],
      eventIndex: 50,
      seedHash: 'deadbeef',
      profileId,
      buildings: {
        settlements: { [settlementVertex]: 'player-1' },
        roads: {},
        cities: { [cityA]: 'player-1', [cityB]: 'player-1', [cityC]: 'player-1' },
      },
    };
  }

  const upgradeToEight = {
    type: 'intent.buildCity' as const,
    playerId: 'player-1',
    vertexId: settlementVertex,
  };

  it('Blitz (vpToWin 8): the upgrade to the 8th VP fires game.ended', () => {
    const result = validate(nearWin('blitz'), upgradeToEight, 'player-1', SEED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ended = result.events.find((e) => e.type === 'game.ended');
    expect(ended).toMatchObject({ type: 'game.ended', winnerId: 'player-1' });

    const finished = result.events.reduce(reduce, nearWin('blitz'));
    expect(finished.phase).toBe('finished');
  });

  it('Classic (vpToWin 10): the SAME upgrade to 8 VP does NOT end the match', () => {
    const result = validate(nearWin('classic'), upgradeToEight, 'player-1', SEED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((e) => e.type === 'game.ended')).toBe(false);
    expect(result.events[0]).toMatchObject({ type: 'city.built' });

    const next = result.events.reduce(reduce, nearWin('classic'));
    expect(next.phase).toBe('main');
  });
});

describe('validateRuleProfile — six coherence guards (S2.2.6 G1-G3, S2.1.7b G4-G6)', () => {
  it(
    'every shipping preset passes (proven twice over: this loop, AND the module-level ' +
      'loop over the whole PROFILE_REGISTRY at import — a violation there would have ' +
      'thrown before any test in this file could run)',
    () => {
      const shipping: readonly RuleProfile[] = [
        CLASSIC_PROFILE,
        BALANCED_PROFILE,
        BLITZ_PROFILE,
        TWO_PLAYER_PROFILE,
        EXPANDED_PROFILE,
      ];
      for (const profile of shipping) {
        expect(() => validateRuleProfile(profile)).not.toThrow();
      }
    },
  );

  it('G1 rejects catchUp.eventTilesInterval < 1 (the modulo check would be permanently false)', () => {
    const violating: RuleProfile = {
      ...CLASSIC_PROFILE,
      catchUp: { ...CLASSIC_PROFILE.catchUp, eventTilesInterval: 0 },
    };
    expect(() => validateRuleProfile(violating)).toThrow(/eventTilesInterval/);
  });

  // S2.2.6 lead-review nit 4 (core side): `NaN < 1` and `Infinity < 1` are
  // BOTH `false`, so a bare `< 1` check lets the exact dead-flag defect it
  // exists to prevent slip through unnoticed (`(s+1) % NaN` and
  // `(s+1) % Infinity` are never `0` either). The real invariant is
  // `Number.isInteger(v) && v >= 1`.
  it('G1 rejects catchUp.eventTilesInterval = NaN (the modulo check is NEVER 0, same dead-flag defect)', () => {
    const violating: RuleProfile = {
      ...CLASSIC_PROFILE,
      catchUp: { ...CLASSIC_PROFILE.catchUp, eventTilesInterval: Number.NaN },
    };
    expect(() => validateRuleProfile(violating)).toThrow(/eventTilesInterval/);
  });

  it('G1 rejects catchUp.eventTilesInterval = Infinity (passes a bare `< 1` check, same dead-flag defect)', () => {
    const violating: RuleProfile = {
      ...CLASSIC_PROFILE,
      catchUp: {
        ...CLASSIC_PROFILE.catchUp,
        eventTilesInterval: Number.POSITIVE_INFINITY,
      },
    };
    expect(() => validateRuleProfile(violating)).toThrow(/eventTilesInterval/);
  });

  it('G2 rejects catchUp.eventTiles:true with catchUp.robinHood:false (a dead grant nobody can spend)', () => {
    const violating: RuleProfile = {
      ...CLASSIC_PROFILE,
      catchUp: { ...CLASSIC_PROFILE.catchUp, eventTiles: true, robinHood: false },
    };
    expect(() => validateRuleProfile(violating)).toThrow(/robinHood/);
  });

  it('G3 rejects catchUp.robinHoodExchangeRate >= bankTrade.baseRate (a surcharge, not a discount)', () => {
    const violating: RuleProfile = {
      ...CLASSIC_PROFILE,
      catchUp: {
        ...CLASSIC_PROFILE.catchUp,
        robinHoodExchangeRate: CLASSIC_PROFILE.bankTrade.baseRate, // == 4, not < 4
      },
    };
    expect(() => validateRuleProfile(violating)).toThrow(/robinHoodExchangeRate/);
  });

  it('G3 does NOT reject a rate equal to a 2:1 port rate — only the base-rate upper bound is a real invariant', () => {
    const twoToOne: RuleProfile = {
      ...CLASSIC_PROFILE,
      catchUp: { ...CLASSIC_PROFILE.catchUp, robinHoodExchangeRate: 2 },
    };
    expect(() => validateRuleProfile(twoToOne)).not.toThrow();
  });

  // S2.2.6 lead-review nit 3: the lower-bound leg (`< 1`) had no forcing
  // test — deleting it left all 331 tests green, the exact "guard exists,
  // property isn't bound" disease G1/G2 exist to prevent. The leg is not
  // decorative: at rate 0, a trailing token-holder's `intent.count === 0`
  // satisfies the discount branch (`validate.ts:1986`), `canAfford({give:0})`
  // trivially passes, and the bank hands over a resource for nothing.
  it('G3 rejects catchUp.robinHoodExchangeRate 0 (a free resource, not a discount)', () => {
    const violating: RuleProfile = {
      ...CLASSIC_PROFILE,
      catchUp: { ...CLASSIC_PROFILE.catchUp, robinHoodExchangeRate: 0 },
    };
    expect(() => validateRuleProfile(violating)).toThrow(/robinHoodExchangeRate/);
  });

  // G4 (S2.1.7a / ADR-0013 invariant 6) — a mis-sized board array would make
  // `generateBoard` zip mismatched-length arrays and silently drop/undefine
  // tiles at runtime. These two tests bind each falsifiable length clause
  // independently (mirroring the G1/G3 "one test per leg" style) against the
  // radius-3 EXPANDED_PROFILE, so each fails ALONE if its own clause is
  // deleted. The guard's third (`ports.length`) clause is covered separately
  // below, by tests bound against the S2.1.7b rewrite (see that block's
  // comment for why the ORIGINAL clause here couldn't be forced to fire).
  it('G4 rejects board.tileMix with the wrong length for the profile radius (36, not 37 for radius 3)', () => {
    const violating: RuleProfile = {
      ...EXPANDED_PROFILE,
      board: {
        ...EXPANDED_PROFILE.board,
        tileMix: EXPANDED_PROFILE.board.tileMix.slice(0, 36),
      },
    };
    expect(() => validateRuleProfile(violating)).toThrow(/tileMix\.length must be 37/);
  });

  it('G4 rejects board.tokens with a length that does not match the non-desert tile count', () => {
    const violating: RuleProfile = {
      ...EXPANDED_PROFILE,
      board: {
        ...EXPANDED_PROFILE.board,
        tokens: EXPANDED_PROFILE.board.tokens.slice(0, 35),
      },
    };
    expect(() => validateRuleProfile(violating)).toThrow(/tokens\.length must be 36/);
  });

  // G4 ports clause (S2.1.7b follow-up) — the ORIGINAL clause recomputed its
  // own expected value via `buildTopology(radius, ports.length).portSlots
  // .length`, which is `ports.length` fed straight back out (`buildTopology`
  // carves EXACTLY `portSlotCount` slots by construction): `N !== N`, always
  // false. A `ports`-only corruption — e.g. `EXPANDED_PROFILE.board.ports
  // .slice(0, 10)` — could NOT make that clause throw (confirmed by running
  // exactly that slice against it). The rewritten clause bounds `ports.length`
  // INDEPENDENTLY (against the closed-form boundary-edge count, not against
  // itself), so a ports-only corruption now fires. This test is the padded/
  // "double-assign" direction: more ports than radius 3's 42 boundary edges
  // can host distinctly.
  it('G4 (rewritten) rejects board.ports.length exceeding the radius boundary-edge count (42 at radius 3)', () => {
    const tooManyPorts = Array.from({ length: 43 }, (_, i) => {
      const template =
        EXPANDED_PROFILE.board.ports[i % EXPANDED_PROFILE.board.ports.length];
      return template as (typeof EXPANDED_PROFILE.board.ports)[number];
    });
    const violating: RuleProfile = {
      ...EXPANDED_PROFILE,
      board: { ...EXPANDED_PROFILE.board, ports: tooManyPorts },
    };
    expect(() => validateRuleProfile(violating)).toThrow(/board\.ports\.length \(43\)/);
  });

  // G4 ports clause, the other direction: fewer than 5 ports means at least
  // one resource has no 2:1 port anywhere on the board (ADR-0013 fairness
  // invariant) — a `ports`-only corruption the original tautological clause
  // also could not catch, since `buildTopology(radius, 4).portSlots.length`
  // is tautologically 4 regardless of how few ports that is.
  it('G4 (rewritten) rejects board.ports.length below 5 (loses the one-2:1-per-resource fairness floor)', () => {
    const violating: RuleProfile = {
      ...EXPANDED_PROFILE,
      board: {
        ...EXPANDED_PROFILE.board,
        ports: EXPANDED_PROFILE.board.ports.slice(0, 4),
      },
    };
    expect(() => validateRuleProfile(violating)).toThrow(/board\.ports\.length \(4\)/);
  });

  // Cross-check (S2.1.7b): the G4 closed form `boundaryEdges(r) = 6·(2r+1)`
  // is proven against `buildTopology`'s ACTUAL boundary-edge count once here
  // — not trusted — computed the same way `board.test.ts` computes it
  // (edges incident to exactly 1 on-board tile), completely independently of
  // `ruleProfile.ts`'s guard implementation.
  it("the G4 closed form 6·(2r+1) matches buildTopology's real boundary-edge count, for r = 2 and 3", () => {
    for (const radius of [2, 3]) {
      const portSlotCount = radius === 2 ? 9 : 11;
      const topo = buildTopology(radius, portSlotCount);
      const boundaryEdges = topo.edges.filter(
        (edge) => topo.tiles.filter((t) => t.edgeIds.includes(edge.id)).length === 1,
      );
      expect(boundaryEdges).toHaveLength(6 * (2 * radius + 1));
    }
  });

  // G5 (S2.1.7b D1) — seat range sanity.
  it('G5 rejects minSeats > maxSeats', () => {
    const violating: RuleProfile = { ...CLASSIC_PROFILE, minSeats: 5, maxSeats: 4 };
    expect(() => validateRuleProfile(violating)).toThrow(/seat range/);
  });

  it('G5 rejects minSeats below 2', () => {
    const violating: RuleProfile = { ...CLASSIC_PROFILE, minSeats: 1 };
    expect(() => validateRuleProfile(violating)).toThrow(/seat range/);
  });

  it('G5 rejects maxSeats above 6 (ADAPTIVE_MAX_PLAYERS)', () => {
    const violating: RuleProfile = { ...CLASSIC_PROFILE, maxSeats: 7 };
    expect(() => validateRuleProfile(violating)).toThrow(/seat range/);
  });

  // G6 (S2.1.7b) — neutral.ts's placement policy is proven only against the
  // radius-2 topology; a profile pairing neutral settlements with a wider
  // board must fail at import, not silently place against the wrong board.
  it('G6 rejects neutralSettlements > 0 on a non-radius-2 board', () => {
    const violating: RuleProfile = {
      ...EXPANDED_PROFILE,
      neutralSettlements: 2,
    };
    expect(() => validateRuleProfile(violating)).toThrow(/neutralSettlements/);
  });

  it('G6 does not fire when neutralSettlements is unset on a non-radius-2 board (EXPANDED_PROFILE itself)', () => {
    expect(() => validateRuleProfile(EXPANDED_PROFILE)).not.toThrow();
  });
});

describe('seat metadata: minSeats/maxSeats (S2.1.7b D1)', () => {
  it('every profile in PROFILE_REGISTRY exposes the documented seat range', () => {
    expect(CLASSIC_PROFILE.minSeats).toBe(2);
    expect(CLASSIC_PROFILE.maxSeats).toBe(4);
    expect(BALANCED_PROFILE.minSeats).toBe(2);
    expect(BALANCED_PROFILE.maxSeats).toBe(4);
    expect(BLITZ_PROFILE.minSeats).toBe(2);
    expect(BLITZ_PROFILE.maxSeats).toBe(4);
    expect(TWO_PLAYER_PROFILE.minSeats).toBe(2);
    expect(TWO_PLAYER_PROFILE.maxSeats).toBe(2);
    expect(EXPANDED_PROFILE.minSeats).toBe(5);
    expect(EXPANDED_PROFILE.maxSeats).toBe(6);
  });

  it('SHIPPING_PROFILE_IDS includes expanded (S2.1.7b widens the lobby allow-list)', () => {
    expect(SHIPPING_PROFILE_IDS).toEqual([
      'classic',
      'balanced',
      'blitz',
      'twoPlayer',
      'expanded',
    ]);
  });
});
