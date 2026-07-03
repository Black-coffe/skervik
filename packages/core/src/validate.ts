// @skervik/core — `validate`: turns a legal PlayerIntent into GameEvent(s), or
// rejects it. ADR-0003: only events mutate state; intents never do directly.
// Per the deterministic-core invariant, validate never throws for an expected
// rejection — it always returns the discriminated ValidateResult below.

import {
  type BoardTopology,
  buildTopology,
  type EdgeId,
  type EdgeTopology,
  findEdge,
  findTile,
  findVertex,
  type TileId,
  type VertexTopology,
} from './board.js';
import { CLASSIC_DEV_CARD_PROFILE, shuffledDevDeck } from './devcards.js';
import { deriveValue, gameplayStreamIndex, rollDie, type Seed } from './rng.js';
import type {
  BankTradedEvent,
  BuildingsState,
  CityBuiltEvent,
  DevCardBoughtEvent,
  DevCardKind,
  DiceRolledEvent,
  GameEvent,
  GamePhase,
  GameState,
  KnightPlayedEvent,
  MonopolyPlayedEvent,
  PlayerId,
  PlayerIntent,
  PlayerState,
  PortContent,
  RejectReason,
  ResourcesDiscardedEvent,
  ResourcesProducedEvent,
  ResourceType,
  RoadBuildingPlayedEvent,
  RoadBuiltEvent,
  RoadPlacedEvent,
  RobberMovedEvent,
  SettlementBuiltEvent,
  SettlementPlacedEvent,
  TradeCancelledEvent,
  TradeExecutedEvent,
  TradeOfferedEvent,
  TradeRejectedEvent,
  TurnEndedEvent,
  YearOfPlentyPlayedEvent,
} from './types.js';

/**
 * Result of {@link validate}: either the intent is legal and is translated
 * into the {@link GameEvent}s that would realize it, or it is rejected with a
 * {@link RejectReason}. Discriminated on `ok` (tech spec §4.1).
 */
export type ValidateResult =
  | { readonly ok: true; readonly events: GameEvent[] }
  | { readonly ok: false; readonly reason: RejectReason };

function reject(reason: RejectReason): ValidateResult {
  return { ok: false, reason };
}

/**
 * Classic setup-phase constants (rule-profile discipline, plan §1): the one
 * count legality logic actually consumes. The fixed forward-then-reverse
 * snake shape (see {@link snakeOrder}) is Classic-specific by construction
 * and isn't parameterized here — it only ever means 2 rounds.
 */
export const CLASSIC_SETUP_PROFILE = {
  settlementsPerPlayer: 2,
} as const;

/**
 * Classic production constants (rule-profile discipline, plan §1): the
 * finite bank pool per resource type. Physical-Catan parity (19 cards of
 * each of the 5 resources) — a swappable profile object, not a magic number
 * scattered through {@link computeProduction}.
 */
const CLASSIC_PRODUCTION_PROFILE = {
  bankPerResource: 19,
} as const;

/**
 * Classic build costs + per-player piece-supply limits (rule-profile
 * discipline, plan §1, S1.2.2 spec): the price list and caps live here as a
 * single swappable object, never scattered magic numbers through the build
 * branches below.
 */
export const CLASSIC_BUILD_PROFILE = {
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
} as const;

/**
 * Classic bank-trade rate (rule-profile discipline, plan §1, S1.3.3 spec):
 * the rate always available with no port at all. Port rates (3:1 generic,
 * 2:1 resource-specific) live on {@link PortContent} itself (S1.1.2,
 * `boardgen.ts`'s `CLASSIC_BOARD_PROFILE.ports`) — this is the ONE rate
 * that isn't board-generated data, so it gets its own small profile object
 * rather than a magic `4` inside {@link bestBankRate}.
 */
export const CLASSIC_BANK_TRADE_PROFILE = {
  baseRate: 4,
} as const;

/**
 * The gameplay RNG stream's per-event slot map (S1.2.1, fixed here,
 * documented in `docs/wiki/rng-stream-map.md` §1 — **never renumber a slot
 * once shipped**, an auditor's recomputation depends on it). `validate.ts`
 * is this scheme's owner (parallel to `boardgen.ts` owning
 * `BOARD_GEN_STREAM`); `gameplayStreamIndex` (`rng.ts`) only knows the
 * stride `K`, not what each slot means.
 */
const GAMEPLAY_SLOT = {
  DICE_A: 0,
  DICE_B: 1,
  /**
   * The robber steal-pick (S1.3.1): indexes into the victim's
   * sorted-deterministic hand (`expandHand` below). Keyed to the `index` of
   * the {@link RobberMovedEvent} that actually resolves the steal — for the
   * 7-roll path that's `intent.moveRobber`'s own event index; for the
   * knight path it's the SECOND of the 2 events `playDevCard`'s knight
   * branch emits (see {@link resolveRobberMove}'s callers).
   */
  STEAL: 2,
  // 3-7 still reserved for later same-event draws.
} as const;

// `buildTopology()` is pure and its result never changes for a given board
// radius (see its docstring: "callers should memoize the result") — cached
// once per module rather than rebuilt on every `validate` call.
let cachedTopology: BoardTopology | undefined;
function topology(): BoardTopology {
  cachedTopology ??= buildTopology();
  return cachedTopology;
}

/**
 * The Classic snake draft order: forward `P1..PN`, then reverse `PN..P1`
 * (length `2 * playerIds.length`) — round 1 places each player's first
 * settlement+road, round 2 (reversed) places the second (S1.1.3 spec).
 */
function snakeOrder(playerIds: readonly PlayerId[]): PlayerId[] {
  return [...playerIds, ...[...playerIds].reverse()];
}

/**
 * The canonical seat order (S1.2.4): reads {@link GameState.playerOrder}
 * once `match.started` has set it, falling back to `state.players`' own
 * array order for a state assembled without that event (see the field's
 * docstring, `types.ts`) — the ONE place both the setup snake-draft's exit
 * ({@link snakeOrder}'s caller below) and the main loop's `intent.endTurn`
 * derive "next player" from, replacing the two separate ad hoc derivations
 * this story consolidates.
 */
