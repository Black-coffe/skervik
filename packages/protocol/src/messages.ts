// @skervik/protocol — the WS message envelope (E1.4 S1.4.1) + its zod runtime
// schemas (E1.5 S1.5.1, ADR-0009 Fork 4). This is the ONE shared wire shape
// server and client import instead of each declaring their own format and
// drifting apart. The zod schemas enforce that contract at the trust boundary
// (the server zod-parses every inbound message BEFORE core `validate`); core
// `validate` stays the authoritative SEMANTIC validator — zod only checks the
// WIRE SHAPE (envelope well-formed, known `type`, payload structurally valid),
// never game rules (turn / affordability / adjacency …).
import type { GameEvent, GameState, PlayerIntent, RejectReason } from '@skervik/core';
import { z } from 'zod';

/**
 * The public projection of `GameState` sent as `state.snapshot`'s payload.
 * Safe to serialize by construction: `GameState` never holds the raw seed
 * (only `seedHash` is a field — ADR-0009 Fork 3, `docs/wiki/seed-handling.md`).
 */
export type PublicGameState = GameState;

/** Client → server: a player's wish, validated server-side (S1.4.2 owns handling it). */
export interface IntentMessage {
  readonly v: 1;
  readonly type: 'intent';
  readonly payload: PlayerIntent;
}

/** Server → clients: validated events, folded through each client's own `reduce` (ADR-0009 Fork 1). */
export interface EventBatchMessage {
  readonly v: 1;
  readonly type: 'event.batch';
  readonly payload: readonly GameEvent[];
}

/** Server → one joining/late-joining client: a one-shot full public state (S1.4.1). */
export interface StateSnapshotMessage {
  readonly v: 1;
  readonly type: 'state.snapshot';
  readonly payload: PublicGameState;
}

/**
 * Server → ONLY the sender: an intent `validate` refused (S1.4.2). Sent
 * privately (never broadcast — a rejection is not a state change) and carries
 * only the public {@link RejectReason} — never the seed, never any state
 * (`validate` never returns the seed, ADR-0009 Fork 3).
 */
export interface RejectMessage {
  readonly v: 1;
  readonly type: 'intent.rejected';
  readonly payload: { readonly reason: RejectReason };
}

/**
 * Server → ONLY the sender: a validated batch could NOT be durably recorded
 * (sink rejection or an unexpected internal throw, S1.4.4b). Distinct from
 * {@link RejectMessage} — this is an infrastructure failure, and the
 * authoritative state was NOT advanced. Never carries a seed or any state.
 */
export interface ErrorMessage {
  readonly v: 1;
  readonly type: 'intent.error';
  readonly payload: { readonly code: 'INTERNAL_ERROR' };
}

/**
 * Server → a client REJECTED at join (S1.5.2): its `protocolVersion` is
 * incompatible with the server's `PROTOCOL_VERSION`, so the join is refused
 * before any seat is assigned. Delivered as the JSON body of the Colyseus
 * `ServerError` thrown from the room's `onAuth` (the incompatible client never
 * enters the room), authored as a typed protocol message so E1.6's client can
 * `JSON.parse` + validate it and render a precise "update required" prompt.
 * `clientVersion` is the raw string the client presented, or `null` when it was
 * missing / non-string. `code` is a stable MACHINE value — ADR-0008 i18n
 * applies to the client's rendering of it (E1.6), not to this wire field.
 */
export interface VersionErrorMessage {
  readonly v: 1;
  readonly type: 'error.version';
  readonly payload: {
    readonly code: 'PROTOCOL_VERSION_MISMATCH';
    readonly serverVersion: string;
    readonly clientVersion: string | null;
  };
}

/** The discriminated union of every message that crosses the WS boundary. */
export type WsMessage =
  | IntentMessage
  | EventBatchMessage
  | StateSnapshotMessage
  | RejectMessage
  | ErrorMessage
  | VersionErrorMessage;

