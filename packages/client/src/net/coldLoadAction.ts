// Cold-load routing (S2.5.3) — pure, DOM-optional helpers so the precedence
// rule is unit-testable without mounting `main.tsx` (which has no test file:
// it renders into a real DOM root as a side effect on import). Mirrors the
// "pure helper, no I/O, unit-testable" pattern already used by
// `net/connection.ts` and `net/reconnectToken.ts`.

/**
 * Extract the `room` query param from a `location.search`-shaped string (e.g.
 * `"?room=abcdEFghi"`), or `null` if absent/empty. This IS the invite link's
 * payload (owner decision, S2.5.3 story doc: the code is the raw `roomId`,
 * shared as `${origin}?room=${roomId}`).
 */
export function parseInviteRoomId(search: string): string | null {
  const roomId = new URLSearchParams(search).get('room');
  return roomId && roomId.length > 0 ? roomId : null;
}

/** What a cold-loaded app should do, in PRECEDENCE order. */
export type ColdLoadAction =
  | { readonly kind: 'resume' }
  | { readonly kind: 'joinByCode'; readonly roomId: string }
  | { readonly kind: 'lobby' };

/**
 * Resolve the cold-load action (S2.5.3 criterion 5). A live reconnect pointer
 * (S2.3.2a) ALWAYS wins over an invite-link `?room=` code — a page reload
 * mid-match must resume the held seat unmodified, never `joinById` a fresh
 * room just because the URL happens to carry one (e.g. the tab was reloaded
 * on an invite link after already joining). `resumable` is the caller's own
 * `hasResumablePointer()` check (kept in `main.tsx` — it reads
 * `sessionStorage` via `reconnectToken.ts`, which this module deliberately
 * does not import, to stay a pure decision function).
 */
export function resolveColdLoadAction(params: {
  readonly resumable: boolean;
  readonly search: string;
}): ColdLoadAction {
  if (params.resumable) return { kind: 'resume' };
  const roomId = parseInviteRoomId(params.search);
  if (roomId) return { kind: 'joinByCode', roomId };
  return { kind: 'lobby' };
}
