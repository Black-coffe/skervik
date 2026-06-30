import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION, type ProtocolPlayerId } from './index.js';

describe('PROTOCOL_VERSION', () => {
  it('is the expected semver string', () => {
    expect(PROTOCOL_VERSION).toBe('0.0.1');
  });
});

describe('cross-package type wiring (@skervik/core)', () => {
  it('resolves ProtocolPlayerId (a @skervik/core type-only import) at compile time', () => {
    const playerId: ProtocolPlayerId = 'player-1';
    expect(typeof playerId).toBe('string');
  });
});
