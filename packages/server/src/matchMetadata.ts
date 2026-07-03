// @skervik/server — the seed-REVEAL seam (S1.4.3, ADR-0009 Fork 3 / invariant
// #4). Mirrors the S1.4.2 `GameEventSink` seam: the room hands its secret seed
// here — and ONLY here, ONLY after a `game.ended` event — so the durable
// PostgreSQL `matches.seed` / `matches/{id}/seed-reveal.json` writer S1.7.3
// supplies can drop in with zero change to the room. The reveal deliberately
// does NOT go into the event log (Fork 3): `seed.reveal` is not a `GameEvent`,
// so it must never pollute the replayable one-line-per-event ndjson (invariant
// #3). This file builds NO persistence — only the interface plus in-memory /
// no-op defaults, so tests can assert the reveal without filesystem I/O.
import type { MatchId, Seed } from '@skervik/core';

/**
 * Receives a match's revealed seed once the game has ended. `recordSeedReveal`
 * MAY be async (S1.7.3's FS/DB writer): the room `await`s it in the pipeline.
 * The store is the durable home of the commit-reveal secret — after the match,
 * anyone can read it back to recompute every `dice.rolled` from the event log
 * and confirm it against the public `seedHash`.
 */
export interface MatchMetadataStore {
  recordSeedReveal(matchId: MatchId, seed: Seed): void | Promise<void>;
}

/** Discards the reveal — the "no durable metadata yet" default when persistence is off. */
export class NoopMatchMetadataStore implements MatchMetadataStore {
  recordSeedReveal(): void {
    // Intentionally empty — S1.7.3 owns real metadata persistence.
  }
}

/**
 * Buffers each revealed seed in memory, keyed by match — the default the room
 * uses so a test can assert the reveal fired with the exact seed, without any
 * filesystem I/O. NOT a persistence layer (nothing survives the process);
 * S1.7.3 replaces it with the PostgreSQL / JSON-sidecar writer.
 */
export class InMemoryMatchMetadataStore implements MatchMetadataStore {
  readonly reveals = new Map<MatchId, Seed>();

  recordSeedReveal(matchId: MatchId, seed: Seed): void {
    this.reveals.set(matchId, seed);
  }
}
