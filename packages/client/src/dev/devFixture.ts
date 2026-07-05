// Throwaway dev-only fixture — a real `GameState` whose `board` comes from
// REAL core board generation (not hand-authored tile data), so the render
// proves the actual type contract end-to-end. Superseded by the WS client
// in S1.6.5; do not build product features on top of this file.

import type { BoardGeneratedEvent, GameState, MatchStartedEvent } from '@skervik/core';
import { buildTopology, generateBoard, reduce } from '@skervik/core';

/** Fixed for reproducibility across dev sessions — not a match secret (dev-only, never shipped). */
const DEV_SEED = 'skervik-dev-fixture-seed-1';

const DEV_PLAYER_IDS = ['player-1', 'player-2', 'player-3', 'player-4'] as const;

const preMatchState: GameState = {
  matchId: 'dev-fixture-match',
  phase: 'lobby',
  turn: 0,
  currentPlayerId: DEV_PLAYER_IDS[0],
  players: [],
  eventIndex: 0,
  seedHash: 'dev-fixture-seed-hash',
};

const matchStarted: MatchStartedEvent = {
  type: 'match.started',
  index: preMatchState.eventIndex,
  matchId: preMatchState.matchId,
  seedHash: preMatchState.seedHash,
  playerIds: DEV_PLAYER_IDS,
};

const afterMatchStart = reduce(preMatchState, matchStarted);

// `generateBoard` (S1.1.2, `@skervik/core`) — the deterministic Classic
// board generator; `board.generated`'s fields are its output verbatim.
const layout = generateBoard(DEV_SEED, buildTopology());

const boardGenerated: BoardGeneratedEvent = {
  type: 'board.generated',
  index: afterMatchStart.eventIndex,
  tileKinds: layout.tileKinds,
  tileTokens: layout.tileTokens,
  portContents: layout.portContents,
  robberTileId: layout.robberTileId,
};

/**
 * The dev-harness `GameState`: reduced from `match.started` + `board.generated`
 * events (both real core event types, applied through the real core
 * `reduce()`), with `board.generated`'s payload produced by the real
 * `generateBoard(seed, topology)` — never hand-authored tile data.
 */
export const devFixtureState: GameState = reduce(afterMatchStart, boardGenerated);
