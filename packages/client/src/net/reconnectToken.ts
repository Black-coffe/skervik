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
