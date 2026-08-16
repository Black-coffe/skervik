// S2.1.4 — the pure forced-default-action resolver: exhaustive per-phase
// defaults, the deterministic discard policy, and — the load-bearing proof — a
// match log CONTAINING forced (timed-out) actions replays BYTE-IDENTICALLY and
// passes the S1.7.3 fair-RNG verifier. That last test is what guarantees the
// wall-clock never leaked into the deterministic layer: a forced action injects
// only a normal event (no timestamp, no timeout marker), so replay/verify can't
// even tell a turn was auto-played. All boot-free (pure core + resolver, no
// sockets/FS/clock).
import {
  type BoardGeneratedEvent,
  buildTopology,
  type GameEndedEvent,
  type GameEvent,
  type GameState,
  generateBoard,
  loadRuleProfile,
  type MatchStartedEvent,
  type PlayerId,
  type PlayerState,
  reduce,
  replay,
  type RuleProfileId,
  type Seed,
  type TileId,
  topologyForRadius,
  validate,
  verifyMatchRandomness,
  type VertexId,
} from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { decideAction } from '../e2e/scriptedDriver.js';
import { resolveForcedAction } from './forcedAction.js';

const SEED: Seed = 'skervik-s2.1.4-forced-action-seed';
const topology = buildTopology();

/** A minimal player with an explicit hand. */
function player(id: string, resources: Record<string, number> = {}): PlayerState {
  return { id: id as PlayerId, name: id, victoryPoints: 0, resources };
}

/** A base running-match state; callers override `phase`/`players`/etc. */
function baseState(overrides: Partial<GameState>): GameState {
  return {
    matchId: 'forced-action-match',
    phase: 'main',
    turn: 1,
    currentPlayerId: 'p1' as PlayerId,
    players: [player('p1'), player('p2')],
    playerOrder: ['p1', 'p2'] as PlayerId[],
    eventIndex: 5,
    seedHash: 'unused-in-resolver',
    profileId: 'classic',
    ...overrides,
  };
}

describe('resolveForcedAction — per-phase minimal legal defaults (S2.1.4)', () => {
  it('roll phase → the current player rolls the dice', () => {
    const forced = resolveForcedAction(
      baseState({ phase: 'roll', currentPlayerId: 'p2' as PlayerId }),
    );
    expect(forced).toEqual({
      playerId: 'p2',
      intent: { type: 'intent.rollDice', playerId: 'p2' },
    });
  });

  it('main phase → the current player ends their turn (simplest legal exit)', () => {
    const forced = resolveForcedAction(
      baseState({ phase: 'main', currentPlayerId: 'p1' as PlayerId }),
    );
    expect(forced).toEqual({
      playerId: 'p1',
      intent: { type: 'intent.endTurn', playerId: 'p1' },
    });
  });

  it('setup phase → null (auto-placement DEFERRED — needs board topology)', () => {
    expect(resolveForcedAction(baseState({ phase: 'setup' }))).toBeNull();
  });

  it('lobby phase → null (no turn)', () => {
    expect(resolveForcedAction(baseState({ phase: 'lobby' }))).toBeNull();
  });

  it('finished phase → null (no turn)', () => {
    expect(resolveForcedAction(baseState({ phase: 'finished' }))).toBeNull();
  });
});

describe('resolveForcedAction — the deterministic forced-discard policy (S2.1.4)', () => {
  it('discards floor(hand/2) from the LARGEST stacks first, ties broken canonically', () => {
    // Hand of 10 → must discard 5. Largest-first with canonical tie-break
    // (timber<clay<fleece<barley<iron) yields {timber:3, clay:2}.
    const owing = player('p1', { timber: 4, clay: 3, fleece: 2, barley: 1 });
    const forced = resolveForcedAction(
      baseState({
        phase: 'robber',
        currentPlayerId: 'p2' as PlayerId,
        players: [owing, player('p2')],
        playersToDiscard: ['p1'] as PlayerId[],
      }),
    );
    expect(forced?.playerId).toBe('p1');
    expect(forced?.intent).toEqual({
      type: 'intent.discard',
      playerId: 'p1',
      resources: { timber: 3, clay: 2 },
    });
  });

  it('the forced discard is exactly what core validate requires (accepted, not rejected)', () => {
    // Prove the policy is a LEGAL intent, not just a plausible shape: run it
    // through real `validate` from a genuine robber-phase state.
    const state = baseState({
      phase: 'robber',
      currentPlayerId: 'p2' as PlayerId,
      players: [player('p1', { iron: 8 }), player('p2')],
      playersToDiscard: ['p1'] as PlayerId[],
      eventIndex: 3,
    });
    const forced = resolveForcedAction(state);
    expect(forced).not.toBeNull();
    // 8 cards → discard 4 iron.
    expect(forced?.intent).toMatchObject({
      type: 'intent.discard',
      resources: { iron: 4 },
    });
    const result = validate(state, forced!.intent, forced!.playerId, SEED);
    expect(result.ok).toBe(true);
  });

  it('returns ONE ower per call — the first still-owing player (room re-resolves for the rest)', () => {
    const forced = resolveForcedAction(
      baseState({
        phase: 'robber',
        currentPlayerId: 'p3' as PlayerId,
        players: [player('p1', { timber: 8 }), player('p2', { clay: 8 }), player('p3')],
        playersToDiscard: ['p1', 'p2'] as PlayerId[],
      }),
    );
    expect(forced?.playerId).toBe('p1');
  });
});

