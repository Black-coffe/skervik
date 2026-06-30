// ESLint v10 flat config — applies to all workspace packages.
// ADR-0003 guard (packages/core): no Math.random, Date.now, new Date.
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

export default tseslint.config(
  // Ignore build artifacts and generated output.
  {
    ignores: ['**/dist/**', '**/build/**', '**/coverage/**', 'node_modules/**'],
  },

  // All TypeScript source files across all packages.
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    extends: tseslint.configs.recommended,
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      // Import ordering — keeps dependency graph readable.
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // Unused symbols must be removed or prefixed with _.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ADR-0003: @skervik/core must be purely deterministic.
  // No wall-clock time, no ambient randomness — these break replays and
  // client-prediction. Randomness enters only as seeded PRNG event data.
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.object.name="Math"][callee.property.name="random"]',
          message:
            'Math.random() is non-deterministic — forbidden in @skervik/core (ADR-0003). Use the seeded PRNG instead.',
        },
        {
          selector:
            'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
          message:
            'Date.now() is non-deterministic — forbidden in @skervik/core (ADR-0003). Pass timestamps as event data.',
        },
        {
          selector: 'NewExpression[callee.name="Date"]',
          message:
            'new Date() is non-deterministic — forbidden in @skervik/core (ADR-0003). Pass timestamps as event data.',
        },
      ],
    },
  },

  // Prettier compatibility: disable ESLint formatting rules that would
  // conflict with Prettier. Must be the last entry.
  prettier,
);