function seatOrder(state: GameState): readonly PlayerId[] {
  return state.playerOrder ?? state.players.map((player) => player.id);
}

/**
 * Distance rule (S1.1.3 spec): true if any vertex adjacent to `vertex`
 * already holds a settlement or a city — no two buildings may ever sit next
 * to each other. Shared by the free setup placement and the paid S1.2.2
 * build branch below so the adjacency walk is written once (`vertex.adjacentVertexIds`,
 * S1.1.1 embedded topology), never duplicated.
 */
function violatesDistanceRule(
  vertex: VertexTopology,
  buildings: BuildingsState,
): boolean {
  return vertex.adjacentVertexIds.some(
    (adjacentId) =>
      buildings.settlements[adjacentId] !== undefined ||
      buildings.cities?.[adjacentId] !== undefined,
  );
}

/**
 * Road-building network legality (S1.2.2 spec): true if `edge` touches the
 * player's own network at either endpoint — an own settlement/city sits on
 * that vertex, or an own road is already incident to it (`VertexTopology.edgeIds`,
 * S1.1.1). A single-hop check is sufficient: the network is built up
 * incrementally, so every prior own road already touched the network when
 * it was placed.
 */
function touchesOwnNetwork(
  edge: EdgeTopology,
  playerId: PlayerId,
  buildings: BuildingsState,
): boolean {
  return edge.vertexIds.some((vertexId) => {
    if (buildings.settlements[vertexId] === playerId) return true;
    if (buildings.cities?.[vertexId] === playerId) return true;
    const vertex = findVertex(topology(), vertexId);
    return (
      vertex?.edgeIds.some((edgeId) => buildings.roads[edgeId] === playerId) ?? false
    );
  });
}

/**
 * Settlement-building road legality (S1.2.2 spec, the gameplay rule setup
 * waives): true if any edge incident to `vertex` is the player's own road.
 */
function touchesOwnRoad(
  vertex: VertexTopology,
  playerId: PlayerId,
  buildings: BuildingsState,
): boolean {
  return vertex.edgeIds.some((edgeId) => buildings.roads[edgeId] === playerId);
}

/** How many of `record`'s entries this player already owns — the piece-supply count (S1.2.2). */
function countOwned(
  record: Readonly<Record<string, PlayerId>> | undefined,
  playerId: PlayerId,
): number {
  if (!record) return 0;
  return Object.values(record).filter((owner) => owner === playerId).length;
}

/**
 * The port contents the player owns (S1.3.3 spec): a port slot is owned if
 * the player holds a settlement or city on EITHER of that slot's edge
 * endpoints. Reuses the S1.1.1 port-slot geometry (`board.ts`'s
 * `portSlots`) paired 1:1 by index with `GameState.board.portContents`
 * (S1.1.2 — see {@link PortContent}'s docstring) — never re-derives either.
 */
function ownedPortContents(state: GameState, playerId: PlayerId): readonly PortContent[] {
  const board = state.board;
  const buildings = state.buildings;
  if (!board || !buildings) return [];
  const owned: PortContent[] = [];
  topology().portSlots.forEach((slot, index) => {
    const edge = findEdge(topology(), slot.edgeId);
    const ownsEndpoint =
      edge?.vertexIds.some(
        (vertexId) =>
          buildings.settlements[vertexId] === playerId ||
          buildings.cities?.[vertexId] === playerId,
      ) ?? false;
    if (!ownsEndpoint) return;
    const content = board.portContents[index];
    if (content) owned.push(content);
  });
  return owned;
}

/**
 * The player's best (lowest) bank-trade rate for GIVING `resource`
 * (S1.3.3 spec): 2:1 if they own a port whose content specifically matches
 * `resource`; else 3:1 if they own ANY generic port; else the
 * always-available 4:1. Owning a 2:1 port for a DIFFERENT resource does
 * NOT help `resource` here — it still falls through to the generic/base
 * rate, exactly like owning no relevant port at all.
 */
function bestBankRate(
  state: GameState,
  playerId: PlayerId,
  resource: ResourceType,
): number {
  const owned = ownedPortContents(state, playerId);
  if (
    owned.some((content) => content.kind === 'resource' && content.resource === resource)
  ) {
    return 2;
  }
  if (owned.some((content) => content.kind === 'generic')) {
    return 3;
  }
  return CLASSIC_BANK_TRADE_PROFILE.baseRate;
}

/** True if `resources` covers every line of `cost` (S1.2.2 affordability check). */
function canAfford(
  resources: Readonly<Record<ResourceType, number>>,
  cost: Readonly<Record<ResourceType, number>>,
): boolean {
  return Object.entries(cost).every(
    ([resource, amount]) => (resources[resource] ?? 0) >= amount,
  );
}

function findPlayer(state: GameState, playerId: PlayerId): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

/**
 * A legal trade bundle (S1.3.2 spec: "non-empty resource bundles"): at
 * least one resource line, every amount a positive integer. Shared by
 * `proposeTrade`/`counterTrade` — an empty or zero/negative-amount bundle
 * is `MALFORMED_INTENT`, the same reason a malformed board reference earns
 * elsewhere in this module.
 */
function isValidTradeBundle(bundle: Readonly<Record<ResourceType, number>>): boolean {
  const entries = Object.entries(bundle);
  if (entries.length === 0) return false;
  return entries.every(([, amount]) => Number.isInteger(amount) && amount > 0);
}

/** Total resource-card count across all kinds — the discard-owing/steal-eligibility measure (S1.3.1). */
function handSize(resources: Readonly<Record<ResourceType, number>>): number {
  return Object.values(resources).reduce((sum, amount) => sum + amount, 0);
}

/**
 * Players who must discard after a 7 (S1.3.1 spec): every player holding
 * >7 resource cards, each owing `floor(handSize / 2)` (the exact multiset
 * to discard is the owing player's OWN choice via `intent.discard`, not
 * computed here). Iterates `state.players`' own fixed array order —
 * deterministic, like every other derivation in this module.
 */
