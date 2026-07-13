# ADR-0012: Persistence layer — Drizzle ORM + Postgres, PGlite for hermetic tests, inside `packages/server`

- Status: **accepted** (owner sign-off 2026-07-13; PGlite↔Postgres migration equivalence confirmed against live Drizzle docs — `drizzle-orm/pglite` driver + uniform `migrate()` migrator over one `dialect:'postgresql'` SQL set). Stack (Drizzle + PGlite + docker Postgres) is an **owner-locked input** (recorded here, not relitigated); the six forks below are the Queen/architect decisions this ADR settles.
- Date: 2026-07-13
- Spec: docs/specs/m2-mode-platform (E2.6 — persistence & accounts, stories S2.6.1–S2.6.5)
- Builds on: ADR-0003 (core is zero-runtime-dep), ADR-0009 Fork 2/3 (event log = bare-`GameEvent` ndjson; seed reveal lives in match metadata, NOT the event log), ADR-0004 (Fastify/Node 22 stack)

## Context

E2.6 is the **first database surface in the monorepo**. Everything durable to date is
file-backed and process-local: `FsEventSink` appends the canonical match log to
`matches/{id}/events.ndjson` (`packages/server/src/room/eventSink.ts:71`), and
`FsMatchMetadataStore` writes the commit-reveal secret to a `seed-reveal.json` sidecar
(`packages/server/src/matchMetadata.ts:101`). There is no `users` table, so guest identity
(`InMemoryGuestStore`) evaporates on restart, and match results are unqueryable. E2.6 gives
Skervik durable accounts and match history.

The tech spec §6.1 (`docs/catan-online-tech-spec-phase2.md:250-307`) prescribes five tables
(`users`, `player_ratings`, `matches`, `match_players`, `donations`). The **stack is
owner-locked**: **Drizzle ORM + drizzle-kit** (schema-in-TS + SQL-first generated migrations);
**PGlite** (`@electric-sql/pglite` + `drizzle-orm/pglite`, in-process WASM Postgres) for
**hermetic tests**; **real Postgres via docker-compose** for local dev + production. That stack
is recorded, not reopened. What this ADR must settle are the six forks that surround it, so
S2.6.1 can be materialized without relitigating boundaries.

**The load-bearing bet — PGlite↔Postgres migration equivalence — is real, with one bounded
caveat.** drizzle-kit generates a **single set** of `dialect: 'postgresql'` SQL migration files
(`.sql` + a `_journal.json`); the SAME files are executed against PGlite (via
`drizzle-orm/pglite/migrator`) and against real Postgres (via `drizzle-orm/node-postgres/migrator`)
by the same migrator that reads the same journal. PGlite is not a re-implementation — it is the
actual Postgres engine compiled to WASM — so the DDL/DML semantics match. **Caveat:** PGlite is
single-connection/in-process and omits some server-level features (extensions, replication, some
config). The M2 schema uses only `uuid`/`text`/`jsonb`/`timestamptz`/`boolean`/`int` columns with
PK/FK/unique constraints — none of the omitted surface — so equivalence holds for E2.6. This
caveat is what Fork 5's "defer the real-Postgres CI job" rests on, and Invariant 5 (app-side UUID
generation) exists to keep even UUID minting driver-identical.

## Options

Each fork below is stated as a decision with its rejected alternative; the two headline forks:

1. **Where the DB layer lives** — inside `packages/server` (no new package) vs a new `@skervik/db` workspace package.
2. **How much schema ships now** — all five §6.1 tables vs only the three M2 features touch.

## Decision

### Fork 1 — Module boundary: **inside `packages/server/src/db/`, no `@skervik/db` package**

The DB layer lives at `packages/server/src/db/`:

- `db/schema/` — Drizzle table definitions (`users.ts`, `matches.ts`, `matchPlayers.ts`, an index barrel).
- `db/migrations/` — drizzle-kit-**generated** SQL (see Fork 4; committed, additive-only).
- `db/client.ts` — the connection factory (returns a typed `drizzle(...)` instance; picks the
  `node-postgres` driver for a `DATABASE_URL`, the `pglite` driver for tests).
- `db/repositories/` — typed repositories (`UserRepository`, `MatchRepository`, `MatchPlayerRepository`)
  — the ONLY surface the rest of the server calls; no raw Drizzle queries leak into rooms/routes.

