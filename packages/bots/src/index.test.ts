import { describe, expect, it } from 'vitest';

import { BOTS_VERSION } from './index.js';

describe('BOTS_VERSION', () => {
  it('is the expected semver string', () => {
    expect(BOTS_VERSION).toBe('0.0.1');
  });
});