// ===========================================================================
// zod runtime schemas (S1.5.1)
// ===========================================================================
//
// DRIFT PIN (the point of this story): core (`@skervik/core`) owns the
// canonical `PlayerIntent` / `GameEvent` TS unions. The schemas below must not
// become a silently-diverging second representation. The per-variant schemas
// are combined with `z.discriminatedUnion` and then PINNED to core at compile
// time by the `*_VARIANT_PIN` type-level assertions further down: a new (or
// removed) core intent/event variant flips a pin's `Equals<…>` to `false`,
// which fails `AssertTrue<false>` → the protocol typecheck/build breaks until
// the schema is updated. See `messages.test.ts` for the runtime coverage that
// each valid variant sample actually parses.

/** `Readonly<Record<ResourceType | PlayerId, number>>` — the ubiquitous count map. */
const CountMapSchema = z.record(z.string(), z.number());

/** {@link GamePhase} — every lifecycle stage a `nextPhase`/`state.snapshot` can carry. */
const GamePhaseSchema = z.enum(['lobby', 'setup', 'roll', 'main', 'robber', 'finished']);

/** {@link DevCardKind} — the drawn/held card identity on `devCard.bought`. */
const DevCardKindSchema = z.enum([
  'knight',
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
  'victoryPoint',
]);

/** One port's trade content (generic 3:1 or a specific 2:1). */
const PortContentSchema = z.union([
  z.object({ kind: z.literal('generic'), rate: z.literal(3) }),
  z.object({ kind: z.literal('resource'), rate: z.literal(2), resource: z.string() }),
]);

// --- inbound intent payload variants ---------------------------------------

const RollDiceIntentSchema = z.object({
  type: z.literal('intent.rollDice'),
  playerId: z.string(),
});
const EndTurnIntentSchema = z.object({
  type: z.literal('intent.endTurn'),
  playerId: z.string(),
});
const PlaceSettlementIntentSchema = z.object({
  type: z.literal('intent.placeSettlement'),
  playerId: z.string(),
  vertexId: z.string(),
});
const PlaceRoadIntentSchema = z.object({
  type: z.literal('intent.placeRoad'),
  playerId: z.string(),
  edgeId: z.string(),
});
const BuildRoadIntentSchema = z.object({
  type: z.literal('intent.buildRoad'),
  playerId: z.string(),
  edgeId: z.string(),
});
const BuildSettlementIntentSchema = z.object({
  type: z.literal('intent.buildSettlement'),
  playerId: z.string(),
  vertexId: z.string(),
});
const BuildCityIntentSchema = z.object({
  type: z.literal('intent.buildCity'),
  playerId: z.string(),
  vertexId: z.string(),
});
const BuyDevCardIntentSchema = z.object({
  type: z.literal('intent.buyDevCard'),
  playerId: z.string(),
});

// `intent.playDevCard` is itself discriminated on `card` (S1.2.3) — a nested
// discriminated union so a new card kind must also be added here (pinned by
// _PLAY_DEV_CARD_VARIANT_PIN below).
const PlayKnightIntentSchema = z.object({
  type: z.literal('intent.playDevCard'),
  playerId: z.string(),
  card: z.literal('knight'),
  tileId: z.string(),
  victimId: z.string().optional(),
});
const PlayRoadBuildingIntentSchema = z.object({
  type: z.literal('intent.playDevCard'),
  playerId: z.string(),
  card: z.literal('roadBuilding'),
  edgeIds: z.array(z.string()),
});
const PlayYearOfPlentyIntentSchema = z.object({
  type: z.literal('intent.playDevCard'),
  playerId: z.string(),
  card: z.literal('yearOfPlenty'),
  resources: z.tuple([z.string(), z.string()]),
});
const PlayMonopolyIntentSchema = z.object({
  type: z.literal('intent.playDevCard'),
  playerId: z.string(),
  card: z.literal('monopoly'),
  resource: z.string(),
});
const PlayDevCardIntentSchema = z.discriminatedUnion('card', [
  PlayKnightIntentSchema,
  PlayRoadBuildingIntentSchema,
  PlayYearOfPlentyIntentSchema,
  PlayMonopolyIntentSchema,
]);

