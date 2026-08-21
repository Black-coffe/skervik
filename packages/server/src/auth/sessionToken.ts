// @skervik/server — signed guest SESSION tokens (S2.6.2a, first external-auth
// surface). A guest that authenticates via `POST /auth/guest` is handed a
// signed JWT that lets the SAME durable `userId` re-resolve across reconnect
// and page reload — WITHOUT ever becoming the in-game identity (the seat's
// authoritative `PlayerId` stays the unspoofable Colyseus `sessionId`,
// ADR-0009; the `userId` here is non-authoritative display/attribution
// metadata for S2.6.3).
//
// ── Why HS256 (symmetric) ──────────────────────────────────────────────────
// One server signs and verifies with one secret — sufficient for guest
// sessions (no third party needs to verify a token independently). S2.6.2b
// revisits asymmetric signing when real OAuth providers enter the picture.
// The token carries ONLY `sub` (userId), `name` (displayName), `iat`, `exp` —
// never a secret, never anything a client shouldn't already see about itself.
import { randomBytes } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

/** Token lifetime — long enough to survive a reload/reconnect, short of forever. */
export const SESSION_TOKEN_TTL = '30d';

/** The claims a session token asserts about a guest — display metadata only. */
export interface SessionClaims {
  readonly userId: string;
  readonly displayName: string;
}

/**
 * Sign a session token for `claims` with `secret` (HS256). `secret` is a raw
 * key (`Uint8Array`) so it is injectable in tests and never a stringly-typed
 * default. `opts.expiresIn` overrides the default 30-day expiry (tests use a
 * tiny value to prove expiry rejection).
 */
export async function signSessionToken(
  claims: SessionClaims,
  secret: Uint8Array,
  opts?: { readonly expiresIn?: string | number },
): Promise<string> {
  return new SignJWT({ name: claims.displayName })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(opts?.expiresIn ?? SESSION_TOKEN_TTL)
    .sign(secret);
}

/**
 * Verify `token` against `secret` and return its {@link SessionClaims}, or
 * `null` on ANY failure (bad signature / wrong secret / expired / malformed /
 * missing claims). Returns `null` rather than throwing so the CALLER decides
 * reject-vs-ignore: the Fastify route ignores, `GameRoom.onAuth` rejects a
 * present-but-invalid token (never silently downgrades — that would mask
 * tampering).
 */
export async function verifySessionToken(
  token: string,
  secret: Uint8Array,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    const userId = payload.sub;
    const displayName = payload['name'];
    if (typeof userId !== 'string' || typeof displayName !== 'string') return null;
    return { userId, displayName };
  } catch {
    return null;
  }
}

/**
 * Resolve the signing secret from the environment. `SESSION_SECRET` (if set) is
 * the durable production secret — tokens survive a restart. If ABSENT, an
 * EPHEMERAL per-boot secret is minted (`randomBytes(32)`) and a warning is
 * logged: tokens work within this process but do NOT survive a restart, and
 * production MUST set `SESSION_SECRET` (documented alongside `DATABASE_URL`).
 * NEVER a hardcoded default — an ephemeral random key is strictly safer than a
 * shipped constant a hostile party would already know.
 */
export function resolveSessionSecret(env: NodeJS.ProcessEnv): Uint8Array {
  const configured = env['SESSION_SECRET'];
  if (configured !== undefined && configured.length > 0) {
    return new TextEncoder().encode(configured);
  }
  console.warn(
    '[skervik/server] SESSION_SECRET is not set — using an ephemeral per-boot ' +
      'secret; session tokens will NOT survive a restart. Set SESSION_SECRET in production.',
  );
  return new Uint8Array(randomBytes(32));
}
