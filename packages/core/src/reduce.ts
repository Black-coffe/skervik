// @skervik/core — `reduce`: the single pure state transition (tech spec
// §4.1). ADR-0003: deterministic, side-effect free, never mutates its input
// — always returns a new GameState built from `event` data.

import { loadRuleProfile } from './ruleProfile.js';
import type {
  DevCardHoldings,
  DevCardKind,
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  ResourceType,
  TradeOffer,
} from './types.js';
import { NEUTRAL_OWNER_ID } from './types.js';

/**
 * Parallel-mode (S2.1.5) open-offer list update: store `offers`, or DROP the
 * `openTradeOffers` key entirely when the list is empty — the same "absent key
 * = nothing pending" convention the singular `openTradeOffer` and
 * `playersToDiscard` use, so a resolved parallel offer and a never-parallel
 * match share one shape. Does NOT touch `eventIndex` — the caller bumps it.
 */
function replaceOpenTradeOffers(
  state: GameState,
  offers: readonly TradeOffer[],
): GameState {
  const { openTradeOffers: _prev, ...rest } = state;
  return offers.length === 0 ? rest : { ...rest, openTradeOffers: offers };
}

/**
 * Merges a resource grant into a player's holdings. Pure — returns a new
 * `resources` object, never mutates `base` (ADR-0003).
 */
function addResources(
  base: Readonly<Record<ResourceType, number>>,
  grant: Readonly<Record<ResourceType, number>>,
): Record<ResourceType, number> {
  const result: Record<ResourceType, number> = { ...base };
  for (const [resource, amount] of Object.entries(grant)) {
    result[resource] = (result[resource] ?? 0) + amount;
  }
  return result;
}

/**
 * Debits a resource cost from a player's holdings. Pure — returns a new
 * `resources` object, never mutates `base` (ADR-0003); the inverse of
 * {@link addResources}.
 */
function subtractResources(
  base: Readonly<Record<ResourceType, number>>,
  cost: Readonly<Record<ResourceType, number>>,
): Record<ResourceType, number> {
  const result: Record<ResourceType, number> = { ...base };
  for (const [resource, amount] of Object.entries(cost)) {
    result[resource] = (result[resource] ?? 0) - amount;
  }
  return result;
}

/**
 * Consumes one held dev card of `kind` from `playerId`'s holdings (S1.2.3
 * play branches) — decrements `held` only, never `boughtThisTurn`: `validate`
 * already guaranteed `held - boughtThisTurn >= 1` before allowing the play,
 * so the invariant `boughtThisTurn <= held` still holds after this
 * decrement without touching `boughtThisTurn` itself (individual card
 * instances of the same kind are fungible — which physical copy gets
 * "used" doesn't matter). Pure — returns a new `devCards` map, never
 * mutates `devCards`.
 */
function decrementHeld(
  devCards: Readonly<Record<PlayerId, DevCardHoldings>> | undefined,
  playerId: PlayerId,
  kind: DevCardKind,
): Readonly<Record<PlayerId, DevCardHoldings>> {
  const existing = devCards?.[playerId] ?? { held: {}, boughtThisTurn: {} };
  const nextCount = (existing.held[kind] ?? 0) - 1;
  return {
    ...devCards,
    [playerId]: {
      held: { ...existing.held, [kind]: nextCount },
      boughtThisTurn: existing.boughtThisTurn,
    },
  };
}

/**
 * Spends one poverty token (S2.2.2) from `playerId` on a discounted bank trade.
 * Drop-key-if-zero (a spent-to-zero player leaves no `0`), and the whole
 * `povertyTokens` key is dropped when nobody holds a token — the same "absent
 * key = nothing pending" shape the grant path creates, so a never-granted match
 * and a fully-spent one share one state shape. Pure — never mutates `state`.
 */
function spendPovertyToken(state: GameState, playerId: PlayerId): GameState {
  const { povertyTokens: _prev, ...rest } = state;
  const tokens = { ...(state.povertyTokens ?? {}) };
  const next = (tokens[playerId] ?? 0) - 1;
  if (next > 0) {
    tokens[playerId] = next;
  } else {
    delete tokens[playerId];
  }
  return Object.keys(tokens).length > 0 ? { ...rest, povertyTokens: tokens } : rest;
}

