// @skervik/server — `MatchPlayerRepository` (S2.6.1, ADR-0012 Fork 2). One row
// per seat; the composite PK `(match_id, seat)` (enforced by the schema, not
// this repository) rejects a duplicate seat for a match.
import { eq } from 'drizzle-orm';

import type { SkervikDb } from '../client.js';
import { type MatchPlayerResult, matchPlayers } from '../schema/index.js';

export interface CreateMatchPlayerInput {
  readonly matchId: string;
  readonly userId?: string;
  readonly seat: number;
  readonly finalVp?: number;
  readonly result?: MatchPlayerResult;
}

export interface MatchPlayerRow {
  readonly matchId: string;
  readonly userId: string | null;
  readonly seat: number;
  readonly finalVp: number | null;
  readonly result: MatchPlayerResult | null;
}

export class MatchPlayerRepository {
  readonly #db: SkervikDb;

  constructor(db: SkervikDb) {
    this.#db = db;
  }

  async create(input: CreateMatchPlayerInput): Promise<MatchPlayerRow> {
    const [row] = await this.#db
      .insert(matchPlayers)
      .values({
        matchId: input.matchId,
        userId: input.userId ?? null,
        seat: input.seat,
        finalVp: input.finalVp ?? null,
        result: input.result ?? null,
      })
      .returning();
    if (row === undefined)
      throw new Error('MatchPlayerRepository.create: insert returned no row');
    return row;
  }

  async findByMatch(matchId: string): Promise<readonly MatchPlayerRow[]> {
    return this.#db.select().from(matchPlayers).where(eq(matchPlayers.matchId, matchId));
  }

  /**
   * Every seat a user ever held, across all matches (S2.6.4 GDPR export). The
   * route joins each row's `match_id` back to `MatchRepository` to assemble the
   * portable export. A bot / tokenless seat has a `null` `user_id` and so never
   * matches — only the caller's own participations are returned.
   */
  async findByUser(userId: string): Promise<readonly MatchPlayerRow[]> {
    return this.#db.select().from(matchPlayers).where(eq(matchPlayers.userId, userId));
  }
}
