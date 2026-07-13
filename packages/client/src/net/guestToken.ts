// Durable guest SESSION-token persistence (S2.6.2a). Mirrors
// `reconnectToken.ts`'s guarded-storage pattern (every op degrades to a no-op
// when storage is unavailable — a bare test runner or storage-disabled browser
// — rather than throwing), but uses `localStorage`, NOT `sessionStorage`.
//
// Why localStorage: unlike the per-match reconnect token (per-tab, auto-cleared
// on tab close so a stale token can't leak into a different game), the guest
// session token is a DURABLE identity — a 30-day JWT that re-resolves the SAME
// `userId` across reloads AND browser sessions (that is the whole point of its
// expiry). sessionStorage would discard it on tab close and defeat that. It is
// still only DISPLAY/attribution metadata — the authoritative seat identity is
// the server `sessionId` (ADR-0009) — so a leaked token cannot impersonate
// another player's moves; it can at most re-attach a display identity.

const STORAGE_KEY = 'skervik:guest-session-token';

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

/** Persist the guest session `token`. A no-op when `localStorage` is unavailable. */
export function persistGuestToken(token: string): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Quota/permission errors degrade to a no-op (matches reconnectToken.ts).
  }
}

/** Read the stored guest session token, or `null` if there is none / no storage. */
export function readGuestToken(): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Clear the stored guest session token (e.g. the server rejected it). */
export function clearGuestToken(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No-op on failure.
  }
}
