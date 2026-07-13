// @skervik/server — `MatchRepository` (S2.6.1, ADR-0012 Fork 3). Two write
// paths mirror the commit-reveal boundary: `create` at `match.started`
// (`profile`/`seedHash`/`playerCount`/`status:'live'`/`startedAt`/
// `eventLogUri`), `update` at `game.ended` (`seed` reveal/`winnerId`/
// `status:'finished'`/`finishedAt`). S2.6.3 wires a `PgMatchMetadataStore`
// that calls these; this story only builds + unit-tests them.
import { randomUUID } from 'node:crypto';

import type { RuleProfile } from '@skervik/core';
import { eq } from 'drizzle-orm';

import type { SkervikDb } from '../client.js';
import { matches, type MatchStatus } from '../schema/index.js';

export interface CreateMatchInput {
  readonly profile: RuleProfile;
  readonly seedHash: string;
  readonly playerCount?: number;
  /** Defaults to `'live'` — the state a match starts in. */
  readonly status?: MatchStatus;
  readonly startedAt?: Date;
  readonly eventLogUri?: string;
}

export interface UpdateMatchInput {
  /** The reveal — set at `game.ended`, never before (ADR-0009 Fork 3). */
  readonly seed?: string;
  readonly winnerId?: string;
  readonly status?: MatchStatus;
  readonly finishedAt?: Date;
}

export interface MatchRow {
  readonly id: string;
  readonly profile: RuleProfile;
  readonly seedHash: string;
  readonly seed: string | null;
  readonly playerCount: number | null;
  readonly status: MatchStatus;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly eventLogUri: string | null;
  readonly winnerId: string | null;
}

export class MatchRepository {
  readonly #db: SkervikDb;

  constructor(db: SkervikDb) {
    this.#db = db;
  }

  async create(input: CreateMatchInput): Promise<MatchRow> {
    const [row] = await this.#db
      .insert(matches)
      .values({
        id: randomUUID(),
        profile: input.profile,
        seedHash: input.seedHash,
        playerCount: input.playerCount ?? null,
        status: input.status ?? 'live',
        startedAt: input.startedAt ?? null,
        eventLogUri: input.eventLogUri ?? null,
      })
      .returning();
    if (row === undefined)
      throw new Error('MatchRepository.create: insert returned no row');
    return row;
  }

  async findById(id: string): Promise<MatchRow | null> {
    const [row] = await this.#db.select().from(matches).where(eq(matches.id, id));
    return row ?? null;
  }

  /** The `game.ended` write — reveals `seed`, records the winner, closes the match. */
  async update(id: string, patch: UpdateMatchInput): Promise<MatchRow | null> {
    const [row] = await this.#db
      .update(matches)
      .set({
        ...(patch.seed !== undefined ? { seed: patch.seed } : {}),
        ...(patch.winnerId !== undefined ? { winnerId: patch.winnerId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      })
      .where(eq(matches.id, id))
      .returning();
    return row ?? null;
  }
}