**Only `packages/server` touches the DB** — rooms, matchmaking, guest auth, and the verify endpoint
are all server-side; there is no second consumer. Minting a `@skervik/db` package would add
workspace boilerplate (its own `package.json`, `tsup`, `tsconfig`, publish wiring) for a module with
exactly one importer — a Law-2 violation. The **cheaper-undo** test confirms it: extracting a
self-contained `db/` leaf into `@skervik/db` later is a mechanical move if a second consumer ever
appears; starting as a package and folding it back is equally cheap but pays the boilerplate cost
up front for nothing. **`@skervik/core` stays zero-runtime-dep (ADR-0003, guarded by
`scripts/check-core-no-runtime-deps.mjs`); `@skervik/protocol` stays type-only.** The new runtime
deps — `drizzle-orm`, `pg` — and dev deps — `drizzle-kit`, `@electric-sql/pglite` — land **only in
`packages/server`**.

Rejected — **`@skervik/db` package**: no second consumer justifies it; adds a package the build
graph doesn't need. Revisit only when a non-server package (a migration CLI, an offline analytics
worker) needs the schema.

### Fork 2 — M2-scoped schema: **ship only `users`, `matches`, `match_players`**

Ship the three tables M2 features actually use. **DEFER `player_ratings` (M3 ranked/Glicko-2) and
`donations` (later, when a donations page ships)** — a table with no feature behind it is dead
schema (Law 2) and a standing invitation for someone to write against it early. Concrete columns,
mirroring §6.1:

```
users
  id            uuid  primary key            -- app-generated (Invariant 5), NOT a DB default
  username      text  unique not null
  email         text  unique                 -- null for guests
  auth_provider text                         -- 'google' | 'discord' | 'guest' (app-validated text, Invariant 8)
  is_guest      boolean not null default false
  created_at    timestamptz not null default now()
  deleted_at    timestamptz                  -- soft-delete for GDPR self-service erasure

matches
  id            uuid  primary key            -- app-generated
  profile       jsonb not null               -- the FULLY-RESOLVED RuleProfile (incl. adaptive overrides)
  seed_hash     text  not null               -- commit, written at match start
  seed          text                         -- reveal, null until game.ended (ADR-0009 Fork 3)
  player_count  int
  status        text  not null               -- 'live' | 'finished' | 'abandoned' (app-validated text)
  started_at    timestamptz
  finished_at   timestamptz
  event_log_uri text                         -- pointer to the ndjson log (FS path now, S3 URI later)
  winner_id     uuid  references users(id)

match_players
  match_id      uuid  not null references matches(id)
  user_id       uuid  references users(id)   -- guests get a users row (is_guest=true), so this resolves
  seat          int   not null
  final_vp      int
  result        text                         -- 'win' | 'loss' | 'abandoned' (app-validated text)
  primary key (match_id, seat)
```

Two design notes that are decisions, not incidentals:

- **`matches.profile` stores the fully-resolved RuleProfile, not just a `profileId`.** This is the
  durable home the **adaptive profile-override seam** (`memory/` → adaptive-profile-override-delivery-seam)
  has been waiting for: an adjusted, non-preset profile that the live `GameState` only carries as a
  `profileId` is recorded in full here at match start, so the match is reconstructable and auditable
  even for a one-off adjusted config.
- **`status`/`result`/`auth_provider` are `text` validated in application code, NOT Postgres `enum`
  types.** Altering a Postgres enum (adding/renaming a value) is a migration hazard that fights the
  append-only migration no-go-zone (Fork 4). `text` + an app-level union type is the boring, reversible
  choice.

Rejected — **materialize all five §6.1 tables now**: `player_ratings` and `donations` have no M2
feature, so they would ship as dead schema whose shape gets frozen (and mis-guessed) before the
ranked/donations work that should design them exists.

### Fork 3 — How the persisted seams map to tables (and what STAYS on disk)

The existing seams compose onto the schema without moving the heavy log into Postgres:

