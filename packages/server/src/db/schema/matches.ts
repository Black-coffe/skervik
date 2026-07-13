// @skervik/server — `matches` table (S2.6.1, ADR-0012 Fork 2/3). The durable
// home of match metadata: written at `match.started` (`seedHash`/`profile`/
// `playerCount`/`status:'live'`/`startedAt`/`eventLogUri`) and completed at
// `game.ended` (`seed` reveal/`winnerId`/`status:'finished'`/`finishedAt`) —
// the exact commit-reveal boundary ADR-0009 Fork 3 already enforces. The
// event log itself stays ndjson (invariant #6); `eventLogUri` is only a
// pointer to where it lives.
import type { RuleProfile } from '@skervik/core';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

/** App-validated `text` (invariant #8) — never a Postgres `enum`. */
export type MatchStatus = 'live' | 'finished' | 'abandoned';

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey(),
  /**
   * The Colyseus `roomId` (S2.6.3) — the room's own `matchId`, distinct from the
   * durable uuid PK above. Short and recyclable across restarts, so NOT the PK;
   * `unique` so `findByRoomId` resolves a live match's row, and the same key the
   * FS event log / seed-reveal sidecar are addressed by.
   */
  roomId: text('room_id').notNull().unique(),
  /** The FULLY-RESOLVED RuleProfile (incl. adaptive overrides), not just a `profileId`. */
  profile: jsonb('profile').notNull().$type<RuleProfile>(),
  seedHash: text('seed_hash').notNull(),
  /** The reveal — `null` until `game.ended` (ADR-0009 Fork 3). */
  seed: text('seed'),
  playerCount: integer('player_count'),
  status: text('status').notNull().$type<MatchStatus>(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /** Pointer to the ndjson log (FS path now, S3 URI later) — NOT the log itself. */
  eventLogUri: text('event_log_uri'),
  winnerId: uuid('winner_id').references(() => users.id),
});
