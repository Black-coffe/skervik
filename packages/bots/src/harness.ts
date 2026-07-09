// S2.4.1 — the in-process, provably-terminating full-match harness. Plays a
// complete deterministic Classic match by acting as BOTH the bots (via
// `Bot.decide`, seed-blind) AND a mock-authority (core `validate`+`reduce`,
// fed the TEST seed — the harness plays the server's role in a test; the bots
// themselves never see it). This is the productized version of the S1.7.2 E2E
// `scriptedDriver.test.ts` `simulateMatch`; it reuses that EXACT genesis
// bootstrap (`match.started` + `board.generated` folded onto a lobby
// `GameState`, mirroring `GameRoom.onCreate`) — not a new one.
//
// S2.4.3 (single-player) reuses this harness in-process. It stays free of any
// `packages/server` import — dependency direction is server → bots, never the
// reverse.
import {
  type BoardGeneratedEvent,
  buildTopology,
  type ExperimentalProfileId,
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  generateBoard,
  loadRuleProfile,
  type MatchStartedEvent,
  type PlayerId,
  reduce,
  type RuleProfile,
  type RuleProfileId,
  type Seed,
  validate,
} from '@skervik/core';

import type { Bot } from './bot.js';

export interface SimResult {
  readonly finalState: GameState;
  readonly events: GameEvent[];
  readonly winnerId: PlayerId | null;
  readonly turns: number;
}

export interface SimulateMatchOptions {
  readonly seed: Seed;
  readonly playerIds: readonly PlayerId[];
  readonly bots: Readonly<Record<PlayerId, Bot>>;
  /** HARD cap on applied steps — throws loudly if exceeded, never hangs. Default {@link DEFAULT_MAX_TURNS}. */
  readonly maxTurns?: number;
  /**
   * The rule profile to simulate under (S2.2.5) — a shipping
   * {@link RuleProfileId} or an internal `EXPERIMENTAL_PROFILE_IDS`
   * measurement id (untyped `string` here so the harness stays agnostic of
   * which; `loadRuleProfile` is the sole validator, and throws on an unknown
   * id). Default Classic (`'classic'`). Bot noise seeds are derived from
   * `(difficulty, seed, playerId)` ONLY — never from `profileId` — so the
   * same match `seed` produces the same bot behavior across every profile
   * (paired comparison, S2.2.5 Constraint 4).
   */
  readonly profileId?: string;
}

/** A hard safety cap on applied steps if the caller doesn't set one — fails loudly, never hangs. */
const DEFAULT_MAX_TURNS = 6000;

const HARNESS_MATCH_ID = 'bots-harness-match';
const HARNESS_SEED_HASH = 'bots-harness-seed-hash'; // opaque here; a real room uses its own commit hash.

/**
 * The genesis batch a real `GameRoom` emits on seats-full (match.started +
 * board.generated). `profileId` is the RESOLVED profile's id — the
 * `match.started` event carries the key ONLY when it is not Classic
 * (S2.2.5 Constraint 1: `reduce.ts` sets `state.profileId` only if the event
 * carries the key at all, so emitting `profileId: 'classic'` — instead of
 * omitting the key — would still shift the event bytes vs. every pre-S2.1.1
 * golden fixture). The cast is the same one every internal test profile
 * already uses (`ROBIN_HOOD_TEST_PROFILE_ID as RuleProfileId`, etc.) —
 * `RuleProfileId` deliberately excludes measurement ids; the registry key,
 * not the type, is what resolves them.
 */
function genesisEvents(
  seed: Seed,
  playerIds: readonly PlayerId[],
  profileId: string,
  profile: RuleProfile,
): GameEvent[] {
  const matchStarted: MatchStartedEvent = {
    type: 'match.started',
    index: 0,
    matchId: HARNESS_MATCH_ID,
    seedHash: HARNESS_SEED_HASH,
    playerIds: [...playerIds],
    ...(profileId === 'classic' ? {} : { profileId: profileId as RuleProfileId }),
  };
  const layout = generateBoard(seed, buildTopology(), profile.board);
  const boardGenerated: BoardGeneratedEvent = {
    type: 'board.generated',
    index: 1,
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: layout.robberTileId,
  };
  return [matchStarted, boardGenerated];
}

/** The pre-match lobby `GameState` the genesis batch folds onto (mirrors GameRoom.onCreate). */
function lobbyState(): GameState {
  return {
    matchId: HARNESS_MATCH_ID,
    phase: 'lobby',
    turn: 0,
    currentPlayerId: '',
    players: [],
    eventIndex: 0,
    seedHash: HARNESS_SEED_HASH,
  };
}

/**
 * Runs a full Classic match to `game.ended` in-process: on each step the first
 * seat (players' order) whose {@link Bot.decide} returns a non-null intent
 * plays it; the intent is validated (mock-authority, the TEST `seed`) and its
 * events folded. Throws loudly on an unexpected reject (a brain bug) or once
 * `maxTurns` is hit (no termination) — the harness never spins silently.
 */
export function simulateMatch(opts: SimulateMatchOptions): SimResult {
  const { seed, playerIds, bots } = opts;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const profileId = opts.profileId ?? 'classic';
  const profile = loadRuleProfile(profileId as RuleProfileId | ExperimentalProfileId);

  const genesis = genesisEvents(seed, playerIds, profileId, profile);
  let state = genesis.reduce((s, e) => reduce(s, e), lobbyState());
  const events: GameEvent[] = [...genesis];
  let turns = 0;
  let ended: GameEndedEvent | null = null;

  while (state.phase !== 'finished') {
    if (turns >= maxTurns) {
      throw new Error(
        `simulateMatch did not reach game.ended within ${maxTurns} turns ` +
          `(phase=${state.phase}) — a bot that cannot reach the VP threshold ` +
          'must fail loudly, never hang.',
      );
    }
    let acted = false;
    for (const player of state.players) {
      const bot = bots[player.id];
      if (!bot) continue;
      const intent = bot.decide(state, player.id);
      if (!intent) continue;
      const result = validate(state, intent, player.id, seed);
      if (!result.ok) {
        throw new Error(
          `bot produced an ILLEGAL intent (${intent.type} by ${player.id}) ` +
            `rejected ${result.reason} at turn ${turns}, phase=${state.phase}`,
        );
      }
      for (const event of result.events) {
        state = reduce(state, event);
        events.push(event);
        if (event.type === 'game.ended') ended = event;
      }
      acted = true;
      turns += 1;
      break;
    }
    if (!acted) {
      throw new Error(
        `simulateMatch DEADLOCKED at turn ${turns}: no seat has a legal move, phase=${state.phase}`,
      );
    }
  }

  return {
    finalState: state,
    events,
    winnerId: ended?.winnerId ?? null,
    turns,
  };
}