const DiscardIntentSchema = z.object({
  type: z.literal('intent.discard'),
  playerId: z.string(),
  resources: CountMapSchema,
});
const MoveRobberIntentSchema = z.object({
  type: z.literal('intent.moveRobber'),
  playerId: z.string(),
  tileId: z.string(),
  victimId: z.string().optional(),
});
const ProposeTradeIntentSchema = z.object({
  type: z.literal('intent.proposeTrade'),
  playerId: z.string(),
  give: CountMapSchema,
  get: CountMapSchema,
});
const AcceptTradeIntentSchema = z.object({
  type: z.literal('intent.acceptTrade'),
  playerId: z.string(),
});
const RejectTradeIntentSchema = z.object({
  type: z.literal('intent.rejectTrade'),
  playerId: z.string(),
});
const CounterTradeIntentSchema = z.object({
  type: z.literal('intent.counterTrade'),
  playerId: z.string(),
  give: CountMapSchema,
  get: CountMapSchema,
});
const CancelTradeIntentSchema = z.object({
  type: z.literal('intent.cancelTrade'),
  playerId: z.string(),
});
const BankTradeIntentSchema = z.object({
  type: z.literal('intent.bankTrade'),
  playerId: z.string(),
  give: z.string(),
  count: z.number(),
  get: z.string(),
});

/**
 * The inbound {@link PlayerIntent} payload — pinned to core's canonical union
 * (see _PLAYER_INTENT_VARIANT_PIN / _PLAY_DEV_CARD_VARIANT_PIN). zod validates
 * the wire shape; core `validate` owns semantic legality.
 */
export const PlayerIntentSchema = z.discriminatedUnion('type', [
  RollDiceIntentSchema,
  EndTurnIntentSchema,
  PlaceSettlementIntentSchema,
  PlaceRoadIntentSchema,
  BuildRoadIntentSchema,
  BuildSettlementIntentSchema,
  BuildCityIntentSchema,
  BuyDevCardIntentSchema,
  PlayDevCardIntentSchema,
  DiscardIntentSchema,
  MoveRobberIntentSchema,
  ProposeTradeIntentSchema,
  AcceptTradeIntentSchema,
  RejectTradeIntentSchema,
  CounterTradeIntentSchema,
  CancelTradeIntentSchema,
  BankTradeIntentSchema,
]);

/**
 * The four SHIPPING rule-profile ids (S2.1.1..S2.1.6) — deliberately a local
 * literal, not imported from `@skervik/core`'s `SHIPPING_PROFILE_IDS`: that
 * export is a plain `readonly RuleProfileId[]`, not the `[string, ...string[]]`
 * tuple shape `z.enum` needs, and this file already re-derives wire-only
 * shapes locally (see the intent schemas above). Reused below by both the
 * OUTBOUND `match.started` event payload and the INBOUND `JoinLobbySelectionSchema`
 * (S2.5.4) so the two never drift apart.
 */
const ShippingProfileIdSchema = z.enum(['classic', 'balanced', 'blitz', 'twoPlayer']);

// --- outbound event payload variants ---------------------------------------

