// @skervik/server — the guest-auth endpoint (S1.7.1 → S2.6.2a).
//
// `POST /auth/guest` mints a guest identity (see `auth/guestStore`). Body
// validated with zod at the trust boundary (same style as the protocol's
// inbound schemas); responses are machine-shaped JSON (`{ guestId, displayName,
// sessionToken? }` on success, `{ error }` on a malformed body), NEVER
// translated strings — the client maps the codes to localized UI with its own
// i18n (ADR-0008).
//
// S2.6.2a: when a `signToken` signer is injected, the response also carries a
// signed session JWT so a returning guest can re-resolve its durable `userId`
// across reconnect/reload (`GameRoom.onAuth` verifies it). The signer is
// optional — a route wired without one (legacy/tests) simply omits the token.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { GuestStore } from '../auth/guestStore.js';

/**
 * Signs a session token for an issued guest (S2.6.2a). Injected by `boot.ts`
 * (bound to the resolved `SESSION_SECRET`); kept as a narrow function so this
 * route never touches the secret directly.
 */
export type SessionTokenSigner = (claims: {
  readonly userId: string;
  readonly displayName: string;
}) => Promise<string>;

/**
 * The `POST /auth/guest` request body: an OPTIONAL display name. Anything else
 * is ignored; a wrong-typed `displayName` (non-string) is a `400`. The name is
 * sanitized/clamped downstream by the store, so we only gate the wire shape here.
 */
export const GuestAuthRequestSchema = z.object({
  displayName: z.string().optional(),
});

/**
 * Register `POST /auth/guest` → `200 { guestId, displayName, sessionToken? }`
 * (or `400 { error }`). `issueGuest` may be async (a DB insert, S2.6.2a), so the
 * handler is async and awaits it. When a `signToken` signer is given, a signed
 * session token for the issued `{ userId: guestId, displayName }` is included.
 */
export function registerGuestAuthRoute(
  fastify: FastifyInstance,
  store: GuestStore,
  signToken?: SessionTokenSigner,
): void {
  fastify.post('/auth/guest', async (request, reply) => {
    // A missing body is fine (guest with a generated name); only a present-but-
    // malformed body (e.g. `displayName` a number) is rejected.
    const parsed = GuestAuthRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: 'INVALID_BODY' };
    }
    const identity = await store.issueGuest(parsed.data.displayName);
    if (signToken === undefined) return identity;
    const sessionToken = await signToken({
      userId: identity.guestId,
      displayName: identity.displayName,
    });
    return { ...identity, sessionToken };
  });
}