describe('resolveForcedAction — the deterministic robber move (S2.1.4)', () => {
  const layout = generateBoard(SEED, topology);
  const board = {
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: layout.robberTileId,
  };
  const lowestOtherTile = topology.tiles.find((t) => t.id !== board.robberTileId)
    ?.id as TileId;

  it('moves to the lowest-index tile ≠ the current robber tile, no victim when none is adjacent', () => {
    const state = baseState({
      phase: 'robber',
      currentPlayerId: 'p1' as PlayerId,
      board,
      buildings: { settlements: {}, roads: {} },
    });
    const forced = resolveForcedAction(state);
    expect(forced?.intent).toEqual({
      type: 'intent.moveRobber',
      playerId: 'p1',
      tileId: lowestOtherTile,
    });
    // And it is a legal intent through real validate.
    const result = validate(state, forced!.intent, forced!.playerId, SEED);
    expect(result.ok).toBe(true);
  });

  it('names a deterministic victim when an opponent with cards is adjacent to the default tile', () => {
    const defaultTile = topology.tiles.find((t) => t.id !== board.robberTileId);
    const victimVertex = defaultTile?.vertexIds[0] as VertexId;
    const state = baseState({
      phase: 'robber',
      currentPlayerId: 'p1' as PlayerId,
      players: [player('p1'), player('p2', { iron: 2 })],
      board,
      buildings: { settlements: { [victimVertex]: 'p2' as PlayerId }, roads: {} },
    });
    const forced = resolveForcedAction(state);
    expect(forced?.intent).toEqual({
      type: 'intent.moveRobber',
      playerId: 'p1',
      tileId: lowestOtherTile,
      victimId: 'p2',
    });
    const result = validate(state, forced!.intent, forced!.playerId, SEED);
    expect(result.ok).toBe(true);
  });
});

describe("resolveForcedAction — resolves the room's OWN per-profile board topology, not a hardcoded default (S2.1.7b-08)", () => {
  // `enumerateTileCoords` builds rings 0..radius, so the Classic (radius-2)
  // 19-tile array is an order-identical PREFIX of the `expanded` (radius-3)
  // 37-tile array — the old no-arg `buildTopology()` could NEVER reach the
  // outer ring at all. This tile sits past that prefix (id > the 19-tile
  // range), so it can only be resolved by the room's real `expanded` profile.
  const expandedProfile = loadRuleProfile('expanded');
  const expandedTopology = topologyForRadius(
    expandedProfile.board.radius,
    expandedProfile.board.ports.length,
  );
  const layout = generateBoard(SEED, expandedTopology);
  const board = {
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: expandedTopology.tiles[expandedTopology.tiles.length - 1]?.id as TileId,
  };
  const lowestOtherTile = expandedTopology.tiles.find((t) => t.id !== board.robberTileId)
    ?.id as TileId;

  it('an expanded room forces the robber onto a tile from its real 37-tile board', () => {
    const state = baseState({
      phase: 'robber',
      profileId: 'expanded' as RuleProfileId,
      currentPlayerId: 'p1' as PlayerId,
      board,
      buildings: { settlements: {}, roads: {} },
    });
    const forced = resolveForcedAction(state);
    expect(forced?.intent).toEqual({
      type: 'intent.moveRobber',
      playerId: 'p1',
      tileId: lowestOtherTile,
    });
    // Legal per real `validate`, which resolves the SAME `expanded` topology —
    // proving forcedAction and validate now share one topology source.
    const result = validate(state, forced!.intent, forced!.playerId, SEED);
    expect(result.ok).toBe(true);
  });
});

