// @skervik/core — golden-replay determinism test (S0.5.4). Reads the
// fixture log/state with Node's `fs` (test-only — core's runtime deps stay
// zero, ADR-0003), parses it with the pure `parseEventLog`, replays it with
// `replayLog`, and asserts an exact deep-equal against the frozen golden
// state. This is the regression guard S0.3.2 wires into CI: it fails the
// moment the core stops being deterministic or its output shape changes.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseEventLog, replayLog } from './replay.js';
import { rollDie } from './rng.js';
import type { GameState } from './types.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const eventsNdjson = readFileSync(join(fixturesDir, 'golden.events.ndjson'), 'utf8');
const goldenState = JSON.parse(
  readFileSync(join(fixturesDir, 'golden.state.json'), 'utf8'),
) as GameState;

// The seed used to record `golden.events.ndjson`'s DICE_ROLLED lines.
// Revealed here the same way a match's seed is revealed post-match
// (`docs/wiki/fair-rng-commit-reveal.md`) — never read by `replayLog`
// itself, only used below to independently audit the recorded rolls.
const GOLDEN_SEED = 'skervik-golden-seed-3';

// Genesis state the recorded log is replayed from: the `match.started` line
// (seq 0) populates matchId/seedHash/phase/players/currentPlayerId, so the
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

describe('replayLog (golden fixture)', () => {
  it('parses golden.events.ndjson into typed log lines', () => {
    const entries = parseEventLog(eventsNdjson);

    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({ seq: 0, type: 'MATCH_STARTED' });
  });

  it('records a real rngStreamIndex on each random event line (fair-RNG audit)', () => {
    const entries = parseEventLog(eventsNdjson);
    const diceLines = entries.filter((entry) => entry.type === 'DICE_ROLLED');

    expect(diceLines.length).toBeGreaterThan(0);
    for (const line of diceLines) {
      expect(typeof line.rngStreamIndex).toBe('number');
      // Recomputable: anyone with the revealed seed can reproduce `result`
      // from `seed` + `rngStreamIndex` alone — the whole point of §6.4.
      expect(rollDie(GOLDEN_SEED, line.rngStreamIndex)).toBe(line.data.result);
    }
  });

  it('replays golden.events.ndjson into golden.state.json exactly (deep-equal)', () => {
    const entries = parseEventLog(eventsNdjson);

    const finalState = replayLog(genesisState, entries);

    expect(finalState).toEqual(goldenState);
  });

  it('is deterministic: replaying twice from the same log yields identical state', () => {
    const entries = parseEventLog(eventsNdjson);

    const first = replayLog(genesisState, entries);
    const second = replayLog(genesisState, entries);

    expect(first).toEqual(second);
    expect(first).toEqual(goldenState);
  });
});
