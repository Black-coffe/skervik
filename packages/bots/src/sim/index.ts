// S2.2.5 — balance-sim harness public surface: profile-parameterized
// bot-vs-bot sweeps over `@skervik/bots`' `simulateMatch`, folding the four
// story metrics (match length, comeback rate, final VP gap, seat win rate).
// Consumed by `../sim-cli.ts` (the `sim` script entry) and by this
// package's forcing tests. Changes NO core rule and NO preset — measurement
// only (see `docs/specs/m2-mode-platform/S2.2.5-balance-sim-harness.md`).
export {
  lastPlacePlayers,
  mean,
  median,
  midpointPublicVp,
  percentile,
} from './metrics.js';
export { type ProfileSweepSpec, SWEEP_PROFILES } from './profiles.js';
export {
  buildReport,
  formatMarkdownTable,
  SWEEP_NOTES,
  type SweepReport,
} from './report.js';
export {
  type ProfileSweepResult,
  runSweep,
  runSweepForProfile,
  SWEEP_BOT_DIFFICULTY,
  SWEEP_PLAYER_IDS,
  SWEEP_SEED_SALT,
  sweepSeeds,
} from './sweep.js';