- **`MatchMetadataStore` → `matches` (+ `match_players`).** A Postgres-backed store (a
  **S2.6.3** concern, NOT S2.6.1) writes `matches.seed_hash` + `profile` + `player_count` +
  `status='live'` + `started_at` + `event_log_uri` **at match start**, and `matches.seed` +
  `winner_id` + `status='finished'` + `finished_at` (and per-seat `match_players.final_vp`/`result`)
  **at `game.ended`** — exactly the reveal boundary ADR-0009 Fork 3 already enforces. The current
  interface (`packages/server/src/matchMetadata.ts:25` — `recordSeedReveal`/`readSeedReveal`) is
  extended by S2.6.3 to also record match-start metadata; a `PgMatchMetadataStore` implements it
  over `MatchRepository`.
- **`GameEventSink` STAYS filesystem/S3.** The canonical event log is NOT a database table. Postgres
  stores only `matches.event_log_uri` — a pointer to where the ndjson lives (§6.1's "тяжёлый лог — в
  S3"). This preserves ADR-0009 Fork 2 (one `GameEvent` per ndjson line, the same bytes the
  determinism gate replays) and keeps the append-hot path off the relational store.

**S2.6.1 builds the schema + migrations + repositories and NOTHING ELSE — it does not rewire the
room.** The room keeps booting on today's `FsEventSink`/`FsMatchMetadataStore`/`InMemoryGuestStore`.
The rewire (guest persistence, Pg-backed metadata store) is S2.6.2/S2.6.3. This staging is what makes
S2.6.1 a no-regression change.

### Fork 4 — Migration execution model: **generated SQL + explicit `migrate` script, never auto-migrate-on-boot**

- Migrations are **generated** by `drizzle-kit generate` from the TS schema into
  `packages/server/src/db/migrations/`, committed to git, with a `drizzle.config.ts` at the package
  root pointing `dialect: 'postgresql'`, `schema: './src/db/schema'`, `out: './src/db/migrations'`.
- A single **`runMigrations(db)`** function (thin wrapper over drizzle's migrator, `migrationsFolder`
  resolved relative to the package root so it works from `dist/` too) is the ONLY way migrations run.
  It is invoked by an explicit **`pnpm --filter @skervik/server migrate`** script for dev/prod, and
  called directly by each test suite against its fresh PGlite instance (Fork 5).
- **No auto-migrate-on-every-boot.** The server does not silently mutate the schema on startup;
  applying migrations is a deliberate operator action.
- **Migration history is a permanent NO-GO-ZONE — additive-only.** A shipped `.sql` file is never
  hand-edited. A rename/drop is a NEW generated migration with a deliberate down-path, never an edit
  to an existing one (edits break every environment that already applied the old file).

### Fork 5 — Test strategy: **fresh PGlite per suite, real migrations, hermetic `pnpm -r test`**

Each repository/integration suite spins a fresh in-memory `PGlite`, runs `runMigrations` (the SAME
generated files prod uses), exercises the repos, asserts, and discards the instance. **This keeps
`pnpm -r test` fully hermetic — no docker, no external DB service in CI** — which is the entire reason
PGlite is acceptable in place of a test-Postgres container.

A **real-Postgres CI smoke job is DEFERRED**, not built now. PGlite runs the identical migrations, and
the M2 schema uses no Postgres feature PGlite lacks (Context caveat). Adding a docker-Postgres smoke
job is the correct trigger-gated response IF a future migration reaches for a Postgres-only feature —
recorded as a Fork-5 revisit trigger, not pre-built.

### Fork 6 — Config/env: **`DATABASE_URL` optional until wired, gated exactly like `MATCHES_DIR`**

`DATABASE_URL` is read at `startServer()` (`packages/server/src/boot.ts:184`) alongside
`PORT`/`HOST`/`MATCHES_DIR`, and passed through with the same optional pattern
(`boot.ts:187`, `matchesDir !== undefined ? … : {}`):

- **Absent `DATABASE_URL` → the server boots on today's FS/in-memory stores (no regression).** DB-backed
  behavior is gated on its presence. This is what lets S2.6.1 land the schema without touching the boot
  path's default behavior.
- **Present `DATABASE_URL` → the DB-backed stores activate** (once S2.6.2/S2.6.3 wire them).
- For a **fully-featured production boot, both `DATABASE_URL` and `MATCHES_DIR` are mandatory** —
  `DATABASE_URL` for accounts/match metadata, `MATCHES_DIR` (or the future S3 URI) for the event-log
  bytes that `event_log_uri` points at. Document this in the server README / deploy notes.