const MatchStartedEventSchema = z.object({
  type: z.literal('match.started'),
  index: z.number(),
  matchId: z.string(),
  seedHash: z.string(),
  playerIds: z.array(z.string()),
  // S2.1.1: the match's rule profile. Optional + append-compatible — a
  // pre-S2.1.1 emit without it still validates and folds to Classic.
  profileId: ShippingProfileIdSchema.optional(),
});
const BoardGeneratedEventSchema = z.object({
  type: z.literal('board.generated'),
  index: z.number(),
  tileKinds: z.record(z.string(), z.string()),
  tileTokens: z.record(z.string(), z.number()),
  portContents: z.array(PortContentSchema),
  robberTileId: z.string(),
});
// S2.1.6: a NEUTRAL/phantom blocking settlement placed at genesis (2-player
// mode). Append-compatible — only emitted under the `twoPlayer` profile.
const NeutralPlacedEventSchema = z.object({
  type: z.literal('neutral.placed'),
  index: z.number(),
  vertexId: z.string(),
});
const DiceRolledEventSchema = z.object({
  type: z.literal('dice.rolled'),
  index: z.number(),
  playerId: z.string(),
  dieA: z.number(),
  dieB: z.number(),
  total: z.number(),
  playersToDiscard: z.array(z.string()).optional(),
});
const ResourcesProducedEventSchema = z.object({
  type: z.literal('resources.produced'),
  index: z.number(),
  grants: z.record(z.string(), CountMapSchema),
  bank: CountMapSchema,
});
const TurnEndedEventSchema = z.object({
  type: z.literal('turn.ended'),
  index: z.number(),
  playerId: z.string(),
  nextPlayerId: z.string(),
});
const SettlementPlacedEventSchema = z.object({
  type: z.literal('settlement.placed'),
  index: z.number(),
  playerId: z.string(),
  vertexId: z.string(),
  payout: CountMapSchema,
});
const RoadPlacedEventSchema = z.object({
  type: z.literal('road.placed'),
  index: z.number(),
  playerId: z.string(),
  edgeId: z.string(),
  nextPlayerId: z.string(),
  nextPhase: GamePhaseSchema,
});
const RoadBuiltEventSchema = z.object({
  type: z.literal('road.built'),
  index: z.number(),
  playerId: z.string(),
  edgeId: z.string(),
  cost: CountMapSchema,
});
const SettlementBuiltEventSchema = z.object({
  type: z.literal('settlement.built'),
  index: z.number(),
  playerId: z.string(),
  vertexId: z.string(),
  cost: CountMapSchema,
});
const CityBuiltEventSchema = z.object({
  type: z.literal('city.built'),
  index: z.number(),
  playerId: z.string(),
  vertexId: z.string(),
  cost: CountMapSchema,
});
const DevCardBoughtEventSchema = z.object({
  type: z.literal('devCard.bought'),
  index: z.number(),
  playerId: z.string(),
  card: DevCardKindSchema,
  cost: CountMapSchema,
  deckRemaining: z.number(),
});
const RoadBuildingPlayedEventSchema = z.object({
  type: z.literal('devCard.roadBuildingPlayed'),
  index: z.number(),
  playerId: z.string(),
  edgeIds: z.array(z.string()),
});
const YearOfPlentyPlayedEventSchema = z.object({
  type: z.literal('devCard.yearOfPlentyPlayed'),
  index: z.number(),
  playerId: z.string(),
  resources: CountMapSchema,
  bank: CountMapSchema,
});
const MonopolyPlayedEventSchema = z.object({
  type: z.literal('devCard.monopolyPlayed'),
  index: z.number(),
  playerId: z.string(),
  resource: z.string(),
  transfers: CountMapSchema,
});
const ResourcesDiscardedEventSchema = z.object({
  type: z.literal('resources.discarded'),
  index: z.number(),
  playerId: z.string(),
  resources: CountMapSchema,
  remainingToDiscard: z.array(z.string()),
});
const RobberMovedEventSchema = z.object({
  type: z.literal('robber.moved'),
  index: z.number(),
  playerId: z.string(),
  tileId: z.string(),
  stolenFrom: z.string().optional(),
  stolenResource: z.string().optional(),
  nextPhase: GamePhaseSchema,
});
const KnightPlayedEventSchema = z.object({
  type: z.literal('devCard.knightPlayed'),
  index: z.number(),
  playerId: z.string(),
});
const TradeOfferedEventSchema = z.object({
  type: z.literal('trade.offered'),
  index: z.number(),
  proposerId: z.string(),
  give: CountMapSchema,
  get: CountMapSchema,
  targets: z.array(z.string()),
  depth: z.number(),
});
const TradeExecutedEventSchema = z.object({
  type: z.literal('trade.executed'),
  index: z.number(),
  proposerId: z.string(),
  accepterId: z.string(),
  give: CountMapSchema,
  get: CountMapSchema,
});
const TradeRejectedEventSchema = z.object({
  type: z.literal('trade.rejected'),
  index: z.number(),
  playerId: z.string(),
  remainingTargets: z.array(z.string()),
});
const TradeCancelledEventSchema = z.object({
  type: z.literal('trade.cancelled'),
  index: z.number(),
  playerId: z.string(),
});
const BankTradedEventSchema = z.object({
  type: z.literal('bank.trade'),
  index: z.number(),
  playerId: z.string(),
  give: z.string(),
  count: z.number(),
  get: z.string(),
  bank: CountMapSchema,
  // S2.2.2: present ONLY when this trade used the discounted `robinHood`
  // poverty-token rate — absent (every shipping preset) is a normal trade.
  povertyDiscount: z.literal(true).optional(),
});
const LongestRoadAwardedEventSchema = z.object({
  type: z.literal('award.longestRoad'),
  index: z.number(),
  playerId: z.string().optional(),
  length: z.number(),
});
const LargestArmyAwardedEventSchema = z.object({
  type: z.literal('award.largestArmy'),
  index: z.number(),
  playerId: z.string(),
  knights: z.number(),
});
const GameEndedEventSchema = z.object({
  type: z.literal('game.ended'),
  index: z.number(),
  winnerId: z.string(),
  finalStandings: CountMapSchema,
});
// S2.2.2: system-emitted `robinHood` poverty-token grant, right after a non-7
// `resources.produced` — NEVER emitted under `robinHood:false` (every
// shipping preset today).
const PovertyTokensGrantedEventSchema = z.object({
  type: z.literal('poverty.tokensGranted'),
  index: z.number(),
  grants: CountMapSchema,
});
// S2.2.3: system-emitted Splendor-style final-round trigger — reaching
// `vpToWin` under `catchUp.finalRound` starts a final round instead of ending.
// NEVER emitted under `finalRound:false` (every shipping preset today).
const GameFinalRoundStartedEventSchema = z.object({
  type: z.literal('game.finalRoundStarted'),
  index: z.number(),
  triggeredBy: z.string(),
  triggeredOnTurn: z.number(),
});

