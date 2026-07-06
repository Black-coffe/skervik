import type { VersionErrorMessage } from '@skervik/protocol';
import { describe, expect, it } from 'vitest';

import { parseJoinError, statusForLeaveCode } from './connection.js';

const versionError: VersionErrorMessage = {
  v: 1,
  type: 'error.version',
  payload: {
    code: 'PROTOCOL_VERSION_MISMATCH',
    serverVersion: '0.0.2',
    clientVersion: '0.0.1',
  },
};

describe('statusForLeaveCode', () => {
  it('maps a consented leave (4000) to disconnected', () => {
    expect(statusForLeaveCode(4000)).toBe('disconnected');
  });

  it('maps any other close code to reconnecting (unexpected drop)', () => {
    expect(statusForLeaveCode(1006)).toBe('reconnecting');
    expect(statusForLeaveCode(1001)).toBe('reconnecting');
  });
});

describe('parseJoinError', () => {
  it('parses a version-mismatch rejection (JSON error.version in .message)', () => {
    const error = { message: JSON.stringify(versionError) };
    const result = parseJoinError(error);
    expect(result.status).toBe('version-mismatch');
    expect(result.versionMismatch).toEqual({
      serverVersion: '0.0.2',
      clientVersion: '0.0.1',
    });
  });

  it('preserves a null clientVersion (missing/non-string handshake)', () => {
    const withNull: VersionErrorMessage = {
      ...versionError,
      payload: { ...versionError.payload, clientVersion: null },
    };
    const result = parseJoinError({ message: JSON.stringify(withNull) });
    expect(result.status).toBe('version-mismatch');
    expect(result.versionMismatch).toEqual({
      serverVersion: '0.0.2',
      clientVersion: null,
    });
  });

  it('falls back to a generic error for a non-JSON message', () => {
    const result = parseJoinError({ message: 'network is unreachable' });
    expect(result).toEqual({ status: 'error', versionMismatch: null });
  });

  it('falls back to a generic error for a valid but non-version server message', () => {
    const rejected = JSON.stringify({
      v: 1,
      type: 'intent.rejected',
      payload: { reason: 'NOT_YOUR_TURN' },
    });
    const result = parseJoinError({ message: rejected });
    expect(result).toEqual({ status: 'error', versionMismatch: null });
  });

  it('falls back to a generic error for an Error instance / unknown shape', () => {
    expect(parseJoinError(new Error('boom')).status).toBe('error');
    expect(parseJoinError(undefined).status).toBe('error');
    expect(parseJoinError(42).status).toBe('error');
  });
});
