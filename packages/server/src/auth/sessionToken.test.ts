// S2.6.2a AC2 — session token round-trips + rejects tampering/expiry/wrong-secret.
import { describe, expect, it } from 'vitest';

import {
  resolveSessionSecret,
  signSessionToken,
  verifySessionToken,
} from './sessionToken.js';

const SECRET = new TextEncoder().encode('test-secret-do-not-ship');
const OTHER = new TextEncoder().encode('a-different-secret-entirely');

describe('sessionToken (S2.6.2a)', () => {
  it('round-trips signed claims (AC2)', async () => {
    const token = await signSessionToken({ userId: 'u-1', displayName: 'Nemo' }, SECRET);
    await expect(verifySessionToken(token, SECRET)).resolves.toEqual({
      userId: 'u-1',
      displayName: 'Nemo',
    });
  });

  it('rejects a token signed with a DIFFERENT secret (AC2)', async () => {
    const token = await signSessionToken({ userId: 'u-1', displayName: 'Nemo' }, OTHER);
    await expect(verifySessionToken(token, SECRET)).resolves.toBeNull();
  });

  it('rejects a tampered token (AC2)', async () => {
    const token = await signSessionToken({ userId: 'u-1', displayName: 'Nemo' }, SECRET);
    // Flip a character in the payload segment — signature no longer matches.
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}x.${parts[2]}`;
    await expect(verifySessionToken(tampered, SECRET)).resolves.toBeNull();
  });

  it('rejects an expired token (AC2)', async () => {
    const token = await signSessionToken({ userId: 'u-1', displayName: 'Nemo' }, SECRET, {
      // Already expired (jose accepts a negative/past relative expiry).
      expiresIn: '-1s',
    });
    await expect(verifySessionToken(token, SECRET)).resolves.toBeNull();
  });

  it('rejects garbage / non-JWT input', async () => {
    await expect(verifySessionToken('not-a-jwt', SECRET)).resolves.toBeNull();
    await expect(verifySessionToken('', SECRET)).resolves.toBeNull();
  });

  it('resolveSessionSecret reads SESSION_SECRET when set', () => {
    const secret = resolveSessionSecret({
      SESSION_SECRET: 'from-env',
    } as NodeJS.ProcessEnv);
    expect(secret).toEqual(new TextEncoder().encode('from-env'));
  });

  it('resolveSessionSecret mints an ephemeral 32-byte secret + warns when absent', () => {
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const secret = resolveSessionSecret({} as NodeJS.ProcessEnv);
      expect(secret).toBeInstanceOf(Uint8Array);
      expect(secret.length).toBe(32);
      expect(warnings.length).toBe(1);
    } finally {
      console.warn = original;
    }
  });
});
