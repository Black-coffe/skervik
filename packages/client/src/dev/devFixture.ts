// Throwaway dev-only fixture — a real `GameState` whose `board` comes from
// REAL core board generation (not hand-authored tile data), and whose
// pieces (S1.6.2) come from REAL core events, so the render proves the
// actual type contract end-to-end. Superseded by the WS client in S1.6.5;
// do not build product features on top of this file.

import type {
  BoardGeneratedEvent,
  CityBuiltEvent,
  GameState,
  MatchStartedEvent,
  ResourcesProducedEvent,
  RoadPlacedEvent,
  SettlementPlacedEvent,
  VertexTopology,
} from '@skervik/core';
import {
  buildTopology,
  CLASSIC_BUILD_PROFILE,
  generateBoard,
  reduce,
  validate,
} from '@skervik/core';

/** Fixed for reproducibility across dev sessions — not a match secret (dev-only, never shipped). */
const DEV_SEED = 'skervik-dev-fixture-seed-1';

const DEV_PLAYER_IDS = ['player-1', 'player-2', 'player-3', 'player-4'] as const;

const topology = buildTopology();

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
const layout = generateBoard(DEV_SEED, topology);

const boardGenerated: BoardGeneratedEvent = {
  type: 'board.generated',
  index: afterMatchStart.eventIndex,
  tileKinds: layout.tileKinds,
  tileTokens: layout.tileTokens,
  portContents: layout.portContents,
  robberTileId: layout.robberTileId,
};

const afterBoardGenerated = reduce(afterMatchStart, boardGenerated);

/**
 * Greedily picks `count` vertices from `topology`, skipping any vertex
 * adjacent to an already-picked one — satisfies the setup phase's distance
 * rule against each other. Reproduced from the same fixture pattern
 * `@skervik/core`'s `setup.test.ts` uses for its snake-draft fixture (not
 * imported — that's a core test helper, not a public export); topology
 * order is fixed, so this pick is reproducible run to run.
 */
function pickNonAdjacentVertices(count: number): VertexTopology[] {
  const chosen: VertexTopology[] = [];
  const blocked = new Set<string>();
  for (const vertex of topology.vertices) {
    if (chosen.length >= count) break;
    if (blocked.has(vertex.id)) continue;
    chosen.push(vertex);
    blocked.add(vertex.id);
    for (const adjacentId of vertex.adjacentVertexIds) blocked.add(adjacentId);
  }
  if (chosen.length < count) {
    throw new Error(`dev fixture bug: could not find ${count} non-adjacent vertices`);
  }
  return chosen;
}

// --- Setup-phase snake draft (S1.1.3): 4 players place a settlement + its
// attached road, forward P1..P4 then reverse P4..P1 — the same
// `intent.placeSettlement` -> `intent.placeRoad` -> `validate` -> `reduce`
// pipeline `setup.test.ts` exercises, run here for real so every flotilla
// gets real `settlement.placed` / `road.placed` events in `buildings`.
const draftVertices = pickNonAdjacentVertices(DEV_PLAYER_IDS.length * 2);
const draftPlayers = [...DEV_PLAYER_IDS, ...[...DEV_PLAYER_IDS].reverse()];

let state = afterBoardGenerated;

draftPlayers.forEach((playerId, step) => {
  const vertex = draftVertices[step] as VertexTopology;

  const settleResult = validate(
    state,
    { type: 'intent.placeSettlement', playerId, vertexId: vertex.id },
    playerId,
    DEV_SEED,
  );
  if (!settleResult.ok) {
    throw new Error(
      `dev fixture: intent.placeSettlement rejected (${settleResult.reason})`,
    );
  }
  const settleEvent = settleResult.events[0] as SettlementPlacedEvent;
  state = reduce(state, settleEvent);

  const roadEdgeId = vertex.edgeIds[0] as string;
  const roadResult = validate(
    state,
    { type: 'intent.placeRoad', playerId, edgeId: roadEdgeId },
    playerId,
    DEV_SEED,
  );
  if (!roadResult.ok) {
    throw new Error(`dev fixture: intent.placeRoad rejected (${roadResult.reason})`);
  }
  const roadEvent = roadResult.events[0] as RoadPlacedEvent;
  state = reduce(state, roadEvent);
});

// --- One city upgrade, so the render exercises `buildings.cities` too.
// Upgrading via `intent.buildCity` needs the main-phase turn loop (a dice
// roll to leave 'roll' for 'main', plus enough production income to afford
// `iron:3, barley:2`) — driving that fully is the play-loop's concern, out
// of scope for a static dev-preview fixture (S1.6.2 spec's explicit
// fallback: "a minimal scripted sequence of legal placement/build events
// through reduce is fine"). So this ONE event is constructed directly (a
// real `CityBuiltEvent`, same shape `build.test.ts` asserts, cost taken
// verbatim from the real `CLASSIC_BUILD_PROFILE`) and applied through the
// real `reduce()` — every other piece above went through full `validate`.
//
// S1.6.2 nit-2 fix (S1.6.3): the setup-draft payouts above don't guarantee
// player-1 already holds `iron:3, barley:2` — subtracting the city cost
// without prior income could leave NEGATIVE resources, and this HUD story
// renders those resources as pills. So a `resources.produced` income event
// grants player-1 EXACTLY the city's cost first (through the real
// `reduce()`, same as every other event here) — netting player-1's
// iron/barley back to their pre-income values (unchanged, and non-negative,
// since every prior event only ever added resources) while still proving
// the city build's debit path for real.
const cityIncome: ResourcesProducedEvent = {
  type: 'resources.produced',
  index: state.eventIndex,
  grants: { [DEV_PLAYER_IDS[0]]: CLASSIC_BUILD_PROFILE.costs.city },
  bank: {},
};
state = reduce(state, cityIncome);

const cityVertexId = (draftVertices[0] as VertexTopology).id; // player-1's first (setup-phase) settlement
const cityBuilt: CityBuiltEvent = {
  type: 'city.built',
  index: state.eventIndex,
  playerId: DEV_PLAYER_IDS[0],
  vertexId: cityVertexId,
  cost: CLASSIC_BUILD_PROFILE.costs.city,
};
state = reduce(state, cityBuilt);

/**
 * The dev-harness `GameState`: `match.started` + `board.generated` +
 * 8 setup-phase `settlement.placed`/`road.placed` events (all 4 flotillas,
 * via real `validate` -> `reduce`) + 1 `resources.produced` income event +
 * 1 direct `city.built` event, all applied through the real core `reduce()`
 * — never hand-mutated state. No player ends up with a negative resource
 * count (S1.6.2 nit-2, fixed in S1.6.3 — see the `cityIncome` comment above).
 */
export const devFixtureState: GameState = state;
