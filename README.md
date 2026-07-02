# Skervik

> An open-source, online **"explore — trade — settle"** game. Mechanically inspired
> by the trade-build-settle genre, but a **fully independent product** — its own
> name, lore, art, and setting. Honest, provably-fair randomness; catch-up over
> runaway-leaders; matches that fit in an hour; no pay-to-win.
>
> **Domain:** [skervik.com](https://skervik.com) (registered 2026-06-30, active).

**Status:** 🚧 Greenfield / pre-M0 — planning complete, implementation starting.
This repo currently holds the design docs, the architecture decisions, and the
build plan. See the roadmap below.

> ⚖️ **Legal note:** "CATAN" is a trademark of Catan GmbH. Game _mechanics_ are not
> copyrightable, but brand/art/text are — so this project uses entirely original
> naming, lore, and art and is **not affiliated with or derived from** the Catan
> brand. See [ADR-0001](docs/adr/0001-license.md).

## Plan & documents

- 🗺️ **Roadmap (zero → 1.0):** [`docs/specs/roadmap/ROADMAP.md`](docs/specs/roadmap/ROADMAP.md)
- 🎯 **Current milestone (M0):** [`docs/specs/m0-foundation/`](docs/specs/m0-foundation/)
- 🧭 **Product vision / research:** [`docs/catan-online-research-phase.md`](docs/catan-online-research-phase.md)
- 🛠️ **Technical spec:** [`docs/catan-online-tech-spec-phase2.md`](docs/catan-online-tech-spec-phase2.md)
- 📐 **Architecture decisions:** [`docs/adr/`](docs/adr/) · **Invariants:** [`docs/wiki/`](docs/wiki/)

## Decisions (locked)

| Area           | Choice                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- |
| Brand / domain | **Skervik** · skervik.com ([ADR-0007](docs/adr/0007-project-name-brand.md))              |
| License        | **AGPL-3.0** ([ADR-0001](docs/adr/0001-license.md))                                      |
| Render engine  | **Pixi.js v8** (2.5D) ([ADR-0002](docs/adr/0002-render-engine.md))                       |
| Rule core      | **Deterministic isomorphic** TS engine ([ADR-0003](docs/adr/0003-deterministic-core.md)) |
| Realtime stack | **Node + Colyseus + Fastify** ([ADR-0004](docs/adr/0004-realtime-stack.md))              |
| Auth           | guest + Google + Discord ([ADR-0005](docs/adr/0005-auth-providers.md))                   |
| Funding        | Open Collective ([ADR-0006](docs/adr/0006-donations-provider.md))                        |

## Tech stack

TypeScript monorepo (pnpm): `@skervik/core` (pure rules) · `@skervik/protocol` ·
`@skervik/server` (Colyseus + Fastify) · `@skervik/client` (Pixi.js v8 + React + Vite) ·
`@skervik/bots`.

## Package status (honest read of "tests passing")

CI is green across all five packages, but that doesn't mean all five carry equal
weight yet — only `core` has real logic behind it:

| Package             | State                                                                                                                                                                     | Real implementation lands at                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@skervik/core`     | Real: deterministic engine contract (`reduce`/`validate`), seeded PRNG, event-log replay. No game rules (resource production, building, trading, robber) yet — that's M1. | engine contract done (E0.5); game rules → [`E1.1`–`E1.3`](docs/specs/roadmap/ROADMAP.md)                           |
| `@skervik/protocol` | M0 skeleton — one version constant, one smoke test.                                                                                                                       | [`S1.5.1`](docs/specs/roadmap/ROADMAP.md)                                                                          |
| `@skervik/server`   | M0 skeleton — one version constant, one smoke test.                                                                                                                       | [`E1.4`](docs/specs/roadmap/ROADMAP.md)                                                                            |
| `@skervik/client`   | M0 skeleton — one version constant, one smoke test.                                                                                                                       | [`E0.4`](docs/specs/roadmap/ROADMAP.md) (render prototype) → [`E1.6`](docs/specs/roadmap/ROADMAP.md) (full client) |
| `@skervik/bots`     | M0 skeleton — one version constant, one smoke test.                                                                                                                       | [`E2.4`](docs/specs/roadmap/ROADMAP.md)                                                                            |

The "one smoke test" on the four skeleton packages only asserts the package
builds and its export exists — it's a package-exists check, not logic
coverage. So the test count in CI isn't a proxy for how much game/network
logic works; that's `core`'s test suite alone.

## Quickstart

> The client currently renders an M0 placeholder page — see "Package status" above.

```bash
pnpm i
pnpm --filter @skervik/client dev
```

## Contributing

We welcome contributors! Start with [CONTRIBUTING.md](CONTRIBUTING.md), the
[Code of Conduct](CODE_OF_CONDUCT.md), and our [security policy](SECURITY.md).
Community chat: Discord (link coming soon).

## License

[AGPL-3.0](LICENSE) © the Skervik contributors.
