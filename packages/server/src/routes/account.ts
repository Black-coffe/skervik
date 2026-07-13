// @skervik/server — GDPR self-service account endpoints (S2.6.4). A user
// (guests included — a guest is a `users` row) can EXPORT everything held about
// them (data portability) and ERASE their account (right to be forgotten). Both
// are authenticated to the CALLER'S OWN `userId` via their session token — never
// cross-user, no admin surface, no `userId` ever read from the request.
//
// ── Auth model (reuses S2.6.2a) ────────────────────────────────────────────
// The caller presents its session token as `Authorization: Bearer <token>`. The
// route verifies it with the SAME `verifySessionToken` the room's `onAuth` uses
// (no duplicated JWT logic), then resolves the `userId` to a LIVE `users` row
// (`findLiveById` — soft-delete filtered). A missing/invalid token, OR a token
// whose user has since been erased (`deleted_at IS NOT NULL`), resolves to
// `null` → 401. That soft-delete filter IS the post-erasure "dead token"
// mechanism (no bespoke revocation infra, per the story's locked decision).
//
// ── i18n (ADR-0008) ────────────────────────────────────────────────────────
// Responses are machine data + structured CODES only, never localized prose —
// the client maps a code to RU/UA/EN UI itself (the `/auth/guest` precedent). No
// new client strings are introduced beyond the codes below.
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type {
  MatchPlayerRepository,
  MatchRepository,
  UserRepository,
  UserRow,
} from '../db/repositories/index.js';

/**
 * Verifies a session token and returns its claims, or `null` for ANY invalid
 * token (bad signature / expired / malformed). The SAME verifier `boot.ts` binds
 * to the resolved `SESSION_SECRET` for the room's `onAuth` — injected here so
 * this route never touches the secret or re-implements JWT verification.
 */
export type VerifySessionToken = (
  token: string,
) => Promise<{ userId: string; displayName: string } | null>;

/** The repositories + verifier the account routes operate through. */
export interface AccountRoutesDeps {
  readonly userRepository: UserRepository;
  readonly matchRepository: MatchRepository;
  readonly matchPlayerRepository: MatchPlayerRepository;
  readonly verifySessionToken: VerifySessionToken;
}

/** One match participation in the export — the seat's outcome + the match's public metadata. */
interface ExportedMatch {
  readonly matchId: string;
  readonly seat: number;
  readonly finalVp: number | null;
  readonly result: string | null;
  readonly profileId: string;
  readonly status: string;
  readonly playerCount: number | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/**
 * Pull the bearer token out of the `Authorization` header, or `null` when it is
 * absent or not a `Bearer <token>` (a query/body token is deliberately NOT
 * accepted — a header keeps the credential out of logs/URLs).
 */
function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] ?? null;
}

/**
 * Resolve the request to the caller's OWN live `users` row, or `null` when
 * unauthenticated (no/invalid token, or an erased user). This is the ONLY
 * authorization: the routes act solely on the returned row's `id`, never on any
 * `userId` from the request body/query.
 */
async function authenticate(
  request: FastifyRequest,
  deps: AccountRoutesDeps,
): Promise<UserRow | null> {
  const token = bearerToken(request);
  if (token === null) return null;
  const claims = await deps.verifySessionToken(token);
  if (claims === null) return null;
  // Live-read filters soft-deleted users → a post-erasure token is anonymous.
  return deps.userRepository.findLiveById(claims.userId);
}

/**
 * Register `GET /account/export` + `POST /account/delete`, both gated on the
 * caller's own session token. Only registered by `boot.ts` when a DB is
 * configured (the repos need it); absent a DB the endpoints don't exist and the
 * server is otherwise unchanged (AC4).
 */
export function registerAccountRoutes(
  fastify: FastifyInstance,
  deps: AccountRoutesDeps,
): void {
  // GDPR data portability — the caller's `users` row + every match they played.
  fastify.get('/account/export', async (request, reply) => {
    const user = await authenticate(request, deps);
    if (user === null) {
      reply.code(401);
      return { error: 'UNAUTHENTICATED' };
    }

    const seats = await deps.matchPlayerRepository.findByUser(user.id);
    const matches: ExportedMatch[] = [];
    for (const seat of seats) {
      // `findById` (not the live filter) — a match's own row is not user PII.
      const match = await deps.matchRepository.findById(seat.matchId);
      if (match === null) continue; // best-effort: skip a dangling FK
      matches.push({
        matchId: seat.matchId,
        seat: seat.seat,
        finalVp: seat.finalVp,
        result: seat.result,
        profileId: match.profile.id,
        status: match.status,
        playerCount: match.playerCount,
        startedAt: match.startedAt?.toISOString() ?? null,
        finishedAt: match.finishedAt?.toISOString() ?? null,
      });
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        authProvider: user.authProvider,
        isGuest: user.isGuest,
        createdAt: user.createdAt.toISOString(),
      },
      matches,
    };
  });

  // GDPR erasure — soft-delete + anonymize the caller's OWN account. Match
  // history is retained (never cascade-deleted); the tombstoned row keeps the
  // `match_players` FKs valid while stripping the person's PII.
  fastify.post('/account/delete', async (request, reply) => {
    const user = await authenticate(request, deps);
    if (user === null) {
      reply.code(401);
      return { error: 'UNAUTHENTICATED' };
    }
    await deps.userRepository.softDeleteAndAnonymize(user.id);
    return { deleted: true };
  });
}
