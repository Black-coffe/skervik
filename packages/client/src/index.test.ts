import { describe, expect, it } from 'vitest';

import { CLIENT_VERSION } from './index.js';

describe('CLIENT_VERSION', () => {
  it('is the expected semver string', () => {
    expect(CLIENT_VERSION).toBe('0.0.1');
  });
});
