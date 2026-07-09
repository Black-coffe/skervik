// S2.2.5 Constraint 1 (forcing check) — `simulateMatch`'s `profileId` option
// must NOT shift Classic's event bytes: the genesis `match.started` event
// must carry NO `profileId` key at all on the default/Classic path (not
// `profileId: 'classic'`, not `profileId: undefined`), and MUST carry the key
// on any non-Classic profile. `harness.test.ts` (S2.4.1/S2.4.2) stays
// unmodified — this is a NEW, separate file.
import type { PlayerId, Seed } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { createHeuristicBot } from './bot.js';
import { simulateMatch } from './harness.js';

const SEED: Seed = 'skervik-s1.7.2-e2e-match-seed';
const PLAYER_IDS: readonly PlayerId[] = ['alpha', 'bravo', 'charlie'];

function threeHeuristicBots(): Record<PlayerId, ReturnType<typeof createHeuristicBot>> {
  return {
    alpha: createHeuristicBot(),
    bravo: createHeuristicBot(),
    charlie: createHeuristicBot(),
  };
}

describe('simulateMatch — profileId genesis wiring (S2.2.5 Constraint 1)', () => {
  it('the default (no profileId) path emits match.started WITHOUT a profileId key', () => {
    const { events } = simulateMatch({
      seed: SEED,
      playerIds: PLAYER_IDS,
      bots: threeHeuristicBots(),
    });

    const genesis = events[0];
    expect(genesis?.type).toBe('match.started');
    expect('profileId' in (genesis as object)).toBe(false);
  });

  it("an explicit profileId:'classic' ALSO emits match.started WITHOUT a profileId key", () => {
    const { events } = simulateMatch({
      seed: SEED,
      playerIds: PLAYER_IDS,
      bots: threeHeuristicBots(),
      profileId: 'classic',
    });

    const genesis = events[0];
    expect('profileId' in (genesis as object)).toBe(false);
  });

  it('a non-Classic profileId (balanced) emits match.started WITH the profileId key', () => {
    const { events } = simulateMatch({
      seed: SEED,
      playerIds: PLAYER_IDS,
      bots: threeHeuristicBots(),
      profileId: 'balanced',
    });

    const genesis = events[0];
    expect(genesis?.type).toBe('match.started');
    expect('profileId' in (genesis as object)).toBe(true);
    expect((genesis as { profileId?: string }).profileId).toBe('balanced');
  });
});
