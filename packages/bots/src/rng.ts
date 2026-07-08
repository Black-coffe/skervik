// S2.4.2 — the bot's OWN pseudo-random stream, used ONLY for selection noise
// (medium's occasional 2nd-best, easy's top-K pick) and never for game outcomes.
//
// The seed here is the BOT's own (`BotOptions.seed`), NOT the match seed — the
// authoritative-server invariant: a `Bot.decide` never receives the match seed,
// so it structurally cannot predict future dice/deck draws (only the server's
// `validate`, fed the real secret seed, can). A bot seeded independently still
// plays deterministically (same bot seed + same match → identical choices), so
// tests stay reproducible. Built on core's stateless `deriveValue(seed, index)`
// (zero runtime dep, ADR-0003): this class adds the only mutable thing a bot
// needs — a monotonic draw counter — while the underlying math stays pure.
import { deriveValue, type Seed } from '@skervik/core';

/**
 * The fixed fallback bot seed used when {@link BotOptions.seed} is omitted, so a
 * no-seed bot is STILL deterministic (never `Math.random`). Distinct from any
 * real match seed string by construction.
 */
export const DEFAULT_BOT_SEED: Seed = 'skervik-bot-v1-default-seed';

/**
 * A tiny stateful PRNG over core's `deriveValue`: each `next()` folds
 * `(botSeed, counter++)` into a fresh `[0, 1)` float, advancing the counter so
 * successive draws differ. Stateful ONLY in its counter — the seed is fixed at
 * construction — so a bot built with the same seed replays the same draw
 * sequence given the same sequence of decisions.
 */
export class BotRng {
  readonly #seed: Seed;
  #counter = 0;

  constructor(seed: Seed = DEFAULT_BOT_SEED) {
    this.#seed = seed;
  }

  /** The next deterministic draw in `[0, 1)`. */
  next(): number {
    return deriveValue(this.#seed, this.#counter++);
  }

  /** A deterministic uniform pick from a non-empty list (throws on empty — a caller bug). */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('BotRng.pick: cannot pick from an empty list');
    }
    const index = Math.floor(this.next() * items.length);
    // `next()` is `< 1`, so `index < items.length`; clamp defends float edges.
    return items[Math.min(index, items.length - 1)] as T;
  }
}
