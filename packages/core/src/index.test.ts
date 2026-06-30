import { describe, expect, it } from 'vitest';

import { CORE_VERSION } from './index.js';

describe('CORE_VERSION', () => {
  it('is the expected semver string', () => {
    expect(CORE_VERSION).toBe('0.0.1');
  });
});
