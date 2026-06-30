import { describe, expect, it } from 'vitest';

import { SERVER_VERSION } from './index.js';

describe('SERVER_VERSION', () => {
  it('is the expected semver string', () => {
    expect(SERVER_VERSION).toBe('0.0.1');
  });
});
