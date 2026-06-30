# Archipelago _(codename — final brand TBD)_

> An open-source, online **"explore — trade — settle"** game. Mechanically inspired
> by the trade-build-settle genre, but a **fully independent product** — its own
> name, lore, art, and setting. Honest, provably-fair randomness; catch-up over
> runaway-leaders; matches that fit in an hour; no pay-to-win.

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
| License        | **AGPL-3.0** ([ADR-0001](docs/adr/0001-license.md))                                      |
| Render engine  | **Pixi.js v8** (2.5D) ([ADR-0002](docs/adr/0002-render-engine.md))                       |
| Rule core      | **Deterministic isomorphic** TS engine ([ADR-0003](docs/adr/0003-deterministic-core.md)) |
| Realtime stack | **Node + Colyseus + Fastify** ([ADR-0004](docs/adr/0004-realtime-stack.md))              |
| Auth           | guest + Google + Discord ([ADR-0005](docs/adr/0005-auth-providers.md))                   |
| Funding        | Open Collective ([ADR-0006](docs/adr/0006-donations-provider.md))                        |

## Tech stack

TypeScript monorepo (pnpm): `@arch/core` (pure rules) · `@arch/protocol` ·
`@arch/server` (Colyseus + Fastify) · `@arch/client` (Pixi.js v8 + React + Vite) ·
`@arch/bots`.

## Quickstart

> Available once the M0 monorepo skeleton lands (story S0.2.1).

```bash
pnpm i
pnpm --filter @arch/client dev
```

## Contributing

We welcome contributors! Start with [CONTRIBUTING.md](CONTRIBUTING.md), the
[Code of Conduct](CODE_OF_CONDUCT.md), and our [security policy](SECURITY.md).
Community chat: Discord (link coming with the brand decision, S0.1.2).

## License

[AGPL-3.0](LICENSE) © the Archipelago contributors.
