// @skervik/server — the durable Postgres `MatchMetadataStore` (S2.6.3, ADR-0012
// Fork 3 / ADR-0009 Fork 3). Drops into the room's metadata seam exactly like
// `FsMatchMetadataStore`, but writes the `matches` + `match_players` tables
// instead of a JSON sidecar. Two lifecycle writes mirror the commit-reveal
// boundary: `recordMatchStart` inserts a `status:'live'` row at the genesis
// batch; `recordMatchResult` (+ the existing `recordSeedReveal`) completes it at
// `game.ended` with the revealed seed, the winner, and one `match_players` row
// per seat. These are PURE metadata side-effects — never a `GameEvent`, never in
// `events.ndjson`, never fed back into `reduce`/`validate` — so they cannot
// perturb the deterministic core; the room fires each best-effort (try/catch).
import type { MatchId, Seed } from '@skervik/core';

import type { MatchPlayerRepository } from './db/repositories/matchPlayerRepository.js';
import type { MatchRepository } from './db/repositories/matchRepository.js';
import type {
  MatchMetadataStore,
  MatchResultMetadata,
  MatchStartMetadata,
} from './matchMetadata.js';

export class PgMatchMetadataStore implements MatchMetadataStore {
  readonly #matches: MatchRepository;
  readonly #players: MatchPlayerRepository;

  constructor(matches: MatchRepository, players: MatchPlayerRepository) {
    this.#matches = matches;
    this.#players = players;
  }

  /**
   * The commit-reveal seed's durable home (ADR-0009 Fork 3): also written into
   * `matches.seed` here, resolved from the room's `roomId` (= `matchId`). If the
   * start row is missing (shouldn't happen — start is recorded first), this is a
   * logged no-op rather than a throw, so a stray reveal never crashes the room.
   */
  async recordSeedReveal(matchId: MatchId, seed: Seed): Promise<void> {
    const row = await this.#matches.findByRoomId(matchId);
    if (row === null) return;
    await this.#matches.update(row.id, { seed });
  }

  /** Reads the revealed seed back for the verify endpoint (S1.7.3); null if unrevealed. */
  async readSeedReveal(matchId: MatchId): Promise<Seed | null> {
    const row = await this.#matches.findByRoomId(matchId);
    return (row?.seed ?? null) as Seed | null;
  }

  /** Inserts the `status:'live'` row at match-start. */
  async recordMatchStart(matchId: MatchId, meta: MatchStartMetadata): Promise<void> {
    await this.#matches.create({
      roomId: meta.roomId,
      profile: meta.profile,
      seedHash: meta.seedHash,
      playerCount: meta.playerCount,
      status: 'live',
      startedAt: meta.startedAt,
      ...(meta.eventLogUri !== undefined ? { eventLogUri: meta.eventLogUri } : {}),
    });
  }

  /**
   * Completes the row at `game.ended`: reveal `seed`, set the winner + status,
   * and insert one `match_players` row per seat. A missing start row is a logged
   * no-op (never a throw outward). `winnerUserId`/`userId` are only set when the
   * seat maps to a token-authenticated user — a bot/tokenless seat stays null.
   */
  async recordMatchResult(matchId: MatchId, meta: MatchResultMetadata): Promise<void> {
    const row = await this.#matches.findByRoomId(matchId);
    if (row === null) return;
    await this.#matches.update(row.id, {
      seed: meta.seed,
      status: 'finished',
      finishedAt: meta.finishedAt,
      ...(meta.winnerUserId !== undefined ? { winnerId: meta.winnerUserId } : {}),
    });
    for (const player of meta.playerResults) {
      await this.#players.create({
        matchId: row.id,
        seat: player.seat,
        finalVp: player.finalVp,
        result: player.result,
        ...(player.userId !== undefined ? { userId: player.userId } : {}),
      });
    }
  }
}
