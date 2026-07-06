// Client guest-auth helper (S1.7.1) — a tiny `fetch` wrapper over the server's
// `POST /auth/guest`. Framework-free (no React, no zustand) and NEVER throws: a
// down/absent server (or a malformed response) yields `null`, so the bootstrap
// falls back to the no-server dev-fixture view rather than blocking the render
// (key decision — a live server is never a hard requirement to draw the board).
// Guest identity is anonymous DISPLAY metadata; the authoritative seat identity
// is still the server-assigned Colyseus `sessionId`.

/** The anonymous guest identity the server issues — display metadata only. */
export interface GuestIdentity {
  readonly guestId: string;
  readonly displayName: string;
}

/** Structural guard: a parsed JSON body is a usable {@link GuestIdentity}. */
function isGuestIdentity(value: unknown): value is GuestIdentity {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { guestId?: unknown }).guestId === 'string' &&
    typeof (value as { displayName?: unknown }).displayName === 'string'
  );
}

/**
 * `POST {apiBaseUrl}/auth/guest` and return the issued `{ guestId, displayName }`,
 * or `null` on ANY failure (network down, non-2xx, malformed body). Pass an
 * optional `displayName` to request a specific name (the server sanitizes/clamps
 * it, or generates one). Never throws — callers use the `null` to fall back.
 */
export async function fetchGuest(
  apiBaseUrl: string,
  displayName?: string,
): Promise<GuestIdentity | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(displayName !== undefined ? { displayName } : {}),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isGuestIdentity(data) ? data : null;
  } catch {
    return null;
  }
}
