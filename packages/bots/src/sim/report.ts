// S2.2.5 — report formatting: a machine-readable JSON payload and a markdown
// table, both pure functions of a `ProfileSweepResult[]` (no wall-clock in
// the payload — AC5 requires two runs at the same seed count to be
// BYTE-IDENTICAL, so nothing here may vary run-to-run other than the results
// themselves).
import { computeAllLengthSplits, type LengthSplit } from './lengthSplit.js';
import {
  computeAllDiscordantPairs,
  type DiscordantPairs,
  PRIMARY_OUTCOME,
  SENSITIVITY_OUTCOME,
} from './pairing.js';
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
  /** The PRIMARY comeback definition (S2.2.5a) — VP-relative, invariant to `vpToWin`. */
  readonly comebackMetric: string;
  /** The SENSITIVITY comeback definition — the old anchor, with ties dropped from the denominator. */
  readonly sensitivityMetric: string;
  /** The `vpToWin` whose anchor cuts EVERY arm was scored at, or `null` for a self-scored run. */
  readonly scoredAtVpToWin: number | null;
  /** `true` when each arm scored itself — the CONFOUNDED variant; `discordantPairs` then report anchor placement. */
  readonly selfScored: boolean;
  readonly excludedProfiles: readonly string[];
  readonly notes: readonly string[];
  readonly results: readonly ProfileSweepResult[];
  /** Each non-Classic profile's paired, per-seed PRIMARY comeback comparison against Classic. */
  readonly discordantPairs: readonly DiscordantPairs[];
  /** The same paired comparison on the SENSITIVITY outcome — must agree with {@link discordantPairs}. */
  readonly sensitivityDiscordantPairs: readonly DiscordantPairs[];
  /**
   * EXPLORATORY (not a hypothesis test — no p-value): for EACH profile,
   * splits its own completed matches at its own median `turns` and reports
   * the comeback rate in the shorter vs. longer half. Answers "does match
   * length alone predict a comeback, within one profile" independent of any
   * catch-up flag (team-lead diagnostic).
   */
  readonly lengthSplits: readonly LengthSplit[];
}

export const SWEEP_NOTES: readonly string[] = [
  "Blitz's turn timers are inert in the sim (action-count cap, not wall clock) — only vpToWin:8 is measured here.",
  'eventTilesTest/eventTilesRobinHoodTest run at eventTilesInterval:2 (the test-profile value) — the shipping presets would use interval:3; the measured effect does not transfer unchanged.',
  'All metrics read PUBLIC VP only (computePublicVictoryPoints) — never hidden VP, so hiddenVp-profile numbers stay comparable to every other row.',
  'A stalled seed is EXCLUDED from turns/comeback/VP-gap/seat-win stats for that profile but is always listed under stalledSeeds — never silently dropped.',
  'S2.2.5a: the comeback metric was REPLACED. The old rule ("winner among the players tied for last at ceil(finalTurn/2)") scaled with the size of the midpoint tie-set, and a lower vpToWin enlarges that tie-set — so the metric moved with the treatment. Every comeback number produced under seedSalt `balance-sim-salt` is void.',
  "Read the confound audit BEFORE the headline: if the within-stratum comeback rates agree across profiles and only the trailing-count WEIGHTS differ, the headline difference is an artifact and no verdict may be drawn. Under a null, stratum k's rate is k/4.",
  'pValue is APPROXIMATE (Abramowitz & Stegun 7.1.26 normal CDF, |err|<7.5e-8) and is printed as "<1e-6" below that clamp — deep-tail digits from this approximation are float-grid noise, and it underflows to exactly 0 for chiSquare > ~70.',
  'LIMITATION: the v1 bot is vpToWin-blind, so classic/blitz/vp9 share a byte-identical event prefix on a shared seed. That is what makes the matched-cut contrast clean — and it means only ONE channel was measured: "the same game, stopped earlier", which mechanically favours whoever leads. A human at vpToWin:8 races. The strategy-adaptation channel is invisible to this harness at ANY sample size.',
];

