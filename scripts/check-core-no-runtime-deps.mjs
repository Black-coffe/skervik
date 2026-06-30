// ADR-0003 guard: @skervik/core is the deterministic isomorphic rule engine and
// MUST keep zero runtime dependencies (it is reused verbatim on client & server).
// CI runs this; it also runs locally via `pnpm run check:core-deps`.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = resolve(root, 'packages/core/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const deps = Object.keys(pkg.dependencies ?? {});

if (deps.length > 0) {
  console.error(
    `✗ ADR-0003 violated: @skervik/core must have zero runtime dependencies, ` +
      `but package.json declares: ${deps.join(', ')}.\n` +
      `  The core engine is bundled into both client and server — keep it dependency-free.`,
  );
  process.exit(1);
}

console.log('✓ @skervik/core has zero runtime dependencies (ADR-0003).');
