import { describe, expect, it } from 'vitest';

import { parseInviteRoomId, resolveColdLoadAction } from './coldLoadAction.js';

describe('parseInviteRoomId', () => {
  it('reads the room param out of a search string', () => {
    expect(parseInviteRoomId('?room=abcdEFghi')).toBe('abcdEFghi');
  });

  it('reads it alongside other params, in any position', () => {
    expect(parseInviteRoomId('?utm=x&room=abc123&lang=ru')).toBe('abc123');
  });

  it('returns null when absent', () => {
    expect(parseInviteRoomId('')).toBeNull();
    expect(parseInviteRoomId('?utm=x')).toBeNull();
  });

  it('returns null for an empty room value', () => {
    expect(parseInviteRoomId('?room=')).toBeNull();
  });
});

describe('resolveColdLoadAction — precedence (S2.5.3 criterion 5)', () => {
  it('[forcing] a live reconnect pointer wins over an invite-link code — resolves "resume", NOT "joinByCode", even though a ?room= code is present. This test fails if resumable is checked after (or not at all before) the invite-link code.', () => {
    const action = resolveColdLoadAction({
      resumable: true,
      search: '?room=some-other-room',
    });
    expect(action).toEqual({ kind: 'resume' });
  });

  it('[forcing] no resumable pointer + an invite-link code resolves "joinByCode" with that exact roomId', () => {
    const action = resolveColdLoadAction({
      resumable: false,
      search: '?room=invited-room-1',
    });
    expect(action).toEqual({ kind: 'joinByCode', roomId: 'invited-room-1' });
  });

  it('neither resumable nor an invite code resolves "lobby" (unchanged M1/M2 default)', () => {
    const action = resolveColdLoadAction({ resumable: false, search: '' });
    expect(action).toEqual({ kind: 'lobby' });
  });
});