/**
 * The outbound {@link GameEvent} payload of an `event.batch` — pinned to core's
 * canonical union (see _GAME_EVENT_VARIANT_PIN). Authored for E1.6's client to
 * validate its inbound stream; the server already emits exactly these.
 */
export const GameEventSchema = z.discriminatedUnion('type', [
  MatchStartedEventSchema,
  BoardGeneratedEventSchema,
  NeutralPlacedEventSchema,
  DiceRolledEventSchema,
  ResourcesProducedEventSchema,
  TurnEndedEventSchema,
  SettlementPlacedEventSchema,
  RoadPlacedEventSchema,
  RoadBuiltEventSchema,
  SettlementBuiltEventSchema,
  CityBuiltEventSchema,
  DevCardBoughtEventSchema,
  RoadBuildingPlayedEventSchema,
  YearOfPlentyPlayedEventSchema,
  MonopolyPlayedEventSchema,
  ResourcesDiscardedEventSchema,
  RobberMovedEventSchema,
  KnightPlayedEventSchema,
  TradeOfferedEventSchema,
  TradeExecutedEventSchema,
  TradeRejectedEventSchema,
  TradeCancelledEventSchema,
  BankTradedEventSchema,
  LongestRoadAwardedEventSchema,
  LargestArmyAwardedEventSchema,
  PovertyTokensGrantedEventSchema,
  GameFinalRoundStartedEventSchema,
  GameEndedEventSchema,
]);

