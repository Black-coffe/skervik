// S1.4.4b — `FsEventSink` unit round-trip: the durable writer, isolated from
// the room, appends bare-`GameEvent` ndjson (one `JSON.stringify` per line),
// creates the match dir/file on first write, and preserves append order across
// calls — so core's `parseGameEventLog` reads back exactly what was written.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type GameEvent, type MatchId, parseGameEventLog } from '@skervik/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MATCHES_DIR, FsEventSink } from './eventSink.js';

const MATCH = 'match-abc' as MatchId;

/** Two representative bare events — the exact objects `reduce` consumes. */
const EVENTS: readonly GameEvent[] = [
  { type: 'turn.ended', index: 0, playerId: 'p1', nextPlayerId: 'p2' },
  { type: 'dice.rolled', index: 1, playerId: 'p2', dieA: 5, dieB: 3, total: 8 },
];

describe('FsEventSink', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skervik-sink-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates the match dir/file on first write and round-trips via parseGameEventLog', async () => {
    const sink = new FsEventSink({ matchId: MATCH, matchesDir: tempDir });

    // First append across two batches, appended in order.
    await sink.append([EVENTS[0] as GameEvent]);
    await sink.append([EVENTS[1] as GameEvent]);

    const ndjson = await readFile(join(tempDir, MATCH, 'events.ndjson'), 'utf8');
    // One JSON.stringify(event) per line, trailing newline.
    expect(ndjson).toBe(`${JSON.stringify(EVENTS[0])}\n${JSON.stringify(EVENTS[1])}\n`);
    expect(parseGameEventLog(ndjson)).toEqual(EVENTS);
  });

  it('writes a multi-event batch as one line per event, order preserved', async () => {
    const sink = new FsEventSink({ matchId: MATCH, matchesDir: tempDir });

    await sink.append(EVENTS);

    const ndjson = await readFile(join(tempDir, MATCH, 'events.ndjson'), 'utf8');
    expect(ndjson.trimEnd().split('\n')).toHaveLength(EVENTS.length);
    expect(parseGameEventLog(ndjson)).toEqual(EVENTS);
  });

  it('an empty batch is a no-op — no file is created', async () => {
    const sink = new FsEventSink({ matchId: MATCH, matchesDir: tempDir });

    await sink.append([]);

    await expect(
      readFile(join(tempDir, MATCH, 'events.ndjson'), 'utf8'),
    ).rejects.toThrow();
  });

  it('defaults the base dir to DEFAULT_MATCHES_DIR when none is given', () => {
    const sink = new FsEventSink({ matchId: MATCH });
    expect(sink.filePath).toBe(join(DEFAULT_MATCHES_DIR, MATCH, 'events.ndjson'));
  });

  // --- lead-review hardening: matchId is a fairness/anti-cheat boundary -----
  // `matchId` becomes a filesystem path segment; it's the Colyseus `roomId`
  // today (never client-controlled), but the constructor asserts this rather
  // than trusting that invariant silently.
  it.each([
    ['a path separator (/)', 'abc/def'],
    ['a Windows path separator (\\)', 'abc\\def'],
    ['a parent-directory traversal (..)', '../escape'],
    ['exactly ..', '..'],
    ['the empty string', ''],
  ])('rejects an unsafe matchId containing %s', (_label, unsafeMatchId) => {
    expect(
      () => new FsEventSink({ matchId: unsafeMatchId as MatchId, matchesDir: tempDir }),
    ).toThrow();
  });

  it('accepts a normal Colyseus-style roomId (alphanumeric)', () => {
    expect(
      () => new FsEventSink({ matchId: 'aB3xYz9' as MatchId, matchesDir: tempDir }),
    ).not.toThrow();
  });
});
