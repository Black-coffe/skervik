// @skervik/server — S1.4.3: the commit half of commit-reveal. `sha256Hex` is
// the public `seedHash` commitment, so it is pinned to a KNOWN SHA-256 vector
// (regression guard, folds the S1.4.1 review nit): if the digest ever drifts,
// every published `seedHash` silently stops matching its revealed seed and the
// fairness audit breaks. `generateSeed` is checked only for shape (its output
// is CSPRNG-random, so it cannot be pinned).
import { describe, expect, it } from 'vitest';

import { generateSeed, sha256Hex } from './seed.js';

describe('sha256Hex (commit-reveal commitment)', () => {
  it('matches the canonical NIST SHA-256("abc") vector', () => {
    // FIPS 180-4 published vector: SHA-256 of the ASCII string "abc".
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('matches the canonical SHA-256("") empty-string vector', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is a pure function — same input always hashes to the same 64-char lowercase hex', () => {
    const seed = generateSeed();
    const first = sha256Hex(seed);
    expect(first).toBe(sha256Hex(seed));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateSeed', () => {
  it('produces a 64-char (32-byte) lowercase-hex seed', () => {
    expect(generateSeed()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unpredictable — two calls do not collide', () => {
    expect(generateSeed()).not.toBe(generateSeed());
  });
});