describe('resolveForcedAction — friendlyRobber cross-check, no-hang (S2.2.1)', () => {
  // `'__friendly_robber_test__'` is the internal, non-shipping profile id
  // behind `FRIENDLY_ROBBER_TEST_PROFILE` (`packages/core/src/ruleProfile.ts`,
  // S2.1.5's own precedent) — deliberately NOT re-exported from
  // `@skervik/core`'s index (like its S2.1.5 `parallelTrade` counterpart), so
  // it's referenced here by its literal registry key rather than an import.
  const FRIENDLY_PROFILE_ID = '__friendly_robber_test__' as unknown as RuleProfileId;
  const layout = generateBoard(SEED, topology);
  const board = {
    tileKinds: layout.tileKinds,
    tileTokens: layout.tileTokens,
    portContents: layout.portContents,
    robberTileId: layout.robberTileId,
  };
  const defaultTile = topology.tiles.find((t) => t.id !== board.robberTileId);
  const lowestOtherTile = defaultTile?.id as TileId;
  const protectedVertex = defaultTile?.vertexIds[0] as VertexId;
  // Elsewhere on the board (never adjacent to `defaultTile`) — used only to
  // push a player's PUBLIC VP above the friendly-robber ceiling.
  const boostTile = topology.tiles[9];
  const boostVertex = boostTile?.vertexIds[0] as VertexId;

  it('never names a protected victim: picks the unprotected adjacent player instead (no hang)', () => {
    // p2: 1 settlement on the default tile = 1 public VP <= ceiling(2) ->
    // protected. p3: same settlement (1) + a city elsewhere (2) = 3 public
    // VP -> unprotected, and also adjacent+carded via a second settlement
    // on the default tile's OTHER vertex.
    const victimVertex = defaultTile?.vertexIds[1] as VertexId;
    const state = baseState({
      phase: 'robber',
      currentPlayerId: 'p1' as PlayerId,
      profileId: FRIENDLY_PROFILE_ID,
      players: [player('p1'), player('p2', { iron: 2 }), player('p3', { iron: 3 })],
      board,
      buildings: {
        settlements: {
          [protectedVertex]: 'p2' as PlayerId,
          [victimVertex]: 'p3' as PlayerId,
        },
        roads: {},
        cities: { [boostVertex]: 'p3' as PlayerId },
      },
    });
    const forced = resolveForcedAction(state);
    expect(forced?.intent).toEqual({
      type: 'intent.moveRobber',
      playerId: 'p1',
      tileId: lowestOtherTile,
      victimId: 'p3', // NOT the protected p2
    });
    // The load-bearing proof: validate ACCEPTS it — no VICTIM_PROTECTED
    // reject, so the turn cannot hang.
    const result = validate(state, forced!.intent, forced!.playerId, SEED);
    expect(result.ok).toBe(true);
  });

  it('omits victimId (steals from no one) when the ONLY adjacent card-holder is protected', () => {
    const state = baseState({
      phase: 'robber',
      currentPlayerId: 'p1' as PlayerId,
      profileId: FRIENDLY_PROFILE_ID,
      players: [player('p1'), player('p2', { iron: 2 })],
      board,
      buildings: { settlements: { [protectedVertex]: 'p2' as PlayerId }, roads: {} },
    });
    const forced = resolveForcedAction(state);
    expect(forced?.intent).toEqual({
      type: 'intent.moveRobber',
      playerId: 'p1',
      tileId: lowestOtherTile,
      // no victimId — the only adjacent card-holder is protected.
    });
    const result = validate(state, forced!.intent, forced!.playerId, SEED);
    expect(result.ok).toBe(true);
  });
});

// --- The determinism proof: a forced-action log replays + verifies -----------
// Drives a full Classic match where, inside an early window, the CURRENT
// decision is taken via `resolveForcedAction` (as the room would on a hard
// timeout) instead of the scripted driver — so the collected log contains real
// forced roll/endTurn (and, on a 7, discard/robber) events. The resulting log
// must (1) reach game.ended, (2) replay BYTE-IDENTICALLY from the lobby state,
// and (3) pass `verifyMatchRandomness` — proving the wall-clock never leaked
// into the deterministic core or the log.

const PLAYER_IDS: readonly PlayerId[] = ['alpha', 'bravo', 'charlie'];
const STEP_CAP = 6000;
/**
 * The seed the scripted driver is proven to carry to a 10-VP win (S1.7.2's
 * pinned E2E seed) — the determinism proof needs a match that actually REACHES
 * `game.ended`, so it reuses that seed rather than an arbitrary one.
 */
