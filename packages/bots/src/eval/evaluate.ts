// S2.4.2 — the WEIGHT layer of the shared evaluation module: it turns the raw
// features (`features.ts`) into a single comparable score under a per-difficulty
// weight profile. This is the reusable brain the v1 bot scores with now and the
// M4 E4.8 advisor consumes later — so both a `{score, features}` breakdown is
// returned (the advisor surfaces `features` as "why this spot/move") and NO
// selection/RNG lives here (selection is `heuristic/v1.ts`'s `selectByDifficulty`).
//
// The weights are PROVISIONAL balance dials (owner note 2026-07-08 — "set
// sensible weights, don't agonize; real tuning is the playtest/balance-sim
// workstream"). They're ordered so a scored argmax expands first (a new
// settlement out-scores a city upgrade while production is the early bottleneck),
// which is what makes v1 both strategically sane and seed-robust.
import {
  type GameState,
  type PlayerId,
  type PlayerIntent,
  type VertexId,
} from '@skervik/core';

import {
  blockingValue,
  buildingsOf,
  countOwned,
  isOpenSettlementSite,
  TOPO,
  vertexPortValue,
  vertexProductionValue,
  vertexResourceDiversity,
  vpProximity,
} from './features.js';

/** The three bot skill tiers (owner-locked 2026-07-08: feature set + selection noise). */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * The weighted-feature profile a difficulty scores with. Each field weights one
 * raw feature (or names a flat action priority) into the single comparable
 * score. `easy` zeros `port`/`robberBlocking` so it plays "naively" (dev-card
 * buying stays active on every difficulty — termination needs the board-
 * independent VP path); `hard`/`medium` use the full set. Provisional (balance-
 * sim tunes them).
 */
export interface Weights {
  /** Per-pip weight of a spot's production value (the dominant term). */
  readonly production: number;
  /** Per distinct producing resource kind at a spot. */
  readonly diversity: number;
  /** Per port-rate point at a spot (0 on `easy`). */
  readonly port: number;
  /** Flat priority for founding a NEW settlement (expansion — the snowball). */
  readonly settlementBase: number;
  /** Flat priority for a city upgrade. */
  readonly cityBase: number;
  /** Per-pip value the city upgrade adds (it doubles the spot's production). */
  readonly cityProduction: number;
  /** City penalty per production spot the player is short of {@link TARGET_PRODUCTION_SPOTS} (keeps expansion ahead of upgrading early). */
  readonly productionBottleneck: number;
  /** Flat priority for a network-extending road. */
  readonly road: number;
  /** Bonus when a road directly OPENS a legal settlement site. */
  readonly roadOpensSpot: number;
  /** Flat priority for a progress-making bank trade (the anti-stall fallback). */
  readonly bankTrade: number;
  /**
   * Flat priority for buying a dev card — the board-independent VP source that
   * breaks a building-supply / board LOCK (a resource-rich bot with all 5
   * settlement placements + 4 cities used sits at ≤9 VP with a huge idle hand;
   * dev-card VP cards + largest army are its only remaining path to 10). Kept
   * BELOW `bankTrade` so building is always preferred; only idle surplus buys.
   */
  readonly devCard: number;
  /** Flat priority for PLAYING a held knight (largest army +2 VP — board-independent). */
  readonly knight: number;
  /** Baseline for ending the turn — 0, so any positive-scoring action beats it. */
  readonly endTurn: number;
  /** Per blocking-value point when relocating the robber (0 on `easy`). */
  readonly robberBlocking: number;
  /** Per PUBLIC VP of the robbed victim (steal from the leader). */
  readonly victimVp: number;
}

/** How many production spots (settlements + cities) before city upgrades stop being penalized. */
export const TARGET_PRODUCTION_SPOTS = 4;

/** Full weights — `hard` and `medium` share these (difficulty then differs only in selection noise). */
const FULL_WEIGHTS: Weights = {
  production: 5,
  diversity: 6,
  port: 8,
  settlementBase: 100,
  cityBase: 55,
  cityProduction: 5,
  productionBottleneck: 18,
  road: 40,
  roadOpensSpot: 35,
  bankTrade: 25,
  devCard: 20,
  knight: 35,
  endTurn: 0,
  robberBlocking: 3,
  victimVp: 6,
};

/**
 * The per-difficulty weight profiles: `hard`/`medium` = the full feature set;
 * `easy` = a REDUCED set (zero port + robber-blocking) so it ignores the subtle
 * levers and plays weaker. The SELECTION noise (argmax vs top-K) is applied
 * separately in `v1.ts`.
 */
export const FEATURE_WEIGHTS: Readonly<Record<Difficulty, Weights>> = {
  hard: FULL_WEIGHTS,
  medium: FULL_WEIGHTS,
  easy: {
    ...FULL_WEIGHTS,
    port: 0,
    robberBlocking: 0,
  },
};

