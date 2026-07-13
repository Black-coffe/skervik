// @skervik/server — `match_players` table (S2.6.1, ADR-0012 Fork 2). One row
// per seat per match; composite PK `(match_id, seat)` — a match can't seat
// the same seat twice. `user_id` is nullable at the type level (a bot-filled
// seat has none) but guests get a `users` row too (`isGuest: true`), so a
// human seat always resolves to a real user.
import { integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

import { matches } from './matches.js';
import { users } from './users.js';

/** App-validated `text` (invariant #8) — never a Postgres `enum`. */
export type MatchPlayerResult = 'win' | 'loss' | 'abandoned';

export const matchPlayers = pgTable(
  'match_players',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    userId: uuid('user_id').references(() => users.id),
    seat: integer('seat').notNull(),
    finalVp: integer('final_vp'),
    result: text('result').$type<MatchPlayerResult>(),
  },
  (table) => [primaryKey({ columns: [table.matchId, table.seat] })],
);
