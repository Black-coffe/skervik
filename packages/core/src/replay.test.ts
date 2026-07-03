// @skervik/core — golden-replay determinism test. Reads the fixture log/state
// with Node's `fs` (test-only — core's runtime deps stay zero, ADR-0003),
// parses the ndjson into the bare {@link GameEvent}[] with the pure
// `parseGameEventLog`, folds it through `replay`, and asserts an exact
// deep-equal against the frozen golden state. This is the regression guard CI
// wires into its named core-determinism gate (ADR-0009 Fork 2): it fails the
// moment the core stops being deterministic or its output shape changes.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { replay } from './reduce.js';
import { parseGameEventLog } from './replay.js';
import { gameplayStreamIndex, rollDie } from './rng.js';
import type { GameEvent, GameState } from './types.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const eventsNdjson = readFileSync(join(fixturesDir, 'golden.events.ndjson'), 'utf8');
const goldenState = JSON.parse(
  readFileSync(join(fixturesDir, 'golden.state.json'), 'utf8'),
) as GameState;

// The seed used to record `golden.events.ndjson`'s dice.rolled events.
// Revealed here the same way a match's seed is revealed post-match
// (`docs/wiki/fair-rng-commit-reveal.md`) — never read by `replay` itself,
// only used below to independently audit the recorded rolls.
const GOLDEN_SEED = 'skervik-golden-seed-3';

// Genesis state the recorded log is replayed from: the `match.started` event
// (index 0) populates matchId/seedHash/phase/players/currentPlayerId, so the
// values here are placeholders that get fully overwritten by event index 0.
const genesisState: GameState = {
  matchId: '',
  phase: 'lobby',
  turn: 0,
  currentPlayerId: '',
  players: [],
  eventIndex: 0,
  seedHash: '',
};

describe('parseGameEventLog + replay (golden fixture)', () => {
  it('parses golden.events.ndjson into bare GameEvents', () => {
    const events = parseGameEventLog(eventsNdjson);

    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({ type: 'match.started', index: 0 });
  });

  it('records recomputable dice rolls (fair-RNG audit)', () => {
    const events = parseGameEventLog(eventsNdjson);
    const diceEvents = events.filter((event) => event.type === 'dice.rolled');

    expect(diceEvents.length).toBeGreaterThan(0);
    for (const event of diceEvents) {
      // In the bare event-sourced format the roll's own `index` IS the base
      // PRNG stream index (`validate` draws from `gameplayStreamIndex(
      // state.eventIndex, slot)` and stamps the event `index = eventIndex`) —
      // so anyone with the revealed seed can reproduce both dice faces from
      // `seed` + `event.index` alone via the gameplay stream's slot map
      // (slot 0 = die A, slot 1 = die B — `docs/wiki/rng-stream-map.md` §1).
      expect(rollDie(GOLDEN_SEED, gameplayStreamIndex(event.index, 0))).toBe(event.dieA);
      expect(rollDie(GOLDEN_SEED, gameplayStreamIndex(event.index, 1))).toBe(event.dieB);
      expect(event.dieA + event.dieB).toBe(event.total);
    }
  });

  it('replays golden.events.ndjson into golden.state.json exactly (deep-equal)', () => {
    const events = parseGameEventLog(eventsNdjson);

    const finalState = replay(genesisState, events);

    expect(finalState).toEqual(goldenState);
  });

  it('is deterministic: replaying twice from the same log yields identical state', () => {
    const events = parseGameEventLog(eventsNdjson);

    const first = replay(genesisState, events);
    const second = replay(genesisState, events);

    expect(first).toEqual(second);
    expect(first).toEqual(goldenState);
  });
});

describe('parseGameEventLog round-trips events the legacy format could not', () => {
  it('round-trips a dice.rolled + resources.produced sequence losslessly', () => {
    // The retired UPPER_CASE wire format only encoded match.started/dice.rolled/
    // turn.ended — it had no `RESOURCES_PRODUCED` line, so a roll's production
    // payout could never be persisted or replayed. The bare-GameEvent format
    // carries every event `reduce` understands verbatim; prove it here.
    const events: GameEvent[] = [
      { type: 'dice.rolled', index: 1, playerId: 'player-1', dieA: 2, dieB: 3, total: 5 },
      {
        type: 'resources.produced',
        index: 2,
        grants: { 'player-1': { brick: 1, grain: 2 } },
        bank: { brick: 18, grain: 17 },
      },
    ];

    const ndjson = events.map((event) => JSON.stringify(event)).join('\n');
    const parsed = parseGameEventLog(ndjson);

    // Encoding is lossless: the parsed events equal the originals field-for-field.
    expect(parsed).toEqual(events);

    const base: GameState = {
      matchId: 'm',
      phase: 'roll',
      turn: 1,
      currentPlayerId: 'player-1',
      players: [{ id: 'player-1', name: 'player-1', victoryPoints: 0, resources: {} }],
      eventIndex: 1,
      seedHash: '',
    };

    const finalState = replay(base, parsed);

    // The production event — invisible to the legacy format — replays: the
    // player is credited and the bank pool is recorded.
    expect(finalState.players[0]?.resources).toEqual({ brick: 1, grain: 2 });
    expect(finalState.bank).toEqual({ brick: 18, grain: 17 });
    expect(finalState.eventIndex).toBe(3);
  });
});