const MATCH_SEED: Seed = 'skervik-s1.7.2-e2e-match-seed';
/**
 * Force the current decision for the first N steps — roll/discard/robber always,
 * main endTurn up to K times. Tuned so the forced log includes every forced
 * event kind (rollDice/endTurn/moveRobber/discard) yet the driver still reaches
 * `game.ended` afterward (a wider window stalls the driver's economy).
 */
const FORCE_WINDOW = 80;
const MAX_FORCED_MAIN_ENDTURNS = 2;

function lobbyState(): GameState {
  return {
    matchId: 'forced-action-match',
    phase: 'lobby',
    turn: 0,
    currentPlayerId: '',
    players: [],
    eventIndex: 0,
    seedHash: 'e2e-seed-hash',
  };
}

function genesisEvents(seed: Seed): GameEvent[] {
  const matchStarted: MatchStartedEvent = {
    type: 'match.started',
    index: 0,
    matchId: 'forced-action-match',
    seedHash: 'e2e-seed-hash',
    playerIds: [...PLAYER_IDS],
    profileId: 'classic',
  };
  const layout = generateBoard(seed, topology);
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

interface ForcedSim {
  readonly finalState: GameState;
  readonly events: GameEvent[];
  readonly ended: GameEndedEvent | null;
  readonly forcedApplied: number;
}

function simulateWithForcedTurns(seed: Seed): ForcedSim {
  const genesis = genesisEvents(seed);
  let state = genesis.reduce((s, e) => reduce(s, e), lobbyState());
  const events: GameEvent[] = [...genesis];
  let steps = 0;
  let forcedApplied = 0;
  let forcedMainEndTurns = 0;
  let ended: GameEndedEvent | null = null;

  while (state.phase !== 'finished' && steps < STEP_CAP) {
    // Prefer the forced default for the current decision inside the window —
    // mirroring what a hard timeout injects — else fall back to the driver.
    const forced = resolveForcedAction(state);
    const wantForce =
      forced !== null &&
      steps < FORCE_WINDOW &&
      (state.phase !== 'main' || forcedMainEndTurns < MAX_FORCED_MAIN_ENDTURNS);

    let actorId: PlayerId | null = null;
    let intent = null as ReturnType<typeof decideAction>;
    if (wantForce && forced) {
      actorId = forced.playerId;
      intent = forced.intent;
      if (state.phase === 'main') forcedMainEndTurns += 1;
      forcedApplied += 1;
    } else {
      for (const p of state.players) {
        const candidate = decideAction(state, p.id);
        if (candidate) {
          actorId = p.id;
          intent = candidate;
          break;
        }
      }
    }

    if (!actorId || !intent) {
      throw new Error(`no legal move at step ${steps}, phase=${state.phase}`);
    }
    const result = validate(state, intent, actorId, seed);
    if (!result.ok) {
      throw new Error(
        `illegal intent ${intent.type} by ${actorId} rejected ${result.reason} ` +
          `at step ${steps}, phase=${state.phase}`,
      );
    }
    for (const event of result.events) {
      state = reduce(state, event);
      events.push(event);
      if (event.type === 'game.ended') ended = event;
    }
    steps += 1;
  }

  return { finalState: state, events, ended, forcedApplied };
}

describe('a match log CONTAINING forced (timed-out) actions replays + verifies (S2.1.4)', () => {
  it('reaches game.ended and actually applied forced actions', () => {
    const { ended, forcedApplied } = simulateWithForcedTurns(MATCH_SEED);
    expect(ended).not.toBeNull();
    expect(forcedApplied).toBeGreaterThan(0);
  });

  it('replays BYTE-IDENTICALLY from the lobby state (no timestamp ever leaked)', () => {
    const { finalState, events } = simulateWithForcedTurns(MATCH_SEED);
    expect(replay(lobbyState(), events)).toEqual(finalState);
  });

  it('the persisted events carry NO timestamp / deadline / timeout marker field', () => {
    const { events } = simulateWithForcedTurns(MATCH_SEED);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toMatch(/timestamp|deadline|timedOut|turnDeadline/i);
  });

  it('passes verifyMatchRandomness — every seed-derived draw is reproducible', () => {
    const { events } = simulateWithForcedTurns(MATCH_SEED);
    const verdict = verifyMatchRandomness(MATCH_SEED, events);
    expect(verdict.ok).toBe(true);
  });

  it('is deterministic — the identical forced run twice yields deep-equal state + log', () => {
    const a = simulateWithForcedTurns(MATCH_SEED);
    const b = simulateWithForcedTurns(MATCH_SEED);
    expect(a.finalState).toEqual(b.finalState);
    expect(a.events).toEqual(b.events);
  });
});
