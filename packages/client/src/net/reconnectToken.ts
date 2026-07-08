// Per-room `reconnectionToken` persistence (S2.3.2, Key decision 3). Uses
// `sessionStorage` — never `localStorage` — keyed by `roomId`: per-tab,
// survives a page reload, auto-cleared on tab close, and scoped to ONE match
// so a stale token can never leak into a different game (a durable
// cross-session resume is S2.6.5 territory, not this). Guarded for a
// `sessionStorage`-less environment (a bare test runner with no DOM, or a
// browser with storage disabled) — every operation degrades to a no-op
// rather than throwing; the net layer keeps an in-memory copy alongside this
// for the same reason (the drop is async, so persistence must never be the
// only copy).

const STORAGE_PREFIX = 'skervik:reconnect:';
const CURRENT_ROOM_KEY = `${STORAGE_PREFIX}current-room`;

function storageKey(roomId: string): string {
  return `${STORAGE_PREFIX}${roomId}`;
}

function hasSessionStorage(): boolean {
  return typeof sessionStorage !== 'undefined';
}

/** Persist `token` for `roomId`. A no-op when `sessionStorage` is unavailable. */
export function persistReconnectionToken(roomId: string, token: string): void {
  if (!hasSessionStorage()) return;
  sessionStorage.setItem(storageKey(roomId), token);
}

/** Read the persisted token for `roomId`, or `null` if there is none / no storage. */
export function readReconnectionToken(roomId: string): string | null {
  if (!hasSessionStorage()) return null;
  return sessionStorage.getItem(storageKey(roomId));
}

/** Clear the persisted token for `roomId` (consented disconnect / reconnect failure). */
export function clearReconnectionToken(roomId: string): void {
  if (!hasSessionStorage()) return;
  sessionStorage.removeItem(storageKey(roomId));
}

// --- current-room pointer (S2.3.2a) ---
// The token above is keyed by `roomId`, but a COLD-loaded app (a page reload,
// not the in-tab drop S2.3.2 handles) has no `roomId` in memory to look it up
// with — the JS closure that held it is gone. This fixed-key pointer records
// WHICH roomId is current so `connect()` can resolve token→reconnect on a
// fresh load. One active match per tab (sessionStorage is per-tab), so a
// single pointer is unambiguous (Key decision 1) — it is never passed to
// `reconnect` itself (Key decision 3), only used to locate the token above.

/** Persist `roomId` as the current match for this tab. A no-op without `sessionStorage`. */
export function persistCurrentRoomId(roomId: string): void {
  if (!hasSessionStorage()) return;
  sessionStorage.setItem(CURRENT_ROOM_KEY, roomId);
}

/** Read the current-match roomId, or `null` if there is none / no storage. */
export function readCurrentRoomId(): string | null {
  if (!hasSessionStorage()) return null;
  return sessionStorage.getItem(CURRENT_ROOM_KEY);
}

/** Clear the current-room pointer (consented disconnect / reconnect failure). */
export function clearCurrentRoomId(): void {
  if (!hasSessionStorage()) return;
  sessionStorage.removeItem(CURRENT_ROOM_KEY);
}
