#!/usr/bin/env node
// S2.2.5 — the `sim` script entry (`pnpm --filter @skervik/bots sim --seeds N`).
// Runs the balance-sim sweep, prints the markdown table to stdout, and writes
// the machine-readable `sim-results.json` next to this package (CWD, mirroring
// `@skervik/server`'s compiled `start.ts` process-entry precedent). No game
// rule, no preset, and no `SimResult` shape changes here — see the library in
// `./sim/`.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildReport, formatMarkdownTable, runSweep } from './sim/index.js';

const DEFAULT_SWEEP_SEED_COUNT = 100;

function parseSeedsArg(argv: readonly string[]): number {
  const idx = argv.indexOf('--seeds');
  if (idx === -1) return DEFAULT_SWEEP_SEED_COUNT;
  const raw = argv[idx + 1];
  const n = raw === undefined ? NaN : Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--seeds must be a positive integer, got: ${String(raw)}`);
  }
  return n;
}

function main(): void {
  const seeds = parseSeedsArg(process.argv.slice(2));
  const results = runSweep(seeds);
  const report = buildReport(seeds, results);

  process.stdout.write(formatMarkdownTable(report));
  process.stdout.write('\n');

  const outPath = join(process.cwd(), 'sim-results.json');
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stderr.write(`\nWrote ${outPath}\n`);
}

main();
