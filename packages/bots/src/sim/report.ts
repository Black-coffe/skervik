// S2.2.5 — report formatting: a machine-readable JSON payload and a markdown
// table, both pure functions of a `ProfileSweepResult[]` (no wall-clock in
// the payload — AC5 requires two runs at the same seed count to be
// BYTE-IDENTICAL, so nothing here may vary run-to-run other than the results
// themselves).
import {
  type ProfileSweepResult,
  SWEEP_BOT_DIFFICULTY,
  SWEEP_PLAYER_IDS,
  SWEEP_SEED_SALT,
} from './sweep.js';

/** The full JSON payload written to `sim-results.json` — reproducible at a fixed seed count. */
export interface SweepReport {
  readonly seeds: number;
  readonly seedSalt: string;
  readonly botDifficulty: string;
  readonly seatCount: number;
  /**
   * Comeback tie-rule (story): if two+ players tie for LAST place at the
   * midpoint turn, the match counts toward the comeback numerator only if the
   * winner was among the tied group.
   */
  readonly comebackTieRule: string;
  readonly excludedProfiles: readonly string[];
  readonly notes: readonly string[];
  readonly results: readonly ProfileSweepResult[];
}

export const SWEEP_NOTES: readonly string[] = [
  "Blitz's turn timers are inert in the sim (action-count cap, not wall clock) — only vpToWin:8 is measured here.",
  'eventTilesTest/eventTilesRobinHoodTest run at eventTilesInterval:2 (the test-profile value) — the shipping presets would use interval:3; the measured effect does not transfer unchanged.',
  'All metrics read PUBLIC VP only (computePublicVictoryPoints) — never hidden VP, so hiddenVp-profile numbers stay comparable to every other row.',
  'A stalled seed is EXCLUDED from turns/comeback/VP-gap/seat-win stats for that profile but is always listed under stalledSeeds — never silently dropped.',
];

export function buildReport(
  seeds: number,
  results: readonly ProfileSweepResult[],
): SweepReport {
  return {
    seeds,
    seedSalt: SWEEP_SEED_SALT,
    botDifficulty: SWEEP_BOT_DIFFICULTY,
    seatCount: SWEEP_PLAYER_IDS.length,
    comebackTieRule:
      'a midpoint tie for last counts toward the comeback numerator iff the winner was among the tied players',
    excludedProfiles: [
      'twoPlayer (needs neutralSettlements phantom placement + a different player count/genesis path — out of scope, Law 3)',
    ],
    notes: SWEEP_NOTES,
    results,
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function seatWinCol(rates: readonly number[]): string {
  return rates.map((r) => pct(r)).join('/');
}

/** One markdown table, one row per profile, plus a header documenting reproducibility inputs. */
export function formatMarkdownTable(report: SweepReport): string {
  const lines: string[] = [];
  lines.push(`# Balance-sim sweep (S2.2.5)`);
  lines.push('');
  lines.push(`- seeds per profile: ${report.seeds}`);
  lines.push(`- seed-derivation salt: \`${report.seedSalt}\``);
  lines.push(`- bot difficulty (all seats): \`${report.botDifficulty}\``);
  lines.push(`- seat count: ${report.seatCount}`);
  lines.push(`- comeback tie rule: ${report.comebackTieRule}`);
  lines.push(`- excluded: ${report.excludedProfiles.join('; ')}`);
  for (const note of report.notes) lines.push(`- note: ${note}`);
  lines.push('');
  lines.push(
    '| profile | n | median turns | p90 turns | comeback% | mean final VP gap | seat win% (1/2/3/4) | eventTilesInterval |',
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of report.results) {
    lines.push(
      `| ${r.label} | ${r.n} | ${r.medianTurns.toFixed(1)} | ${r.p90Turns.toFixed(1)} | ` +
        `${pct(r.comebackRate)} | ${r.meanFinalVpGap.toFixed(2)} | ${seatWinCol(r.seatWinRate)} | ` +
        `${r.eventTilesInterval} |`,
    );
  }
  lines.push('');
  const withStalls = report.results.filter((r) => r.stalledSeeds.length > 0);
  if (withStalls.length > 0) {
    lines.push(
      '## Stalled seeds (excluded from the stats above, never dropped silently)',
    );
    lines.push('');
    for (const r of withStalls) {
      lines.push(
        `- ${r.label}: ${r.stalledSeeds.length} of ${r.n} — ${r.stalledSeeds.join(', ')}`,
      );
    }
    lines.push('');
  } else {
    lines.push('No stalled seeds across any profile.');
    lines.push('');
  }
  return lines.join('\n');
}