function computePlayersOwingDiscard(state: GameState): PlayerId[] {
  return state.players
    .filter((player) => handSize(player.resources) > 7)
    .map((player) => player.id);
}

/**
 * Expands a hand into one entry per held card, sorted by resource kind —
 * the deterministic ordering the robber steal-pick indexes into (S1.3.1
 * spec: "index into the victim's sorted hand"). Which physical card is
 * "the Nth one" is arbitrary (cards of the same kind are fungible); only a
 * FIXED order matters, so the same `(seed, streamIndex)` always names the
 * same resource kind.
 */
function expandHand(resources: Readonly<Record<ResourceType, number>>): ResourceType[] {
  const hand: ResourceType[] = [];
  for (const resource of Object.keys(resources).sort()) {
    const count = resources[resource] ?? 0;
    for (let i = 0; i < count; i++) hand.push(resource);
  }
  return hand;
}

/** Result of {@link resolveRobberMove}: either the relocate+steal facts, or why it's illegal. */
type RobberMoveResolution =
  | {
      readonly ok: true;
      readonly stolenFrom?: PlayerId;
      readonly stolenResource?: ResourceType;
    }
  | { readonly ok: false; readonly reason: RejectReason };

/**
 * Shared relocate+steal resolution (S1.3.1 spec) — both the 7-roll's
 * `intent.moveRobber` and a played knight's `intent.playDevCard` branch
 * call this, so the legality/steal logic is written exactly once. Pure:
 * never mutates `state`, only computes the facts the eventual
 * {@link RobberMovedEvent} will carry.
 *
 * `stealEventIndex` is the `index` the resulting `robber.moved` EVENT will
 * carry — not necessarily `state.eventIndex` (the knight path pairs it
 * right after a {@link KnightPlayedEvent}, so it's `state.eventIndex + 1`
 * there) — because the steal-pick's PRNG stream index is keyed to that
 * event's own position in the log (`docs/wiki/rng-stream-map.md` §1), the
 * same discipline `intent.rollDice` uses for dice draws.
 */
function resolveRobberMove(
  state: GameState,
  seed: Seed,
  stealEventIndex: number,
  playerId: PlayerId,
  tileId: TileId,
  victimId: PlayerId | undefined,
): RobberMoveResolution {
  const board = state.board;
  if (!board) {
    return { ok: false, reason: 'MALFORMED_INTENT' };
  }
  if (tileId === board.robberTileId) {
    return { ok: false, reason: 'ROBBER_SAME_TILE' };
  }
  const tile = findTile(topology(), tileId);
  if (!tile) {
    return { ok: false, reason: 'MALFORMED_INTENT' };
  }

  const buildings = state.buildings ?? { settlements: {}, roads: {} };
  const eligibleOwners: PlayerId[] = [];
  for (const vertexId of tile.vertexIds) {
    const owner = buildings.cities?.[vertexId] ?? buildings.settlements[vertexId];
    if (owner !== undefined && owner !== playerId && !eligibleOwners.includes(owner)) {
      eligibleOwners.push(owner);
    }
  }
  const eligibleWithCards = eligibleOwners.filter(
    (id) => handSize(findPlayer(state, id)?.resources ?? {}) > 0,
  );

  if (eligibleWithCards.length === 0) {
    // Documented no-op (S1.3.1 spec): nobody adjacent to the new tile has a
    // card to steal, regardless of whether a victimId was even named.
    return { ok: true };
  }
  if (victimId === undefined || !eligibleOwners.includes(victimId)) {
    return { ok: false, reason: 'NO_SUCH_VICTIM' };
  }
  const hand = expandHand(findPlayer(state, victimId)?.resources ?? {});
  if (hand.length === 0) {
    return { ok: false, reason: 'VICTIM_HAS_NO_CARDS' };
  }

  // Fair-RNG draw (S1.3.1): the same `gameplayStreamIndex` scheme dice
  // rolls use, keyed to `stealEventIndex` — recomputable by anyone with the
  // revealed seed from the event log alone (commit-reveal,
  // `docs/wiki/fair-rng-commit-reveal.md`).
  const draw = deriveValue(
    seed,
    gameplayStreamIndex(stealEventIndex, GAMEPLAY_SLOT.STEAL),
  );
  const stolenResource = hand[Math.floor(draw * hand.length)] as ResourceType;
  return { ok: true, stolenFrom: victimId, stolenResource };
}

/**
 * The second-settlement resource grant (S1.1.3 spec): 1 resource per
 * adjacent producing tile, desert pays nothing. Empty if `board` is absent
 * (defensive — setup should never reach placement before `board.generated`).
 */
function settlementPayout(
  vertex: VertexTopology,
  board: GameState['board'],
): Record<ResourceType, number> {
  const payout: Record<ResourceType, number> = {};
  if (!board) return payout;
  for (const tileId of vertex.adjacentTileIds) {
    const kind = board.tileKinds[tileId];
    if (kind === undefined || kind === 'desert') continue;
    payout[kind] = (payout[kind] ?? 0) + 1;
  }
  return payout;
}

/** Result of {@link computeProduction}: facts destined for `resources.produced` (ADR-0003). */
interface ProductionResult {
  readonly grants: Record<PlayerId, Record<ResourceType, number>>;
  readonly bank: Record<ResourceType, number>;
}

/**
 * Resolves one roll's Classic production (S1.2.1 spec): for every
 * non-desert tile bearing `total` that the robber is NOT sitting on, each
 * adjacent settlement's owner earns 1 of that tile's resource. Bank
 * exhaustion is all-or-nothing per resource type — if the bank can't pay
 * the FULL amount owed of a resource to every entitled player this roll,
 * nobody gets that resource this roll. Returns empty grants (bank
 * unchanged) if `board`/`buildings` are absent — never throws.
 *
 * A city (S1.2.2, `BuildingsState.cities`) pays double a settlement — see
 * the `amount` line below (this fills the seam an earlier TODO left here
 * before cities existed).
 */
