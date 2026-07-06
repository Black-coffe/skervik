// @skervik/server — the anonymous guest-auth endpoint (S1.7.1).
//
// `POST /auth/guest` mints a display-only guest identity (see `auth/guestStore`
// — NOT a security boundary in M1). Body validated with zod at the trust
// boundary (same style as the protocol's inbound schemas); responses are
// machine-shaped JSON (`{ guestId, displayName }` on success, `{ error }` on a
// malformed body), NEVER translated strings — the client maps the codes to
// localized UI with its own i18n (ADR-0008).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { GuestStore } from '../auth/guestStore.js';

/**
 * The `POST /auth/guest` request body: an OPTIONAL display name. Anything else
 * is ignored; a wrong-typed `displayName` (non-string) is a `400`. The name is
 * sanitized/clamped downstream by the store, so we only gate the wire shape here.
 */
export const GuestAuthRequestSchema = z.object({
  displayName: z.string().optional(),
});

/** Register `POST /auth/guest` → `200 { guestId, displayName }` (or `400 { error }`). */
export function registerGuestAuthRoute(
  fastify: FastifyInstance,
  store: GuestStore,
): void {
  fastify.post('/auth/guest', (request, reply) => {
    // A missing body is fine (guest with a generated name); only a present-but-
    // malformed body (e.g. `displayName` a number) is rejected.
    const parsed = GuestAuthRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: 'INVALID_BODY' };
    }
    return store.issueGuest(parsed.data.displayName);
  });
}