/** Appended to {@link SWEEP_NOTES} only for a `selfScored` run — its pairs are confounded by construction. */
export const SELF_SCORED_WARNING =
  'SELF-SCORED RUN: each arm scored its anchor at its OWN vpToWin, so arms with different vpToWin were measured at different points of the same game. The discordantPairs below report ANCHOR PLACEMENT, not catch-up, and must not be cited as a comeback effect. This mode exists only to reproduce the S2.2.5a artifact (blitz chiSquare=627.34, which REVERSES to "fewer comebacks" when both arms are scored at classic\'s cuts).';

export function buildReport(
  seeds: number,
  results: readonly ProfileSweepResult[],
): SweepReport {
  // A run is self-scored iff its arms disagree about the cuts they were scored
  // at. `pairing.ts` then reports anchor placement rather than catch-up, so the
  // escape hatch is opened HERE, once, and labelled in the output.
  const cuts = new Set(results.map((r) => r.scoredAtVpToWin));
  const selfScored = cuts.size > 1;
  const pairOptions = { allowMismatchedCuts: selfScored };

  return {
    seeds,
    seedSalt: SWEEP_SEED_SALT,
    botDifficulty: SWEEP_BOT_DIFFICULTY,
    seatCount: SWEEP_PLAYER_IDS.length,
    comebackMetric:
      "PRIMARY: the winner was TRAILING at the anchor turn T* — the first turn at which the leader reaches ceil(V/2) public VP, where V = scoredAtVpToWin. A player is trailing iff leaderVp - publicVp(p) >= ceil(V/4). EVERY arm is scored at the SAME V (the classic baseline's) unless selfScored, because ceil(V/2) is 4 for blitz and 5 for classic — an arm scored at its own V is measured at a different point of the same game. A four-way tie has NOBODY trailing and cannot be a comeback.",
    sensitivityMetric:
      'SENSITIVITY: the winner was the UNIQUE last-place player at the old, endogenous midpoint turn ceil(finalTurn/2). Ties are DROPPED from the denominator (counted as sensitivityTiesDropped), never credited to every tied player. This check conditions on tie-freeness, a POST-TREATMENT variable the treatment moves, so it is not a valid causal contrast and cannot arbitrate a disagreement with the primary outcome.',
    scoredAtVpToWin: selfScored ? null : (results[0]?.scoredAtVpToWin ?? null),
    selfScored,
    excludedProfiles: [
      'twoPlayer (needs neutralSettlements phantom placement + a different player count/genesis path — out of scope, Law 3)',
    ],
    notes: selfScored ? [...SWEEP_NOTES, SELF_SCORED_WARNING] : SWEEP_NOTES,
    results,
    discordantPairs: computeAllDiscordantPairs(results, PRIMARY_OUTCOME, pairOptions),
    sensitivityDiscordantPairs: computeAllDiscordantPairs(
      results,
      SENSITIVITY_OUTCOME,
      pairOptions,
    ),
    lengthSplits: computeAllLengthSplits(results),
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/**
 * S2.2.5a / reviewer finding S-1: below 1e-6 the Abramowitz & Stegun tail is
 * float-grid noise (and hits exactly 0 past chiSquare ~70), so printing
 * `0.0000` asserts a precision the estimator does not have.
 */
function formatPValue(p: number): string {
  return p < 1e-6 ? '<1e-6' : p.toFixed(6);
}

function seatWinCol(rates: readonly number[]): string {
  return rates.map((r) => pct(r)).join('/');
}

/** One markdown table, one row per profile, plus a header documenting reproducibility inputs. */
export function formatMarkdownTable(report: SweepReport): string {
  const lines: string[] = [];
  lines.push(`# Balance-sim sweep (S2.2.5, metric corrected in S2.2.5a)`);
  lines.push('');
  lines.push(`- seeds per profile: ${report.seeds}`);
  lines.push(`- seed-derivation salt: \`${report.seedSalt}\``);
  lines.push(`- bot difficulty (all seats): \`${report.botDifficulty}\``);
  lines.push(`- seat count: ${report.seatCount}`);
  lines.push(
    `- anchor scoring: ${
      report.selfScored
        ? '**SELF-SCORED (CONFOUNDED)** — each arm scored at its own vpToWin'
        : `every arm scored at vpToWin=${report.scoredAtVpToWin} (the \`classic\` baseline's cuts)`
    }`,
  );
  lines.push(`- comeback metric: ${report.comebackMetric}`);
  lines.push(`- sensitivity metric: ${report.sensitivityMetric}`);
  lines.push(`- excluded: ${report.excludedProfiles.join('; ')}`);
  for (const note of report.notes) lines.push(`- note: ${note}`);
  lines.push('');
  lines.push(
    '| profile | n | own vpToWin | scored at | anchor VP | deficit | median turns | p90 turns | comeback% [95% CI] | sensitivity% [95% CI] (n, ties dropped) | mean final VP gap | seat win% (1/2/3/4) | eventTilesInterval |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of report.results) {
    lines.push(
      `| ${r.label} | ${r.n} | ${r.vpToWin} | ${r.scoredAtVpToWin} | ${r.anchorVp} | >=${r.deficitThreshold} | ` +
        `${r.medianTurns.toFixed(1)} | ${r.p90Turns.toFixed(1)} | ` +
        `${pct(r.comebackRate)} [${pct(r.comebackRateCI.low)}-${pct(r.comebackRateCI.high)}] | ` +
        `${pct(r.sensitivityComebackRate)} [${pct(r.sensitivityComebackRateCI.low)}-${pct(r.sensitivityComebackRateCI.high)}] ` +
        `(${r.sensitivityN}, ${r.sensitivityTiesDropped}) | ` +
        `${r.meanFinalVpGap.toFixed(2)} | ${seatWinCol(r.seatWinRate)} | ${r.eventTilesInterval} |`,
    );
  }
  lines.push('');

  lines.push('## Confound audit — READ THIS BEFORE THE HEADLINE (S2.2.5a §2)');
  lines.push('');
  lines.push(
    'The metric this table replaces failed because its numerator scaled with the size of ' +
      'the midpoint tie-set, and the treatment (vpToWin) moved that size. So the corrected ' +
      'metric ships with the audit that would have caught it. `trailingCount` is how many ' +
      'of the 4 players were trailing at T*; the histogram is the STRATUM WEIGHTS and the ' +
      'per-stratum rates are the EFFECT. Under a null (winner uniform over seats), stratum ' +
      "k's comeback rate is exactly k/4 — 0%, 25%, 50%, 75%. **If the per-stratum rates " +
      'agree across profiles and only the weights differ, any headline difference is an ' +
      'artifact and NO verdict may be drawn.**',
  );
  lines.push('');
  lines.push(
    '| profile | T* median | T* p90 | trailingCount 0 | 1 | 2 | 3 | zeroTrailing | anchorMissing |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of report.results) {
    const h = r.trailingCountHistogram;
    lines.push(
      `| ${r.label} | ${r.medianAnchorTurn.toFixed(1)} | ${r.p90AnchorTurn.toFixed(1)} | ` +
        `${h['0'] ?? 0} | ${h['1'] ?? 0} | ${h['2'] ?? 0} | ${h['3'] ?? 0} | ` +
        `${r.zeroTrailingMatches} | ${r.anchorMissingMatches} |`,
    );
  }
  lines.push('');
  lines.push(
    '| profile | rate @1 (null 25%) | rate @2 (null 50%) | rate @3 (null 75%) | P(win \\| trailing) [95% CI] (slots) |',
  );
  lines.push('|---|---|---|---|---|');
  for (const r of report.results) {
    const s = r.comebackByTrailingCount;
    const cell = (k: string): string => {
      const stratum = s[k];
      if (!stratum || stratum.matches === 0) return 'n/a (0)';
      return `${pct(stratum.rate)} (${stratum.comebacks}/${stratum.matches})`;
    };
    lines.push(
      `| ${r.label} | ${cell('1')} | ${cell('2')} | ${cell('3')} | ` +
        `${pct(r.pWinGivenTrailing)} [${pct(r.pWinGivenTrailingCI.low)}-${pct(r.pWinGivenTrailingCI.high)}] ` +
        `(${r.trailingSlots}) |`,
    );
  }
  lines.push('');
  lines.push(
    '`P(win | trailing)` is computed over (match, player) SLOTS, not matches: the denominator ' +
      'is every player who was trailing at T*, the numerator every such player who went on to ' +
      'win. Under a null of "trailing does not matter" it is ~0.25 by symmetry, so it reads ' +
      'directly as "how much worse than a coin-flip-fair seat is a trailing player" — unlike a ' +
      'marginal rate, whose scale depends on how many players happen to be trailing.',
  );
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

  lines.push('## Poverty-token diagnostics (grant vs. spend)');
  lines.push('');
  lines.push(
    'poverty.tokensGranted EVENTS proves a token was GRANTED. It does NOT prove one was ' +
      'ever SPENT — the only spend path is a bank.trade carrying povertyDiscount:true ' +
      '(validate.ts:1993-2002, reduce.ts:729). If discountTrades is 0 while grantedEvents ' +
      'is >0, the benefit half of the mechanic never ran for this cohort.',
  );
  lines.push('');
  lines.push(
    '| profile | grantedEvents | grantedTotal (token-units) | discountTrades | tokensAtEnd histogram (players × completed matches) |',
  );
  lines.push('|---|---|---|---|---|');
  for (const r of report.results) {
    const histogram = Object.entries(r.povertyTokensAtEndHistogram)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([tokens, count]) => `${tokens}:${count}`)
      .join(', ');
    lines.push(
      `| ${r.label} | ${r.povertyTokensGrantedEvents} | ${r.povertyTokensGrantedTotal} | ` +
        `${r.povertyDiscountTrades} | ${histogram || '(no completed seeds)'} |`,
    );
  }
  lines.push('');

  const pairTable = (pairs: readonly DiscordantPairs[]): void => {
    lines.push(
      '| profile | n | bothComeback | neitherComeback | profileOnly | baselineOnly | chiSquare | pValue |',
    );
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const d of pairs) {
      lines.push(
        `| ${d.profileLabel} | ${d.n} | ${d.bothComeback} | ${d.neitherComeback} | ` +
          `${d.profileOnlyComeback} | ${d.baselineOnlyComeback} | ${d.mcNemarChiSquare.toFixed(2)} | ` +
          `${formatPValue(d.pValue)} |`,
      );
    }
    lines.push('');
  };

  lines.push(
    '## Discordant-pair comparison vs. Classic (McNemar-style, per-seed) — PRIMARY',
  );
  lines.push('');
  lines.push(
    'For each profile, on the SAME seed set: how many seeds did the profile win a ' +
      'comeback that Classic, on that exact seed, did NOT (profileOnly) — and vice versa ' +
      '(baselineOnly). n counts only seeds where BOTH sides produced an outcome. chiSquare is ' +
      'the continuity-corrected McNemar statistic on the discordant pairs (1 df; compare ' +
      'against 3.841 for p<0.05 two-sided). pValue is an APPROXIMATE two-sided p (see the ' +
      'notes above), clamped to "<1e-6". A significant chiSquare here means NOTHING unless ' +
      'the confound audit above shows the per-stratum rates, not the weights, moved.',
  );
  lines.push('');
  pairTable(report.discordantPairs);

  lines.push(
    '## The same comparison on the SENSITIVITY outcome (old anchor, ties dropped)',
  );
  lines.push('');
  lines.push(
    'A robustness check on the anchor, not a second hypothesis test. If a profile is ' +
      'significant here but not above (or vice versa), the two anchors disagree and neither ' +
      'result may be reported as a verdict — the anchor still leaks the treatment.',
  );
  lines.push('');
  pairTable(report.sensitivityDiscordantPairs);

  lines.push(
    '## Match-length vs. comeback split (EXPLORATORY — descriptive, not a hypothesis test)',
  );
  lines.push('');
  lines.push(
    'For EACH profile, splits its own completed matches at its own median `turns` and ' +
      'reports the comeback rate in the shorter half vs. the longer half. Answers whether ' +
      'match length alone predicts a comeback WITHIN one profile, independent of any ' +
      'catch-up flag. No p-value is attached — this is descriptive, not pre-registered.',
  );
  lines.push('');
  lines.push(
    '| profile | n | medianTurns (split point) | shorterN | shorter comeback% | longerN | longer comeback% |',
  );
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of report.lengthSplits) {
    lines.push(
      `| ${s.label} | ${s.n} | ${s.medianTurns.toFixed(1)} | ${s.shorterN} | ` +
        `${pct(s.shorterComebackRate)} | ${s.longerN} | ${pct(s.longerComebackRate)} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}