// --- outbound public GameState (state.snapshot payload) --------------------

const PlayerStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  victoryPoints: z.number(),
  resources: CountMapSchema,
});
const BoardStateSchema = z.object({
  tileKinds: z.record(z.string(), z.string()),
  tileTokens: z.record(z.string(), z.number()),
  portContents: z.array(PortContentSchema),
  robberTileId: z.string(),
});
const BuildingsStateSchema = z.object({
  settlements: z.record(z.string(), z.string()),
  roads: z.record(z.string(), z.string()),
  cities: z.record(z.string(), z.string()).optional(),
});
const DevCardHoldingsSchema = z.object({
  held: z.record(z.string(), z.number()),
  boughtThisTurn: z.record(z.string(), z.number()),
});
const TradeOfferSchema = z.object({
  proposerId: z.string(),
  give: CountMapSchema,
  get: CountMapSchema,
  targets: z.array(z.string()),
  depth: z.number(),
});

/** The public {@link GameState} sent as `state.snapshot`'s payload (never the raw seed). */
export const PublicGameStateSchema = z.object({
  matchId: z.string(),
  phase: GamePhaseSchema,
  turn: z.number(),
  currentPlayerId: z.string(),
  players: z.array(PlayerStateSchema),
  playerOrder: z.array(z.string()).optional(),
  eventIndex: z.number(),
  seedHash: z.string(),
  board: BoardStateSchema.optional(),
  buildings: BuildingsStateSchema.optional(),
  pendingRoadVertexId: z.string().optional(),
  bank: CountMapSchema.optional(),
  devDeckRemaining: z.number().optional(),
  devCards: z.record(z.string(), DevCardHoldingsSchema).optional(),
  devCardPlayedThisTurn: z.boolean().optional(),
  playersToDiscard: z.array(z.string()).optional(),
  knightsPlayed: z.record(z.string(), z.number()).optional(),
  longestRoadHolder: z.string().optional(),
  largestArmyHolder: z.string().optional(),
  openTradeOffer: TradeOfferSchema.optional(),
});

// --- envelopes -------------------------------------------------------------

/** Every WS envelope is versioned `v: 1` (S1.5.2 owns handshake/versioning). */
const EnvelopeVersionSchema = z.literal(1);

/** Client → server: the sole inbound message in M1, the intent envelope. */
export const IntentEnvelopeSchema = z.object({
  v: EnvelopeVersionSchema,
  type: z.literal('intent'),
  payload: PlayerIntentSchema,
});
/** Server → clients: a batch of validated events, folded through each `reduce`. */
export const EventBatchEnvelopeSchema = z.object({
  v: EnvelopeVersionSchema,
  type: z.literal('event.batch'),
  payload: z.array(GameEventSchema),
});
/** Server → one client: a one-shot full public state. */
export const StateSnapshotEnvelopeSchema = z.object({
  v: EnvelopeVersionSchema,
  type: z.literal('state.snapshot'),
  payload: PublicGameStateSchema,
});
/**
 * Server → the sender: a `validate` rejection. `reason` is left a plain string
 * (core's {@link RejectReason} is the authority for its values) so a new core
 * reject reason never has to be mirrored here to keep the wire flowing.
 */
export const RejectEnvelopeSchema = z.object({
  v: EnvelopeVersionSchema,
  type: z.literal('intent.rejected'),
  payload: z.object({ reason: z.string() }),
});
/** Server → the sender: a durable-persist/internal failure (state NOT advanced). */
export const ErrorEnvelopeSchema = z.object({
  v: EnvelopeVersionSchema,
  type: z.literal('intent.error'),
  payload: z.object({ code: z.literal('INTERNAL_ERROR') }),
});

