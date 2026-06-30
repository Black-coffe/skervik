import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION } from './index.js';

describe('PROTOCOL_VERSION', () => {
  it('is the expected semver string', () => {
    expect(PROTOCOL_VERSION).toBe('0.0.1');
  });
});