/** A score plus the per-feature breakdown that produced it (the advisor's "why"). */
export interface ScoredEval {
  readonly score: number;
  readonly features: Readonly<Record<string, number>>;
}

/**
 * The placement worth of `vertexId` for `playerId` under `weights` — the
 * weighted sum of production, resource diversity, and port access. Used by BOTH
 * setup placement and main-phase settlement scoring (one scorer, two call
 * sites); the flat `settlementBase` is added by {@link evaluateAction} for the
 * main-phase build, so this raw spot worth stays comparable across phases.
 */
export function evaluateVertex(
  state: GameState,
  _playerId: PlayerId,
  vertexId: VertexId,
  weights: Weights,
): ScoredEval {
  const production = weights.production * vertexProductionValue(state, vertexId);
  const diversity = weights.diversity * vertexResourceDiversity(state, vertexId);
  const port = weights.port * vertexPortValue(state, vertexId);
  return {
    score: production + diversity + port,
    features: { production, diversity, port },
  };
}

/** The player's current production-spot count (settlements + cities). */
function productionSpots(state: GameState, playerId: PlayerId): number {
  const b = buildingsOf(state);
  return countOwned(b.settlements, playerId) + countOwned(b.cities ?? {}, playerId);
}

/** True if either empty endpoint of `edgeId` is (or steps toward) an open settlement site. */
function roadOpensSpot(state: GameState, edgeId: string): boolean {
  const edge = TOPO.edges.find((e) => e.id === edgeId);
  if (!edge) return false;
  const b = buildingsOf(state);
  return edge.vertexIds.some((endpoint) => isOpenSettlementSite(b, endpoint));
}

/**
 * Scores a candidate main-phase (or robber) `action` for `playerId` under
 * `weights`, returning `{score, features}`. Heterogeneous actions are made
 * comparable by flat priority bases (settlement > city > road > bank-trade >
 * dev-card > end-turn) plus feature terms, so a scored argmax expands first and
 * always has a legal fallback (`endTurn` scores the 0 baseline). Actions this
 * brain never generates score 0 (indistinguishable from passing).
 */
export function evaluateAction(
  state: GameState,
  playerId: PlayerId,
  action: PlayerIntent,
  weights: Weights,
): ScoredEval {
  switch (action.type) {
    case 'intent.buildSettlement': {
      const spot = evaluateVertex(state, playerId, action.vertexId, weights);
      return {
        score: weights.settlementBase + spot.score,
        features: { settlementBase: weights.settlementBase, ...spot.features },
      };
    }
    case 'intent.buildCity': {
      const upgrade =
        weights.cityProduction * vertexProductionValue(state, action.vertexId);
      const shortfall = Math.max(
        0,
        TARGET_PRODUCTION_SPOTS - productionSpots(state, playerId),
      );
      const bottleneck = -weights.productionBottleneck * shortfall;
      return {
        score: weights.cityBase + upgrade + bottleneck,
        features: { cityBase: weights.cityBase, cityProduction: upgrade, bottleneck },
      };
    }
    case 'intent.buildRoad': {
      const opens = roadOpensSpot(state, action.edgeId) ? weights.roadOpensSpot : 0;
      return {
        score: weights.road + opens,
        features: { road: weights.road, roadOpensSpot: opens },
      };
    }
    case 'intent.bankTrade':
      return { score: weights.bankTrade, features: { bankTrade: weights.bankTrade } };
    case 'intent.buyDevCard':
      return { score: weights.devCard, features: { devCard: weights.devCard } };
    case 'intent.playDevCard': {
      // v1 only proactively plays the knight (largest army); its worth is a flat
      // base plus the same robber block+victim terms as a plain relocation.
      if (action.card !== 'knight') return { score: 0, features: {} };
      const block =
        weights.robberBlocking * blockingValue(state, playerId, action.tileId);
      const victim =
        action.victimId !== undefined
          ? weights.victimVp * vpProximity(state, action.victimId)
          : 0;
      return {
        score: weights.knight + block + victim,
        features: { knight: weights.knight, robberBlocking: block, victimVp: victim },
      };
    }
    case 'intent.moveRobber': {
      const block =
        weights.robberBlocking * blockingValue(state, playerId, action.tileId);
      const victim =
        action.victimId !== undefined
          ? weights.victimVp * vpProximity(state, action.victimId)
          : 0;
      return {
        score: block + victim,
        features: { robberBlocking: block, victimVp: victim },
      };
    }
    case 'intent.endTurn':
      return { score: weights.endTurn, features: { endTurn: weights.endTurn } };
    default:
      return { score: 0, features: {} };
  }
}