function computeProduction(state: GameState, total: number): ProductionResult {
  const board = state.board;
  const buildings = state.buildings;

  // owed[resource][playerId] = amount owed to that player this roll, summed
  // across every producing, unblocked tile of that resource.
  const owed: Record<ResourceType, Record<PlayerId, number>> = {};
  if (board && buildings) {
    for (const tile of topology().tiles) {
      const kind = board.tileKinds[tile.id];
      if (kind === undefined || kind === 'desert') continue;
      if (board.tileTokens[tile.id] !== total) continue;
      if (tile.id === board.robberTileId) continue; // robber blocks the tile entirely

      for (const vertexId of tile.vertexIds) {
        const cityOwner = buildings.cities?.[vertexId];
        const owner = cityOwner ?? buildings.settlements[vertexId];
        if (owner === undefined) continue;
        const amount = cityOwner !== undefined ? 2 : 1; // S1.2.2: a city pays double
        owed[kind] ??= {};
        owed[kind][owner] = (owed[kind][owner] ?? 0) + amount;
      }
    }
  }

  const grants: Record<PlayerId, Record<ResourceType, number>> = {};
  const bank: Record<ResourceType, number> = { ...(state.bank ?? {}) };

  for (const [resource, byPlayer] of Object.entries(owed)) {
    const totalOwed = Object.values(byPlayer).reduce((sum, amount) => sum + amount, 0);
    const available = bank[resource] ?? CLASSIC_PRODUCTION_PROFILE.bankPerResource;
    if (totalOwed > available) continue; // all-or-nothing: bank can't cover it, nobody gets it

    bank[resource] = available - totalOwed;
    for (const [playerId, amount] of Object.entries(byPlayer)) {
      grants[playerId] ??= {};
      grants[playerId][resource] = (grants[playerId][resource] ?? 0) + amount;
    }
  }

  return { grants, bank };
}

/**
 * Validates a player's {@link PlayerIntent} against the current
 * {@link GameState} and turns it into the {@link GameEvent}s that should be
 * applied via {@link reduce}, or refuses it with a {@link RejectReason}.
 * `playerId` is the server-authenticated actor for this request — it is
 * checked against `intent.playerId` so a spoofed payload is caught even
 * though the network layer already knows who is asking (ADR-0003 /
 * server-authority).
 *
 * `seed` is the match's raw PRNG seed — a **server secret** that drives the
 * commit-reveal fair RNG (`docs/wiki/fair-rng-commit-reveal.md`). It is
 * passed in rather than read from `state` on purpose: `GameState` carries
 * only `seedHash` (the public commit) and is serialized to clients, so
 * putting the raw seed there would let a client predict every future roll
 * and defeat the whole scheme. Randomness is derived as
 * `rollDie(seed, state.eventIndex)` — pure indexing into the seed stream,
 * never an ambient draw (ADR-0003).
 *
 * Pure and deterministic: never throws for an expected rejection.
 */
