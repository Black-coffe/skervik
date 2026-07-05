import type { GamePhase } from '@skervik/core';
import { describe, expect, it } from 'vitest';

import { PHASE_KEY } from './phase.js';

describe('PHASE_KEY', () => {
  const phases: readonly GamePhase[] = [
    'lobby',
    'setup',
    'roll',
    'main',
    'robber',
    'finished',
  ];

  it.each(phases)('maps %s to a phase.* key', (phase) => {
    expect(PHASE_KEY[phase]).toBe(`phase.${phase}`);
  });
});