## Consequences

- **Easier:** durable accounts + queryable match history land behind a typed repository surface with
  zero new package; the adaptive-profile override finally has a durable home (`matches.profile`);
  fairness audit is unchanged (seed reveal still flows through `MatchMetadataStore`, event log still
  ndjson); CI stays docker-free and hermetic (PGlite runs prod migrations); the boot path keeps its
  no-DB default so S2.6.1 is a pure add.
- **Harder / debt accepted:** `packages/server` gains its first heavyweight deps (`drizzle-orm`, `pg`)
  and a WASM test dep (`@electric-sql/pglite`) — build/test surface grows (bounded to one package,
  core stays pure). Migration history becomes a permanent additive-only no-go-zone. The
  PGlite↔Postgres equivalence is trusted, not yet CI-proven against a real server (mitigated: identical
  migration files, no PGlite-omitted feature used, app-side UUIDs).
- **Per-story guidance:**
  - **S2.6.1** — schema (`users`/`matches`/`match_players`) + drizzle.config + generated migrations +
    `runMigrations` + `migrate` script + the three repositories + PGlite-backed repo tests. **Does NOT
    rewire the room.** Adds deps to `packages/server` only.
  - **S2.6.2** — persist guest/OAuth identity into `users` (replaces `InMemoryGuestStore`), gated on
    `DATABASE_URL`.
  - **S2.6.3** — `PgMatchMetadataStore` writing `matches`/`match_players` at match-start + `game.ended`;
    extends the `MatchMetadataStore` interface; keeps `event_log_uri` pointing at the ndjson.
  - **S2.6.4 / S2.6.5** — (per the Queen's E2.6 breakdown) match-history/read surfaces over the repos;
    they consume this schema, they do not extend the deferred tables.

## Invariants created

Copy verbatim into `docs/wiki/` (new `persistence.md`):

1. **The DB dependency lives ONLY in `packages/server`.** `@skervik/core` stays zero-runtime-dep
   (ADR-0003); `@skervik/protocol` stays type-only. No `@skervik/db` package exists until a second,
   non-server consumer needs the schema.
2. **One migration source of truth.** drizzle-kit generates `dialect: 'postgresql'` SQL under
   `packages/server/src/db/migrations/`; the SAME files run against PGlite (tests) and real Postgres
   (prod) via drizzle's migrator. Test DDL and prod DDL never diverge; generated migrations are never
   hand-edited.
3. **Migration history is append-only (permanent no-go-zone).** New change = new generated migration.
   A rename/drop is a new migration with a deliberate down-path, never an edit to a shipped file.
4. **Migrations run only via explicit `runMigrations()` / `pnpm --filter @skervik/server migrate`** —
   never auto-applied on server boot.
5. **UUIDs are generated in application code (`crypto.randomUUID`), not by a DB default/extension** —
   keeps PGlite↔Postgres behavior identical and the id independent of the driver.
6. **The heavy event log stays ndjson (FS/S3).** Postgres stores only match metadata + `event_log_uri`.
   There is NO `events` table (preserves ADR-0009 Fork 2).
7. **M2 ships only `users`, `matches`, `match_players`.** `player_ratings` (M3) and `donations` (later)
   are added when their feature ships — not before.
8. **`status` / `result` / `auth_provider` are `text` validated in application code, not Postgres
   `enum` types** (enum ALTERs fight the append-only migration invariant).
9. **The DB is optional until wired.** Absent `DATABASE_URL`, the server boots on today's FS/in-memory
   stores with no behavior change. S2.6.1 adds schema+repos+migrations only; it does not rewire the room
   (that is S2.6.2/S2.6.3).

## Revisit when

- A second, non-server package needs the schema/repositories → extract `@skervik/db` (Fork 1).
- A migration reaches for a Postgres feature PGlite does not implement → add a real-Postgres docker CI
  smoke job and reopen the equivalence assumption (Fork 5 / Context caveat).
- M3 ranked ships → add `player_ratings`; a donations page ships → add `donations` (Fork 2), each
  designed by its own feature story.
- Event-log volume or query needs outgrow ndjson pointers → reconsider an events sink/OLAP store
  (Fork 3) — but never by inlining events into the relational `matches` row.