export function validate(
  state: GameState,
  intent: PlayerIntent,
  playerId: PlayerId,
  seed: Seed,
): ValidateResult {
  if (intent.playerId !== playerId) {
    return reject('MALFORMED_INTENT');
  }
  if (!state.players.some((player) => player.id === playerId)) {
    return reject('UNKNOWN_PLAYER');
  }
  // Phase-guard layer (S1.2.4, extended S1.3.1): every intent is legal in
  // exactly one canonical phase (or, for the knight, two). Setup-only
  // intents (the snake draft, S1.1.3) require 'setup'; `intent.rollDice`
  // requires 'roll' (the turn's mandatory first step — attempting a 2nd roll
  // means phase has already advanced to 'main', which earns the more
  // specific ALREADY_ROLLED over a generic INVALID_PHASE); `intent.discard`/
  // `intent.moveRobber` require the 'robber' seam a rolled 7 enters
  // (S1.3.1); playing a knight is legal from EITHER 'roll' or 'main' (Classic
  // allows a knight before or after rolling, unlike every other dev card);
  // every remaining intent (endTurn, build*, buyDevCard, non-knight
  // playDevCard) is the post-roll 'main' group — attempting one from 'roll'
  // earns MUST_ROLL_FIRST, this guard's other named reason. Any phase
  // outside an intent's legal/adjacent pair (mid-setup, 'finished', ...)
  // falls through to the generic INVALID_PHASE, same as before this story.
  const isSetupIntent =
    intent.type === 'intent.placeSettlement' || intent.type === 'intent.placeRoad';
  const isKnightPlay = intent.type === 'intent.playDevCard' && intent.card === 'knight';
  if (isSetupIntent) {
    if (state.phase !== 'setup') {
      return reject('INVALID_PHASE');
    }
  } else if (intent.type === 'intent.rollDice') {
    if (state.phase === 'main') {
      return reject('ALREADY_ROLLED');
    }
    if (state.phase !== 'roll') {
      return reject('INVALID_PHASE');
    }
  } else if (intent.type === 'intent.discard' || intent.type === 'intent.moveRobber') {
    if (state.phase !== 'robber') {
      return reject('NOT_IN_ROBBER_PHASE');
    }
  } else if (isKnightPlay) {
    if (state.phase !== 'roll' && state.phase !== 'main') {
      return reject('INVALID_PHASE');
    }
  } else {
    if (state.phase === 'roll') {
      return reject('MUST_ROLL_FIRST');
    }
    if (state.phase !== 'main') {
      return reject('INVALID_PHASE');
    }
  }
  // `intent.discard` and the trade-response/lifecycle intents are the
  // exceptions to "only the current player acts": several players may owe a
  // discard in the same 7-resolution, in any order (S1.3.1 spec); a trade's
  // targets (accept/reject/counter) are, by construction, every OTHER
  // player, and after a `counterTrade` the open offer's own proposer
  // (eligible to `cancelTrade` it) may likewise be a non-current player
  // (S1.3.2 spec) — each checked instead inside its own branch below
  // (`openTradeOffer.targets`/`proposerId` membership). `intent.proposeTrade`
  // itself stays in the normal current-player-only group.
  const isTradeResponseOrLifecycle =
    intent.type === 'intent.acceptTrade' ||
    intent.type === 'intent.rejectTrade' ||
    intent.type === 'intent.counterTrade' ||
    intent.type === 'intent.cancelTrade';
  if (
    intent.type !== 'intent.discard' &&
    !isTradeResponseOrLifecycle &&
    state.currentPlayerId !== playerId
  ) {
    return reject('NOT_YOUR_TURN');
  }

  switch (intent.type) {
    case 'intent.rollDice': {
      // Fair-RNG draw: Classic play is 2d6, each die its own slot of the
      // gameplay stream (S1.2.1 scheme, `docs/wiki/rng-stream-map.md` §1) —
      // `gameplayStreamIndex(state.eventIndex, slot)` — so anyone with the
      // revealed seed can recompute both faces from the public event log
      // post-match (commit-reveal, `docs/wiki/fair-rng-commit-reveal.md`).
      // No ambient randomness (ADR-0003).
      const dieA = rollDie(
        seed,
        gameplayStreamIndex(state.eventIndex, GAMEPLAY_SLOT.DICE_A),
      );
      const dieB = rollDie(
        seed,
        gameplayStreamIndex(state.eventIndex, GAMEPLAY_SLOT.DICE_B),
      );
      const total = dieA + dieB;
      const diceEvent: DiceRolledEvent = {
        type: 'dice.rolled',
        index: state.eventIndex,
        playerId,
        dieA,
        dieB,
        total,
      };

      // A 7 moves the robber (S1.3.1): production is a deliberate no-op
      // (nobody's tiles pay out while the robber relocates) — only
      // `dice.rolled` is emitted, no `resources.produced`. `playersToDiscard`
      // is computed HERE (a fact `reduce` only applies, never recomputes,
      // ADR-0003) and carried on the event even when empty — `reduce.ts`'s
      // `dice.rolled` case reads it to decide whether the turn FSM enters the
      // `'robber'` phase seam (S1.2.4) still waiting on discards, or can go
      // straight to a `moveRobber` (nobody happened to be holding >7 cards).
      if (total === 7) {
        const playersToDiscard = computePlayersOwingDiscard(state);
        return {
          ok: true,
          events: [{ ...diceEvent, playersToDiscard }],
        };
      }

      const production = computeProduction(state, total);
      const producedEvent: ResourcesProducedEvent = {
        type: 'resources.produced',
        index: state.eventIndex + 1,
        grants: production.grants,
        bank: production.bank,
      };
      return { ok: true, events: [diceEvent, producedEvent] };
    }
    case 'intent.endTurn': {
      // Rotation reads the explicit seat order (S1.2.4), not `state.players`'
      // incidental array order (see {@link seatOrder}).
      const order = seatOrder(state);
      const currentIndex = order.indexOf(playerId);
      const nextPlayerId = order[(currentIndex + 1) % order.length];
      if (nextPlayerId === undefined) {
        // Unreachable: the membership check above already guarantees
        // `playerId` (and therefore `currentIndex`) is valid and
        // `order.length >= 1`. Guarded defensively instead of asserted
        // away, so a future regression rejects rather than throws.
        return reject('UNKNOWN_PLAYER');
      }
      const event: TurnEndedEvent = {
        type: 'turn.ended',
        index: state.eventIndex,
        playerId,
        nextPlayerId,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.placeSettlement': {
      // A settlement is already pending its road — this player's draft turn
      // isn't over, so a second settlement is out of sequence.
      if (state.pendingRoadVertexId !== undefined) {
        return reject('WRONG_PHASE');
      }
      const vertex = findVertex(topology(), intent.vertexId);
      if (!vertex) {
        return reject('MALFORMED_INTENT');
      }

      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      if (buildings.settlements[intent.vertexId] !== undefined) {
        return reject('OCCUPIED');
      }
      // Distance rule (setup phase has no road-connection requirement,
      // unlike the S1.2.2 build branch below).
      if (violatesDistanceRule(vertex, buildings)) {
        return reject('DISTANCE_VIOLATION');
      }

      const priorSettlements = Object.values(buildings.settlements).filter(
        (owner) => owner === playerId,
      ).length;
      const isSecondSettlement =
        priorSettlements === CLASSIC_SETUP_PROFILE.settlementsPerPlayer - 1;
      const payout = isSecondSettlement ? settlementPayout(vertex, state.board) : {};

      const event: SettlementPlacedEvent = {
        type: 'settlement.placed',
        index: state.eventIndex,
        playerId,
        vertexId: intent.vertexId,
        payout,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.placeRoad': {
      const pendingVertexId = state.pendingRoadVertexId;
      // No settlement placed yet this draft turn — nothing to attach a road to.
      if (pendingVertexId === undefined) {
        return reject('WRONG_PHASE');
      }
      const edge = findEdge(topology(), intent.edgeId);
      if (!edge) {
        return reject('MALFORMED_INTENT');
      }

      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      if (buildings.roads[intent.edgeId] !== undefined) {
        return reject('OCCUPIED');
      }
      if (!edge.vertexIds.includes(pendingVertexId)) {
        return reject('DETACHED_ROAD');
      }

      // This turn's road completes the draft turn — work out who (and what
      // phase) comes next so `reduce` only ever applies a fact (ADR-0003).
      // The draft order derives from the explicit seat order (S1.2.4), not
      // `state.players`' incidental array order (see {@link seatOrder}).
      const order = snakeOrder(seatOrder(state));
      const completedTurns = Object.keys(buildings.roads).length;
      const nextStep = completedTurns + 1;
      const isLastTurn = nextStep >= order.length;
      // The draft's very last road hands the turn back to P1 — into the
      // normal turn loop's 'roll' phase (S1.2.4: the FSM's mandatory first
      // step), not directly 'main' as before this story.
      const nextPlayerId = (isLastTurn ? order[0] : order[nextStep]) as PlayerId;
      const nextPhase: GamePhase = isLastTurn ? 'roll' : 'setup';

      const event: RoadPlacedEvent = {
        type: 'road.placed',
        index: state.eventIndex,
        playerId,
        edgeId: intent.edgeId,
        nextPlayerId,
        nextPhase,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.buildRoad': {
      const edge = findEdge(topology(), intent.edgeId);
      if (!edge) {
        return reject('MALFORMED_INTENT');
      }

      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      if (buildings.roads[intent.edgeId] !== undefined) {
        return reject('OCCUPIED');
      }
      if (!touchesOwnNetwork(edge, playerId, buildings)) {
        return reject('NOT_CONNECTED');
      }
      if (countOwned(buildings.roads, playerId) >= CLASSIC_BUILD_PROFILE.supply.roads) {
        return reject('SUPPLY_EXHAUSTED');
      }

      const cost = CLASSIC_BUILD_PROFILE.costs.road;
      const player = findPlayer(state, playerId);
      if (!player || !canAfford(player.resources, cost)) {
        return reject('CANNOT_AFFORD');
      }

      const event: RoadBuiltEvent = {
        type: 'road.built',
        index: state.eventIndex,
        playerId,
        edgeId: intent.edgeId,
        cost,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.buildSettlement': {
      const vertex = findVertex(topology(), intent.vertexId);
      if (!vertex) {
        return reject('MALFORMED_INTENT');
      }

      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      if (
        buildings.settlements[intent.vertexId] !== undefined ||
        buildings.cities?.[intent.vertexId] !== undefined
      ) {
        return reject('OCCUPIED');
      }
      // Distance rule reuses the S1.1.3 helper; the road-connection check is
      // the gameplay rule setup waives (S1.2.2 spec).
      if (violatesDistanceRule(vertex, buildings)) {
        return reject('DISTANCE_VIOLATION');
      }
      if (!touchesOwnRoad(vertex, playerId, buildings)) {
        return reject('NOT_CONNECTED');
      }
      if (
        countOwned(buildings.settlements, playerId) >=
        CLASSIC_BUILD_PROFILE.supply.settlements
      ) {
        return reject('SUPPLY_EXHAUSTED');
      }

      const cost = CLASSIC_BUILD_PROFILE.costs.settlement;
      const player = findPlayer(state, playerId);
      if (!player || !canAfford(player.resources, cost)) {
        return reject('CANNOT_AFFORD');
      }

      const event: SettlementBuiltEvent = {
        type: 'settlement.built',
        index: state.eventIndex,
        playerId,
        vertexId: intent.vertexId,
        cost,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.buildCity': {
      const vertex = findVertex(topology(), intent.vertexId);
      if (!vertex) {
        return reject('MALFORMED_INTENT');
      }

      const buildings = state.buildings ?? { settlements: {}, roads: {} };
      // A city upgrades the player's OWN existing settlement — this also
      // covers "vertex is empty" and "vertex already a city" (a city vertex
      // is no longer a key in `settlements`, see BuildingsState docstring),
      // both correctly read as "you have no settlement here".
      if (buildings.settlements[intent.vertexId] !== playerId) {
        return reject('NOT_OWN_SETTLEMENT');
      }
      if (countOwned(buildings.cities, playerId) >= CLASSIC_BUILD_PROFILE.supply.cities) {
        return reject('SUPPLY_EXHAUSTED');
      }

      const cost = CLASSIC_BUILD_PROFILE.costs.city;
      const player = findPlayer(state, playerId);
      if (!player || !canAfford(player.resources, cost)) {
        return reject('CANNOT_AFFORD');
      }

      const event: CityBuiltEvent = {
        type: 'city.built',
        index: state.eventIndex,
        playerId,
        vertexId: intent.vertexId,
        cost,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.buyDevCard': {
      const cost = CLASSIC_DEV_CARD_PROFILE.buyCost;
      const player = findPlayer(state, playerId);
      if (!player || !canAfford(player.resources, cost)) {
        return reject('CANNOT_AFFORD');
      }

      const deckSize = CLASSIC_DEV_CARD_PROFILE.deck.length;
      const remainingBefore = state.devDeckRemaining ?? deckSize;
      if (remainingBefore <= 0) {
        return reject('DECK_EMPTY');
      }

      // Same "recompute from seed, never store the order" discipline as
      // dice rolls (`devcards.ts` docstring) — the draw index is simply how
      // many cards have already left the deck.
      const drawIndex = deckSize - remainingBefore;
      const card = shuffledDevDeck(seed)[drawIndex] as DevCardKind;

      const event: DevCardBoughtEvent = {
        type: 'devCard.bought',
        index: state.eventIndex,
        playerId,
        card,
        cost,
        deckRemaining: remainingBefore - 1,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.playDevCard': {
      // Un-deferred as of S1.3.1: the knight now shares the SAME
      // one-per-turn / not-bought-this-turn gating every other dev card
      // goes through below — it just also, uniquely, routes through the
      // robber's relocate+steal resolution afterward (see the `case
      // 'knight':` branch).
      if (state.devCardPlayedThisTurn) {
        return reject('DEV_CARD_ALREADY_PLAYED');
      }
      const holdings = state.devCards?.[playerId];
      const held = holdings?.held[intent.card] ?? 0;
      if (held <= 0) {
        return reject('CARD_NOT_HELD');
      }
      const boughtThisTurn = holdings?.boughtThisTurn[intent.card] ?? 0;
      if (held - boughtThisTurn <= 0) {
        return reject('BOUGHT_THIS_TURN');
      }

      switch (intent.card) {
        case 'knight': {
          // The knight never triggers a discard step (S1.3.1 spec) — it
          // resolves relocate+steal in the SAME `validate` call, emitting 2
          // events: `devCard.knightPlayed` (consumes the card, bumps the
          // knight counter, enters the `'robber'` phase seam — mirrors
          // `dice.rolled`'s zero-duration production pass-through) then
          // `robber.moved` at `state.eventIndex + 1` (the actual move+steal
          // — the steal-pick's stream index is keyed to THIS event's own
          // position, see {@link resolveRobberMove}). `nextPhase` carries
          // the phase we were in BEFORE this play ('roll' pre-roll or
          // 'main' post-roll, Classic allows either) so the turn resumes
          // exactly where it left off.
          const resolution = resolveRobberMove(
            state,
            seed,
            state.eventIndex + 1,
            playerId,
            intent.tileId,
            intent.victimId,
          );
          if (!resolution.ok) {
            return reject(resolution.reason);
          }
          const knightEvent: KnightPlayedEvent = {
            type: 'devCard.knightPlayed',
            index: state.eventIndex,
            playerId,
          };
          const moveEvent: RobberMovedEvent = {
            type: 'robber.moved',
            index: state.eventIndex + 1,
            playerId,
            tileId: intent.tileId,
            nextPhase: state.phase,
            ...(resolution.stolenFrom !== undefined
              ? {
                  stolenFrom: resolution.stolenFrom,
                  stolenResource: resolution.stolenResource,
                }
              : {}),
          };
          return { ok: true, events: [knightEvent, moveEvent] };
        }
        case 'roadBuilding': {
          const buildings = state.buildings ?? { settlements: {}, roads: {} };
          const workingRoads: Record<EdgeId, PlayerId> = { ...buildings.roads };
          let ownedRoads = countOwned(buildings.roads, playerId);
          const edgeIds: EdgeId[] = [];
          for (const edgeId of intent.edgeIds) {
            if (edgeIds.length >= 2) break; // road-building grants at most 2 roads
            const edge = findEdge(topology(), edgeId);
            if (!edge) {
              return reject('MALFORMED_INTENT');
            }
            if (workingRoads[edgeId] !== undefined) continue; // occupied — place fewer
            if (ownedRoads >= CLASSIC_BUILD_PROFILE.supply.roads) break; // supply exhausted
            if (
              !touchesOwnNetwork(edge, playerId, {
                settlements: buildings.settlements,
                roads: workingRoads,
                ...(buildings.cities ? { cities: buildings.cities } : {}),
              })
            ) {
              continue; // detached from the network so far — place fewer
            }
            workingRoads[edgeId] = playerId;
            ownedRoads += 1;
            edgeIds.push(edgeId);
          }

          const event: RoadBuildingPlayedEvent = {
            type: 'devCard.roadBuildingPlayed',
            index: state.eventIndex,
            playerId,
            edgeIds,
          };
          return { ok: true, events: [event] };
        }
        case 'yearOfPlenty': {
          const bank = { ...(state.bank ?? {}) };
          const requested: Record<ResourceType, number> = {};
          for (const resource of intent.resources) {
            requested[resource] = (requested[resource] ?? 0) + 1;
          }
          for (const [resource, amount] of Object.entries(requested)) {
            const available =
              bank[resource] ?? CLASSIC_PRODUCTION_PROFILE.bankPerResource;
            if (available < amount) {
              return reject('BANK_EXHAUSTED');
            }
          }
          for (const [resource, amount] of Object.entries(requested)) {
            bank[resource] =
              (bank[resource] ?? CLASSIC_PRODUCTION_PROFILE.bankPerResource) - amount;
          }

          const event: YearOfPlentyPlayedEvent = {
            type: 'devCard.yearOfPlentyPlayed',
            index: state.eventIndex,
            playerId,
            resources: requested,
            bank,
          };
          return { ok: true, events: [event] };
        }
        case 'monopoly': {
          const resource = intent.resource;
          const transfers: Record<PlayerId, number> = {};
          for (const other of state.players) {
            if (other.id === playerId) continue;
            const amount = other.resources[resource] ?? 0;
            if (amount > 0) transfers[other.id] = amount;
          }

          const event: MonopolyPlayedEvent = {
            type: 'devCard.monopolyPlayed',
            index: state.eventIndex,
            playerId,
            resource,
            transfers,
          };
          return { ok: true, events: [event] };
        }
        default: {
          const exhaustive: never = intent;
          throw new Error(
            `unhandled playDevCard card kind: ${JSON.stringify(exhaustive)}`,
          );
        }
      }
    }
    case 'intent.discard': {
      // Any owing player may discard, in any order (S1.3.1 spec) — the
      // top-level guard above deliberately skipped the `currentPlayerId`
      // check for this intent; ownership is checked here instead.
      const owing = state.playersToDiscard ?? [];
      if (!owing.includes(playerId)) {
        return reject('NOT_OWED_DISCARD');
      }
      const player = findPlayer(state, playerId);
      if (!player) {
        return reject('UNKNOWN_PLAYER'); // unreachable: membership already checked above
      }
      const required = Math.floor(handSize(player.resources) / 2);
      const requestedTotal = handSize(intent.resources);
      if (requestedTotal !== required) {
        return reject('WRONG_DISCARD_COUNT');
      }
      if (!canAfford(player.resources, intent.resources)) {
        return reject('CANNOT_AFFORD');
      }

      const event: ResourcesDiscardedEvent = {
        type: 'resources.discarded',
        index: state.eventIndex,
        playerId,
        resources: intent.resources,
        remainingToDiscard: owing.filter((id) => id !== playerId),
      };
      return { ok: true, events: [event] };
    }
    case 'intent.moveRobber': {
      // Only reachable once every owing player has discarded (S1.3.1 spec)
      // — a knight play never leaves this window open, it resolves
      // relocate+steal in its own single `validate` call (see the
      // `playDevCard` knight branch above), so this intent is exclusively
      // the 7-roll path's finishing move. `nextPhase` is therefore always
      // `'main'`: rolling — 7 or not — already consumed this turn's roll.
      if ((state.playersToDiscard ?? []).length > 0) {
        return reject('MUST_DISCARD_FIRST');
      }
      const resolution = resolveRobberMove(
        state,
        seed,
        state.eventIndex,
        playerId,
        intent.tileId,
        intent.victimId,
      );
      if (!resolution.ok) {
        return reject(resolution.reason);
      }
      const event: RobberMovedEvent = {
        type: 'robber.moved',
        index: state.eventIndex,
        playerId,
        tileId: intent.tileId,
        nextPhase: 'main',
        ...(resolution.stolenFrom !== undefined
          ? {
              stolenFrom: resolution.stolenFrom,
              stolenResource: resolution.stolenResource,
            }
          : {}),
      };
      return { ok: true, events: [event] };
    }
    case 'intent.proposeTrade': {
      // One open offer at a time (M1 simplification, S1.3.2 spec).
      if (state.openTradeOffer) {
        return reject('TRADE_OFFER_ALREADY_OPEN');
      }
      if (!isValidTradeBundle(intent.give) || !isValidTradeBundle(intent.get)) {
        return reject('MALFORMED_INTENT');
      }
      const proposer = findPlayer(state, playerId);
      if (!proposer || !canAfford(proposer.resources, intent.give)) {
        return reject('CANNOT_AFFORD');
      }
      // All other players (M1: no named subset, S1.3.2 spec).
      const targets = state.players
        .map((player) => player.id)
        .filter((id) => id !== playerId);

      const event: TradeOfferedEvent = {
        type: 'trade.offered',
        index: state.eventIndex,
        proposerId: playerId,
        give: intent.give,
        get: intent.get,
        targets,
        depth: 0,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.acceptTrade': {
      const offer = state.openTradeOffer;
      if (!offer) {
        return reject('NO_OPEN_TRADE_OFFER');
      }
      if (!offer.targets.includes(playerId)) {
        return reject('NOT_A_TRADE_TARGET');
      }
      const accepter = findPlayer(state, playerId);
      if (!accepter || !canAfford(accepter.resources, offer.get)) {
        return reject('CANNOT_AFFORD');
      }
      // Re-check the PROPOSER's affordability too, at accept time — the
      // offer may have sat open across other main-phase actions (build,
      // dev-card play, ...) that could have spent what they offered to give
      // since the offer opened. Atomicity means never emitting a swap
      // either side can't actually pay (S1.3.2 spec).
      const proposer = findPlayer(state, offer.proposerId);
      if (!proposer || !canAfford(proposer.resources, offer.give)) {
        return reject('CANNOT_AFFORD');
      }

      const event: TradeExecutedEvent = {
        type: 'trade.executed',
        index: state.eventIndex,
        proposerId: offer.proposerId,
        accepterId: playerId,
        give: offer.give,
        get: offer.get,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.rejectTrade': {
      const offer = state.openTradeOffer;
      if (!offer) {
        return reject('NO_OPEN_TRADE_OFFER');
      }
      if (!offer.targets.includes(playerId)) {
        return reject('NOT_A_TRADE_TARGET');
      }

      const event: TradeRejectedEvent = {
        type: 'trade.rejected',
        index: state.eventIndex,
        playerId,
        remainingTargets: offer.targets.filter((id) => id !== playerId),
      };
      return { ok: true, events: [event] };
    }
    case 'intent.counterTrade': {
      const offer = state.openTradeOffer;
      if (!offer) {
        return reject('NO_OPEN_TRADE_OFFER');
      }
      if (!offer.targets.includes(playerId)) {
        return reject('NOT_A_TRADE_TARGET');
      }
      // Counter bound (S1.3.2 spec): only the ORIGINAL proposal (depth 0)
      // may be countered — the resulting counter-offer (depth 1) can only
      // be accepted/rejected/cancelled, never countered again.
      if (offer.depth >= 1) {
        return reject('TRADE_COUNTER_LIMIT_REACHED');
      }
      if (!isValidTradeBundle(intent.give) || !isValidTradeBundle(intent.get)) {
        return reject('MALFORMED_INTENT');
      }
      const counterer = findPlayer(state, playerId);
      if (!counterer || !canAfford(counterer.resources, intent.give)) {
        return reject('CANNOT_AFFORD');
      }

      // Swapped roles (S1.3.2 spec): the counterer becomes the new
      // proposer, targeting only the original proposer.
      const event: TradeOfferedEvent = {
        type: 'trade.offered',
        index: state.eventIndex,
        proposerId: playerId,
        give: intent.give,
        get: intent.get,
        targets: [offer.proposerId],
        depth: offer.depth + 1,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.cancelTrade': {
      const offer = state.openTradeOffer;
      if (!offer) {
        return reject('NO_OPEN_TRADE_OFFER');
      }
      if (offer.proposerId !== playerId) {
        return reject('NOT_TRADE_PROPOSER');
      }

      const event: TradeCancelledEvent = {
        type: 'trade.cancelled',
        index: state.eventIndex,
        playerId,
      };
      return { ok: true, events: [event] };
    }
    case 'intent.bankTrade': {
      if (!Number.isInteger(intent.count) || intent.count <= 0) {
        return reject('MALFORMED_INTENT');
      }
      // Rate check first: independent of the player's own hand, so a
      // wrong `count` earns the specific WRONG_RATE_COUNT reason rather
      // than a misleading CANNOT_AFFORD if it happens to also be too much.
      const rate = bestBankRate(state, playerId, intent.give);
      if (intent.count !== rate) {
        return reject('WRONG_RATE_COUNT');
      }
      const player = findPlayer(state, playerId);
      if (!player || !canAfford(player.resources, { [intent.give]: intent.count })) {
        return reject('CANNOT_AFFORD');
      }

      const bank = { ...(state.bank ?? {}) };
      const availableGet = bank[intent.get] ?? CLASSIC_PRODUCTION_PROFILE.bankPerResource;
      if (availableGet < 1) {
        return reject('BANK_EXHAUSTED');
      }
      // `give`'s pool is read back off `nextBank` (not the pre-trade
      // `bank`) so a same-resource trade (give === get, degenerate but not
      // forbidden) nets out correctly instead of double-counting.
      const nextBank = { ...bank };
      nextBank[intent.get] = availableGet - 1;
      nextBank[intent.give] =
        (nextBank[intent.give] ?? CLASSIC_PRODUCTION_PROFILE.bankPerResource) +
        intent.count;

      const tradeEvent: BankTradedEvent = {
        type: 'bank.trade',
        index: state.eventIndex,
        playerId,
        give: intent.give,
        count: intent.count,
        get: intent.get,
        bank: nextBank,
      };
      return { ok: true, events: [tradeEvent] };
    }
    default: {
      const exhaustive: never = intent;
      throw new Error(`unhandled intent type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