/**
 * Client → server JOIN options (S1.5.2 handshake + S1.7.1 guest fields): the
 * client presents its `protocolVersion` in the Colyseus join `options`. The
 * server `safeParse`s this in `onAuth` and compares it against the single-source
 * `PROTOCOL_VERSION` via {@link isCompatibleProtocolVersion} BEFORE seating.
 * This is NOT a WS envelope — it rides the join handshake, not the message bus,
 * so it carries no `v`/`type` wrapper.
 *
 * `guestId`/`displayName` (S1.7.1) are OPTIONAL, anonymous, DISPLAY-ONLY lobby
 * metadata — NOT the authoritative identity. `protocolVersion` stays REQUIRED
 * and the version gate still rejects a mismatch first; the guest fields are
 * ignored by authoritative logic (the seat's `playerId` remains the unspoofable
 * Colyseus `sessionId`, S1.4.2/S1.5.2). They are typed here only so the wire
 * contract documents them; wiring `displayName` onto a seat for HUD display is
 * deferred (S1.7.1b/S1.6.6).
 */
export const ConnectOptionsSchema = z.object({
  protocolVersion: z.string(),
  guestId: z.string().optional(),
  displayName: z.string().optional(),
});
export type ConnectOptions = z.infer<typeof ConnectOptionsSchema>;

/**
 * Client → server WIRE-CONTROLLABLE lobby selection (S2.5.4: preset + bot
 * fill), validated as a SIBLING of {@link ConnectOptionsSchema} — not merged
 * into it — so a bad lobby selection is never misreported as a
 * `PROTOCOL_VERSION_MISMATCH` (`GameRoom.onAuth` checks both, independently,
 * and rejects with a distinct reason).
 *
 * 🔴 Security requirement: `@skervik/core`'s `PROFILE_REGISTRY` is keyed by
 * `string` and additionally resolves SIX measurement-only profile ids
 * (`EXPERIMENTAL_PROFILE_IDS`) that must never be reachable from a client. This
 * is the explicit allow-list — `profileId` accepts ONLY the four SHIPPING ids
 * (`ShippingProfileIdSchema`); an experimental or unknown id fails `safeParse`,
 * so it can never reach `onCreate`/`loadRuleProfile`.
 *
 * `bots` reuses the EXISTING `GameRoomOptions.bots` shape (`{difficulty}` per
 * seat) — no new bot machinery — capped at 3 so a wire join can never request
 * more bots than a 4-seat Classic room can ever seat around at least one
 * human. `reconnectGraceSeconds`, if present, is floored to the ≥120s "no
 * karmic bans" product-law minimum by `onAuth` before the room ever reads it
 * (discharges the S2.3.1 nit) — never trusted as-is.
 */
export const JoinLobbySelectionSchema = z.object({
  profileId: ShippingProfileIdSchema.optional(),
  bots: z
    .array(z.object({ difficulty: z.enum(['easy', 'medium', 'hard']) }))
    .max(3)
    .optional(),
  reconnectGraceSeconds: z.number().positive().optional(),
});
export type JoinLobbySelection = z.infer<typeof JoinLobbySelectionSchema>;

