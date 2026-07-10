// S2.4.4 — the FORCING integration test: this story exists because a green
// forcing test once certified a poverty token was GRANTED. The mechanic's
// outcome is a SPEND. Across a small seed sweep under `robinHoodTest`, at
// least one `bank.trade` event must carry `povertyDiscount: true`.
//
// This test is deliberately kept in its own file, importing NOTHING new from
// `eval/features.ts` or `heuristic/v1.ts` beyond what already existed before
// S2.4.4 (`simulateMatch`, `createHeuristicBot`, `EXPERIMENTAL_PROFILE_IDS`,
// the S2.2.5 sweep seed/cohort helpers) — so it can be run standalone against
// the PRE-fix bot to prove the defect (verified: FAILS on the old
// `bankTradeToward`, which always proposed `count: bestBankRate(...)`, the
// same rate `validate.ts`'s discount branch requires `intent.count` to
// differ from — zero discounted trades in 3000 matches, S2.2.5 Diagnostic A).
import { EXPERIMENTAL_PROFILE_IDS, type PlayerId } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { type Bot, createHeuristicBot } from '../bot.js';
import { simulateMatch } from '../harness.js';
import { SWEEP_PLAYER_IDS, sweepSeeds } from '../sim/sweep.js';

describe('bankTradeToward — integration: the poverty discount actually executes (S2.4.4)', () => {
  it('at least one bank.trade event across a seed sweep under robinHoodTest carries povertyDiscount:true', () => {
    const seeds = sweepSeeds(30);
    const difficulty = 'hard';
    let sawDiscount = false;
    for (const seed of seeds) {
      const bots: Record<PlayerId, Bot> = {};
      for (const id of SWEEP_PLAYER_IDS) {
        bots[id] = createHeuristicBot({
          difficulty,
          seed: `${difficulty}-${seed}-${id}`,
        });
      }
      const { events } = simulateMatch({
        seed,
        playerIds: SWEEP_PLAYER_IDS,
        bots,
        profileId: EXPERIMENTAL_PROFILE_IDS.robinHood,
      });
      if (events.some((e) => e.type === 'bank.trade' && e.povertyDiscount === true)) {
        sawDiscount = true;
        break;
      }
    }
    expect(sawDiscount).toBe(true);
  });
});
