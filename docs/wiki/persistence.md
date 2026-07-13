# Persistence layer — invariants (ADR-0012)

The first database surface in the monorepo (epic E2.6). Source of truth: `docs/adr/0012-persistence-layer.md`.
Stack: **Drizzle ORM + drizzle-kit** (schema-in-TS + SQL-first migrations) · **PGlite**
(`@electric-sql/pglite`) for hermetic tests · **real Postgres via docker-compose** for local/prod.

These invariants are binding for every E2.6 story and any future code that touches the DB.

1. **The DB dependency lives ONLY in `packages/server`.** `@skervik/core` stays zero-runtime-dep
   (ADR-0003, guarded by `scripts/check-core-no-runtime-deps.mjs`); `@skervik/protocol` stays
   type-only. No `@skervik/db` package exists until a second, non-server consumer needs the schema.

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
   There is NO `events` table (preserves ADR-0009 Fork 2 — the determinism gate replays the same bytes).

7. **M2 ships only `users`, `matches`, `match_players`.** `player_ratings` (M3 ranked/Glicko-2) and
   `donations` (later) are added when their feature ships — not before.

8. **`status` / `result` / `auth_provider` are `text` validated in application code, not Postgres
   `enum` types** (enum ALTERs fight the append-only migration invariant).

9. **The DB is optional until wired.** Absent `DATABASE_URL`, the server boots on today's FS/in-memory
   stores with no behavior change. S2.6.1 adds schema+repos+migrations only; it does not rewire the room
   (that is S2.6.2/S2.6.3).

## Story map (E2.6)

- **S2.6.1** — schema (`users`/`matches`/`match_players`) + `drizzle.config` + generated migrations +
  `runMigrations` + `migrate` script + three typed repositories + PGlite-backed repo tests. Adds deps
  to `packages/server` only. **Does NOT rewire the room.**
- **S2.6.2** — persist guest/OAuth identity into `users` (replaces `InMemoryGuestStore`), gated on
  `DATABASE_URL`. First external-auth surface → `/security-review` before merge.
- **S2.6.3** — `PgMatchMetadataStore` writing `matches`/`match_players` at match-start + `game.ended`;
  extends the `MatchMetadataStore` interface; keeps `event_log_uri` pointing at the ndjson.
- **S2.6.4 / S2.6.5** — GDPR delete/export + solo save/resume: read/history surfaces over the repos.