/**
 * Applies one {@link GameEvent} to {@link GameState}, returning a *new*
 * state. Pure and deterministic (ADR-0003): no `Date.now`/`Math.random`/I/O,
 * and `state` is never mutated — every branch returns a fresh object built
 * by spreading `state`, not assigning into it.
 */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'match.started': {
      const players: PlayerState[] = event.playerIds.map((id) => ({
        id,
        name: id,
        victoryPoints: 0,
        resources: {},
      }));
      const firstPlayer = players[0];
      return {
        ...state,
        matchId: event.matchId,
        seedHash: event.seedHash,
        phase: 'setup',
        turn: 1,
        players,
        // The fixed seat order (S1.2.4) — `event.playerIds` IS the seating
        // order `players` was just built from; storing it separately makes
        // that order an explicit, standalone fact instead of something every
        // caller re-derives from `players`' array order (`types.ts`'s
        // `GameState.playerOrder` docstring).
        playerOrder: event.playerIds,
        currentPlayerId: firstPlayer ? firstPlayer.id : state.currentPlayerId,
        // The match's rule profile (S2.1.1) becomes a fact carried in state,
        // so replay/verify resolve identical rules. Only set when the event
        // carries it — a pre-S2.1.1 `match.started` (golden fixture) leaves
        // `profileId` absent, and the engine resolves absent → `'classic'`;
        // this keeps those frozen fixtures byte-identical.
        ...(event.profileId ? { profileId: event.profileId } : {}),
        eventIndex: event.index + 1,
      };
    }
    case 'board.generated': {
      return {
        ...state,
        board: {
          tileKinds: event.tileKinds,
          tileTokens: event.tileTokens,
          portContents: event.portContents,
          robberTileId: event.robberTileId,
        },
        eventIndex: event.index + 1,
      };
    }
    case 'neutral.placed': {
      // A NEUTRAL/phantom blocking settlement (S2.1.6) — a static genesis fact,
      // NOT a snake-draft turn: it lands a settlement owned by NEUTRAL_OWNER_ID
      // in `buildings` (creating `buildings` if this is the first placement) and
      // touches nothing else — no `payout`, no `pendingRoadVertexId`, no player
      // hand. The existing distance rule then blocks real players on/adjacent to
      // it (`validate.ts`), and every per-player tally excludes it by owner id.
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      return {
        ...state,
        buildings: {
          settlements: { ...buildings.settlements, [event.vertexId]: NEUTRAL_OWNER_ID },
          roads: buildings.roads,
          ...(buildings.cities ? { cities: buildings.cities } : {}),
        },
        eventIndex: event.index + 1,
      };
    }
    case 'dice.rolled': {
      // Landing the phase happens here (S1.2.4), not on the paired
      // `resources.produced` event: `dice.rolled` is the ONE event every
      // roll always emits, so it's the natural, single place the turn FSM
      // exits 'roll'. A NON-7 roll always lands on 'main', production (if
      // any) a zero-duration pass-through applied below via a separate
      // `resources.produced` event (S1.2.1) that leaves phase untouched. A 7
      // (S1.3.1) instead enters the `'robber'` phase seam — `playersToDiscard`
      // travels with it ONLY when non-empty (dropped entirely otherwise,
      // same "absent key = nothing pending" convention as
      // `pendingRoadVertexId`), so `moveRobber` is immediately legal for a 7
      // that happened to catch nobody over the hand limit.
      // Under `randomness: 'balanced_deck'` (Balanced profile, S2.1.2) a roll
      // is a without-replacement draw whose position keys off this cumulative
      // count — advance it by one per `dice.rolled`. Classic (`'dice'`) never
      // populates the key, so its reduced state (and every golden fixture)
      // stays byte-identical (absent resolves to `'classic'`).
      const randomness = loadRuleProfile(state.profileId ?? 'classic').randomness;
      const balancedAdvance =
        randomness === 'balanced_deck'
          ? { balancedRollsDrawn: (state.balancedRollsDrawn ?? 0) + 1 }
          : {};
      if (event.total === 7) {
        return {
          ...state,
          phase: 'robber',
          ...(event.playersToDiscard && event.playersToDiscard.length > 0
            ? { playersToDiscard: event.playersToDiscard }
            : {}),
          ...balancedAdvance,
          eventIndex: event.index + 1,
        };
      }
      return {
        ...state,
        phase: 'main',
        ...balancedAdvance,
        eventIndex: event.index + 1,
      };
    }
    case 'resources.produced': {
      const players = state.players.map((player) => {
        const grant = event.grants[player.id];
        return grant
          ? { ...player, resources: addResources(player.resources, grant) }
          : player;
      });
      return { ...state, players, bank: event.bank, eventIndex: event.index + 1 };
    }
    case 'turn.ended': {
      // Consolidated per-turn-marker reset (S1.2.4, absorbing S1.2.3's
      // interim version): the next player's turn starts in 'roll' — nobody
      // has rolled yet, the FSM's own way of tracking that (`types.ts`'s
      // `GamePhase` docstring) — with no dev card played, no dev-card
      // purchase counting as "bought this turn" for ANY player (Classic's
      // "can't play a card you bought this turn" rule is evaluated per
      // player, per turn, not just for whoever's turn just ended), and no
      // leftover setup-draft `pendingRoadVertexId` (defensive: the draft's
      // own `road.placed` always clears it before a turn legitimately ends,
      // but a turn should never persist a dangling one regardless). Drop
      // both markers entirely rather than setting them `undefined` —
      // `exactOptionalPropertyTypes` treats those differently, and an
      // absent key is the correct "hasn't happened this turn" shape (same
      // convention as `road.placed`'s own `pendingRoadVertexId` drop).
      const {
        devCardPlayedThisTurn: _played,
        pendingRoadVertexId: _pending,
        // An open trade offer never survives past the turn it was made in
        // (S1.3.2) — dropped here the same way, rather than requiring every
        // caller to `cancelTrade` before ending their turn. Parallel mode's
        // list (S2.1.5) is dropped too, so `turn.ended` clears whichever field
        // is set (they are mutually exclusive by the `parallelTrade` flag).
        openTradeOffer: _trade,
        openTradeOffers: _tradeList,
        ...rest
      } = state;
      const devCards = state.devCards
        ? (Object.fromEntries(
            Object.entries(state.devCards).map(([id, holdings]) => [
              id,
              { held: holdings.held, boughtThisTurn: {} },
            ]),
          ) as GameState['devCards'])
        : state.devCards;
      return {
        ...rest,
        currentPlayerId: event.nextPlayerId,
        phase: 'roll',
        turn: state.turn + 1,
        ...(devCards ? { devCards } : {}),
        eventIndex: event.index + 1,
      };
    }
    case 'settlement.placed': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? { ...player, resources: addResources(player.resources, event.payout) }
          : player,
      );
      return {
        ...state,
        players,
        buildings: {
          settlements: { ...buildings.settlements, [event.vertexId]: event.playerId },
          roads: buildings.roads,
        },
        pendingRoadVertexId: event.vertexId,
        eventIndex: event.index + 1,
      };
    }
    case 'road.placed': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      // Drop `pendingRoadVertexId` entirely (not set to `undefined`) —
      // `exactOptionalPropertyTypes` treats those differently, and an absent
      // key is the correct "no settlement pending" representation.
      const { pendingRoadVertexId: _pending, ...rest } = state;
      return {
        ...rest,
        buildings: {
          settlements: buildings.settlements,
          roads: { ...buildings.roads, [event.edgeId]: event.playerId },
        },
        currentPlayerId: event.nextPlayerId,
        phase: event.nextPhase,
        eventIndex: event.index + 1,
      };
    }
    case 'road.built': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? { ...player, resources: subtractResources(player.resources, event.cost) }
          : player,
      );
      return {
        ...state,
        players,
        buildings: {
          settlements: buildings.settlements,
          roads: { ...buildings.roads, [event.edgeId]: event.playerId },
          ...(buildings.cities ? { cities: buildings.cities } : {}),
        },
        eventIndex: event.index + 1,
      };
    }
    case 'settlement.built': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? {
              ...player,
              resources: subtractResources(player.resources, event.cost),
              victoryPoints: player.victoryPoints + 1,
            }
          : player,
      );
      return {
        ...state,
        players,
        buildings: {
          settlements: { ...buildings.settlements, [event.vertexId]: event.playerId },
          roads: buildings.roads,
          ...(buildings.cities ? { cities: buildings.cities } : {}),
        },
        eventIndex: event.index + 1,
      };
    }
    case 'city.built': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      // The city replaces its settlement — drop the vertex from
      // `settlements` entirely rather than leaving it in both records
      // (BuildingsState.cities docstring: a city never coexists with a
      // settlement at the same vertex).
      const { [event.vertexId]: _upgraded, ...remainingSettlements } =
        buildings.settlements;
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? {
              ...player,
              resources: subtractResources(player.resources, event.cost),
              victoryPoints: player.victoryPoints + 1,
            }
          : player,
      );
      return {
        ...state,
        players,
        buildings: {
          settlements: remainingSettlements,
          roads: buildings.roads,
          cities: { ...buildings.cities, [event.vertexId]: event.playerId },
        },
        eventIndex: event.index + 1,
      };
    }
    case 'devCard.bought': {
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? { ...player, resources: subtractResources(player.resources, event.cost) }
          : player,
      );
      const existing = state.devCards?.[event.playerId] ?? {
        held: {},
        boughtThisTurn: {},
      };
      const devCards = {
        ...state.devCards,
        [event.playerId]: {
          held: {
            ...existing.held,
            [event.card]: (existing.held[event.card] ?? 0) + 1,
          },
          boughtThisTurn: {
            ...existing.boughtThisTurn,
            [event.card]: (existing.boughtThisTurn[event.card] ?? 0) + 1,
          },
        },
      };
      return {
        ...state,
        players,
        devCards,
        devDeckRemaining: event.deckRemaining,
        eventIndex: event.index + 1,
      };
    }
    case 'devCard.roadBuildingPlayed': {
      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      const roads = { ...buildings.roads };
      for (const edgeId of event.edgeIds) roads[edgeId] = event.playerId;
      return {
        ...state,
        buildings: {
          settlements: buildings.settlements,
          roads,
          ...(buildings.cities ? { cities: buildings.cities } : {}),
        },
        devCards: decrementHeld(state.devCards, event.playerId, 'roadBuilding'),
        devCardPlayedThisTurn: true,
        eventIndex: event.index + 1,
      };
    }
    case 'devCard.yearOfPlentyPlayed': {
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? { ...player, resources: addResources(player.resources, event.resources) }
          : player,
      );
      return {
        ...state,
        players,
        bank: event.bank,
        devCards: decrementHeld(state.devCards, event.playerId, 'yearOfPlenty'),
        devCardPlayedThisTurn: true,
        eventIndex: event.index + 1,
      };
    }
    case 'devCard.monopolyPlayed': {
      const totalCollected = Object.values(event.transfers).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      const players = state.players.map((player) => {
        const taken = event.transfers[player.id];
        if (taken) {
          return {
            ...player,
            resources: subtractResources(player.resources, { [event.resource]: taken }),
          };
        }
        if (player.id === event.playerId && totalCollected > 0) {
          return {
            ...player,
            resources: addResources(player.resources, {
              [event.resource]: totalCollected,
            }),
          };
        }
        return player;
      });
      return {
        ...state,
        players,
        devCards: decrementHeld(state.devCards, event.playerId, 'monopoly'),
        devCardPlayedThisTurn: true,
        eventIndex: event.index + 1,
      };
    }
    case 'resources.discarded': {
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? { ...player, resources: subtractResources(player.resources, event.resources) }
          : player,
      );
      // Drop `playersToDiscard` entirely once nobody remains owing (not set
      // to `[]`) — same "absent key = nothing pending" convention `dice.rolled`
      // just established above.
      const { playersToDiscard: _prevOwing, ...rest } = state;
      return {
        ...rest,
        players,
        ...(event.remainingToDiscard.length > 0
          ? { playersToDiscard: event.remainingToDiscard }
          : {}),
        eventIndex: event.index + 1,
      };
    }
    case 'robber.moved': {
      const board = state.board;
      const stolenResource = event.stolenResource;
      const players =
        event.stolenFrom !== undefined && stolenResource !== undefined
          ? state.players.map((player) => {
              if (player.id === event.stolenFrom) {
                return {
                  ...player,
                  resources: subtractResources(player.resources, { [stolenResource]: 1 }),
                };
              }
              if (player.id === event.playerId) {
                return {
                  ...player,
                  resources: addResources(player.resources, { [stolenResource]: 1 }),
                };
              }
              return player;
            })
          : state.players;
      // Discards are always fully resolved by the time a `robber.moved`
      // lands (`validate`'s `MUST_DISCARD_FIRST` guard) — drop the marker
      // defensively regardless, so it can never linger past the move.
      const { playersToDiscard: _cleared, ...rest } = state;
      return {
        ...rest,
        players,
        ...(board ? { board: { ...board, robberTileId: event.tileId } } : {}),
        phase: event.nextPhase,
        eventIndex: event.index + 1,
      };
    }
    case 'devCard.knightPlayed': {
      const knightsPlayed = {
        ...state.knightsPlayed,
        [event.playerId]: (state.knightsPlayed?.[event.playerId] ?? 0) + 1,
      };
      return {
        ...state,
        devCards: decrementHeld(state.devCards, event.playerId, 'knight'),
        devCardPlayedThisTurn: true,
        knightsPlayed,
        phase: 'robber',
        eventIndex: event.index + 1,
      };
    }
    case 'trade.offered': {
      const { parallelTrade } = loadRuleProfile(state.profileId ?? 'classic');
      if (parallelTrade) {
        // Parallel phases (S2.1.5): add/replace THIS proposer's entry (one
        // offer per proposer) — a counter lands as the counterer's OWN entry.
        const offer: TradeOffer = {
          proposerId: event.proposerId,
          give: event.give,
          get: event.get,
          targets: event.targets,
          depth: event.depth,
        };
        const others = (state.openTradeOffers ?? []).filter(
          (existing) => existing.proposerId !== event.proposerId,
        );
        return {
          ...replaceOpenTradeOffers(state, [...others, offer]),
          eventIndex: event.index + 1,
        };
      }
      // --- single-offer path (M1, byte-frozen VERBATIM) ---
      return {
        ...state,
        openTradeOffer: {
          proposerId: event.proposerId,
          give: event.give,
          get: event.get,
          targets: event.targets,
          depth: event.depth,
        },
        eventIndex: event.index + 1,
      };
    }
    case 'trade.executed': {
      // Atomic swap (S1.3.2): both hands move together in this ONE `reduce`
      // step, and the offer closes in the SAME transition — there is no
      // intermediate state where one side has paid and the other hasn't.
      const players = state.players.map((player) => {
        if (player.id === event.proposerId) {
          return {
            ...player,
            resources: addResources(
              subtractResources(player.resources, event.give),
              event.get,
            ),
          };
        }
        if (player.id === event.accepterId) {
          return {
            ...player,
            resources: addResources(
              subtractResources(player.resources, event.get),
              event.give,
            ),
          };
        }
        return player;
      });
      const { parallelTrade } = loadRuleProfile(state.profileId ?? 'classic');
      if (parallelTrade) {
        // Parallel phases (S2.1.5): same atomic swap; remove only THIS
        // proposer's entry — every OTHER open offer survives untouched.
        const remaining = (state.openTradeOffers ?? []).filter(
          (existing) => existing.proposerId !== event.proposerId,
        );
        return {
          ...replaceOpenTradeOffers(state, remaining),
          players,
          eventIndex: event.index + 1,
        };
      }
      // --- single-offer path (M1, byte-frozen VERBATIM) ---
      const { openTradeOffer: _closed, ...rest } = state;
      return { ...rest, players, eventIndex: event.index + 1 };
    }
    case 'trade.rejected': {
      const { parallelTrade } = loadRuleProfile(state.profileId ?? 'classic');
      if (parallelTrade) {
        // Parallel phases (S2.1.5): the event's `offerProposerId` names WHICH
        // offer this rejection narrows — update that entry's targets, or drop
        // it once every target has rejected. Other offers stay untouched.
        const offers = state.openTradeOffers ?? [];
        const next =
          event.remainingTargets.length === 0
            ? offers.filter((existing) => existing.proposerId !== event.offerProposerId)
            : offers.map((existing) =>
                existing.proposerId === event.offerProposerId
                  ? { ...existing, targets: event.remainingTargets }
                  : existing,
              );
        return {
          ...replaceOpenTradeOffers(state, next),
          eventIndex: event.index + 1,
        };
      }
      // --- single-offer path (M1, byte-frozen VERBATIM) ---
      if (event.remainingTargets.length === 0) {
        // Every target has rejected — close the offer entirely, same
        // "absent key = nothing pending" convention `playersToDiscard` uses.
        const { openTradeOffer: _closed, ...rest } = state;
        return { ...rest, eventIndex: event.index + 1 };
      }
      return {
        ...state,
        ...(state.openTradeOffer
          ? {
              openTradeOffer: {
                ...state.openTradeOffer,
                targets: event.remainingTargets,
              },
            }
          : {}),
        eventIndex: event.index + 1,
      };
    }
    case 'trade.cancelled': {
      const { parallelTrade } = loadRuleProfile(state.profileId ?? 'classic');
      if (parallelTrade) {
        // Parallel phases (S2.1.5): the proposer withdraws their OWN offer
        // (`event.playerId === proposerId`) — remove just that list entry.
        const remaining = (state.openTradeOffers ?? []).filter(
          (existing) => existing.proposerId !== event.playerId,
        );
        return {
          ...replaceOpenTradeOffers(state, remaining),
          eventIndex: event.index + 1,
        };
      }
      // --- single-offer path (M1, byte-frozen VERBATIM) ---
      const { openTradeOffer: _closed, ...rest } = state;
      return { ...rest, eventIndex: event.index + 1 };
    }
    case 'bank.trade': {
      const players = state.players.map((player) =>
        player.id === event.playerId
          ? {
              ...player,
              resources: addResources(
                subtractResources(player.resources, { [event.give]: event.count }),
                { [event.get]: 1 },
              ),
            }
          : player,
      );
      const traded = { ...state, players, bank: event.bank, eventIndex: event.index + 1 };
      // A poverty-discounted trade (S2.2.2) consumes one of the actor's tokens;
      // absent `povertyDiscount` (every shipping preset, `robinHood:false`)
      // leaves `traded` byte-identical to M1 — the field is never even present.
      return event.povertyDiscount ? spendPovertyToken(traded, event.playerId) : traded;
    }
    case 'poverty.tokensGranted': {
      // Apply the explicit per-player token grant (S2.2.2) — `validate` already
      // gated it on the trailing check + `robinHoodTokenCap`, so `reduce` only
      // adds the fact (never recomputes who is trailing, ADR-0003). Only emitted
      // under `robinHood:true`, so this key never appears when the flag is off.
      const tokens = { ...(state.povertyTokens ?? {}) };
      for (const [id, amount] of Object.entries(event.grants)) {
        tokens[id] = (tokens[id] ?? 0) + amount;
      }
      return { ...state, povertyTokens: tokens, eventIndex: event.index + 1 };
    }
    case 'award.longestRoad': {
      // The award moved (S1.3.4). A present `playerId` is the new holder; an
      // ABSENT one means it vacated — drop the key entirely rather than set
      // it `undefined` (same "absent key = nobody holds it" convention as
      // `playersToDiscard`), so a vacated award and a never-awarded one share
      // one representation and stay byte-identical on replay.
      const { longestRoadHolder: _prev, ...rest } = state;
      return {
        ...rest,
        ...(event.playerId !== undefined ? { longestRoadHolder: event.playerId } : {}),
        eventIndex: event.index + 1,
      };
    }
    case 'award.largestArmy': {
      // Largest army never vacates once earned (`event.playerId` is always
      // present, see the event's docstring) — a plain assignment.
      return {
        ...state,
        largestArmyHolder: event.playerId,
        eventIndex: event.index + 1,
      };
    }
    case 'game.finalRoundStarted': {
      // Record the Splendor-style final-round FACT (S2.2.3): who crossed
      // `vpToWin` and when. `validate` decides WHEN to emit this (and later, on
      // the turn-end path, when the round completes to `game.ended`); `reduce`
      // only applies the fact (ADR-0003). Written ONLY under `finalRound:true`,
      // so `state.finalRound` never appears in a shipping-preset match.
      return {
        ...state,
        finalRound: {
          triggeredBy: event.triggeredBy,
          triggeredOnTurn: event.triggeredOnTurn,
        },
        eventIndex: event.index + 1,
      };
    }
    case 'game.ended': {
      // Freeze the match (S1.3.4): `validate` rejects every later gameplay
      // intent with `GAME_ALREADY_ENDED` once the phase is `'finished'`. The
      // final standings live on the event/log (an audit fact), not on state.
      return { ...state, phase: 'finished', eventIndex: event.index + 1 };
    }
    default: {
      const exhaustive: never = event;
      throw new Error(`unhandled event type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Folds {@link reduce} over an event log, from `initialState` to the final
 * state. "Replay = truth" (`docs/wiki/deterministic-core.md`): replaying the
 * same log from the same initial state always reproduces the same state.
 * The golden-fixture determinism test lands in S0.5.4; this is the helper it
 * builds on.
 */
export function replay(initialState: GameState, events: readonly GameEvent[]): GameState {
  return events.reduce(reduce, initialState);
}