/**
 * 🔴 The FULL wire-permitted join contract (security follow-up to S2.5.4,
 * `[[room-options-are-client-input]]`): {@link ConnectOptionsSchema}'s shape
 * extended with {@link JoinLobbySelectionSchema}'s, then `.strict()` — ANY key
 * outside this union fails the parse, instead of being silently ignored (zod's
 * default `.object()` behavior) or silently stripped.
 *
 * This is what stands between a hand-rolled client and every OTHER
 * `GameRoomOptions` field `GameRoom.onCreate` reads directly off the raw join
 * options with NO runtime check of its own — most seriously `seed`
 * (`this.#seed = options?.seed ?? generateSeed()`): a client that could smuggle
 * its own `seed` through would know every future die roll, and commit-reveal
 * would still "verify" (the server honestly reveals whatever seed it was
 * handed) — the exact reputational failure provably-fair RNG exists to
 * prevent. Also blocks `maxSeats` (shrink/inflate the table), `botActionCap`,
 * `botFillDifficulty`, and any FUTURE `GameRoomOptions` field.
 *
 * ALLOW-LIST + `.strict()`, deliberately, over a deny-list of forbidden keys:
 * a deny-list silently fails open the next time someone adds a
 * `GameRoomOptions` field and forgets to list it there; an allow-list is safe
 * by default (a new field is excluded unless someone explicitly widens THIS
 * schema), and `.strict()` makes the omission LOUD (a hard rejection) rather
 * than a silent, hard-to-notice strip.
 *
 * Only ever checked in `GameRoom.onAuth` — the ONE path a real client's
 * `joinOrCreate`/`join`/`create`/`joinById` options flow through
 * (`@colyseus/core`'s `MatchMaker.ts`, verified against 0.17.44). The
 * trusted-internal path every existing server test uses
 * (`matchMaker.createRoom` / `@colyseus/testing`'s `createRoom()`) calls
 * `onCreate` directly and bypasses `onAuth` entirely, so `seed`/`maxSeats`/etc.
 * stay reachable there, unaffected by this schema.
 */
export const JoinOptionsSchema = ConnectOptionsSchema.extend(
  JoinLobbySelectionSchema.shape,
).strict();
export type JoinOptions = z.infer<typeof JoinOptionsSchema>;

/**
 * Server → a version-incompatible client: the typed `error.version` rejection
 * (see {@link VersionErrorMessage}). Carried as the JSON body of the Colyseus
 * `ServerError` thrown from `onAuth`, and a recognized variant of
 * {@link ServerMessageSchema} so E1.6 can validate + render it like any other
 * inbound server message.
 */
export const VersionErrorEnvelopeSchema = z.object({
  v: EnvelopeVersionSchema,
  type: z.literal('error.version'),
  payload: z.object({
    code: z.literal('PROTOCOL_VERSION_MISMATCH'),
    serverVersion: z.string(),
    clientVersion: z.string().nullable(),
  }),
});

/**
 * What the SERVER accepts inbound. Discriminated on `type` and authored
 * extensibly (M1 has one inbound message — the intent envelope); S1.5.2 adds
 * the handshake here without touching the pipeline.
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [IntentEnvelopeSchema]);

/** What a CLIENT accepts inbound (used by E1.6 to validate the server stream). */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  EventBatchEnvelopeSchema,
  StateSnapshotEnvelopeSchema,
  RejectEnvelopeSchema,
  ErrorEnvelopeSchema,
  VersionErrorEnvelopeSchema,
]);

// --- compile-time drift pins (the point of S1.5.1) -------------------------
// `Equals` is the classic mutual-assignability equality: it is `true` ONLY when
// A and B are the exact same type. `AssertTrue` then forces that to hold — an
// `Equals<…>` that resolves to `false` fails the `extends true` constraint, so
// the protocol typecheck/build breaks. Each pin compares the SCHEMA's inferred
// discriminants against CORE's canonical ones, so adding (or removing) a core
// intent/event variant — which changes core's side but not the schema's —
// flips the pin and stops the build until the schema is brought back in sync.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;

/** Every `PlayerIntent` top-level variant is covered by the inbound schema. */
type _PLAYER_INTENT_VARIANT_PIN = AssertTrue<
  Equals<z.infer<typeof PlayerIntentSchema>['type'], PlayerIntent['type']>
>;
/** Every `intent.playDevCard` card kind is covered by the nested schema. */
type _PLAY_DEV_CARD_VARIANT_PIN = AssertTrue<
  Equals<
    Extract<z.infer<typeof PlayerIntentSchema>, { type: 'intent.playDevCard' }>['card'],
    Extract<PlayerIntent, { type: 'intent.playDevCard' }>['card']
  >
>;
/** Every `GameEvent` variant is covered by the outbound schema. */
type _GAME_EVENT_VARIANT_PIN = AssertTrue<
  Equals<z.infer<typeof GameEventSchema>['type'], GameEvent['type']>
>;
