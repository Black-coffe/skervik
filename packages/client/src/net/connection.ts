// Pure connection-state helpers (S1.6.5) — no `colyseus.js`, no React, no I/O,
// so every mapping is unit-testable in isolation and the net layer's lib
// coupling stays confined to `wsClient.ts`. These translate raw transport
// signals (a leave close-code, a rejected `joinOrCreate`) into the small
// {@link ConnectionStatus} union the HUD renders.
import { ServerMessageSchema } from '@skervik/protocol';

/**
 * The connection lifecycle the HUD shows (DESIGN.md §6, localized + icon, never
 * color-only):
 *  • `connecting`      — a `joinOrCreate` is in flight.
 *  • `connected`       — joined; the authoritative stream is live.
 *  • `reconnecting`    — the socket dropped unexpectedly. M1 only SHOWS this
 *                        state; the actual grace/seat-reclaim is M2 (the server
 *                        `onLeave` is a no-op stub by design).
 *  • `disconnected`    — a clean, consented leave (we asked to disconnect).
 *  • `version-mismatch`— the join was refused for an incompatible protocol
 *                        version → drive the "update required" prompt.
 *  • `error`           — any other connect failure (network down, a non-version
 *                        server error, a malformed rejection) → generic
 *                        "can't connect".
 */
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'version-mismatch'
  | 'error';

/** The reported versions behind a `version-mismatch`, for the "update required" copy. */
export interface VersionMismatchInfo {
  readonly serverVersion: string;
  readonly clientVersion: string | null;
}

/**
 * Colyseus `CloseCode.CONSENTED` (colyseus.js `Protocol`, 0.16.x). A leave the
 * client asked for closes with this code; any other close is an unexpected
 * drop. Mirrored as a plain const so this module stays lib-free (and testable).
 */
export const CONSENTED_LEAVE_CODE = 4000;

/**
 * Map a room-leave close code to a status: a consented leave is a clean
 * `disconnected`; any other close is an unexpected drop surfaced as
 * `reconnecting` (M2 owns the actual reconnect — S1.6.5 only shows the state).
 */
export function statusForLeaveCode(code: number): ConnectionStatus {
  return code === CONSENTED_LEAVE_CODE ? 'disconnected' : 'reconnecting';
}

export interface JoinErrorResult {
  readonly status: 'version-mismatch' | 'error';
  readonly versionMismatch: VersionMismatchInfo | null;
}

/**
 * Interpret a rejected `joinOrCreate`. The server's `onAuth` throws a Colyseus
 * `ServerError` whose message is the JSON of an `error.version` protocol
 * message; that surfaces client-side as a rejection whose `.message` carries
 * that JSON. If it parses + validates as `error.version`, it's a protocol
 * mismatch (drive "update required" with the reported versions). Anything else
 * — a parse failure, a different server error, a network failure — is a generic
 * `error`. Never throws: a bad rejection degrades to the generic state.
 */
export function parseJoinError(error: unknown): JoinErrorResult {
  const message = extractErrorMessage(error);
  if (message !== null) {
    const versionMismatch = parseVersionError(message);
    if (versionMismatch) return { status: 'version-mismatch', versionMismatch };
  }
  return { status: 'error', versionMismatch: null };
}

/** Best-effort `.message` string from an unknown thrown value (Error, string, or {message}). */
function extractErrorMessage(error: unknown): string | null {
  if (typeof error === 'string') return error;
  if (error !== null && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
  return null;
}

/** Parse + validate a raw rejection message as an `error.version` payload, or `null`. */
function parseVersionError(raw: string): VersionMismatchInfo | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ServerMessageSchema.safeParse(json);
  if (!parsed.success || parsed.data.type !== 'error.version') return null;
  const { serverVersion, clientVersion } = parsed.data.payload;
  return { serverVersion, clientVersion };
}
