# Contributing to Archipelago

> Codename **Archipelago** (final brand TBD — story S0.1.2). An open-source online
> "explore — trade — settle" game. Thanks for helping build it!

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md). To report a
security issue, follow [SECURITY.md](SECURITY.md) — **do not** open a public issue.

## License of contributions

This project is licensed under **AGPL-3.0** (see [LICENSE](LICENSE) and
[ADR-0001](docs/adr/0001-license.md)). By submitting a contribution you agree it is
licensed under AGPL-3.0. Please sign off your commits (DCO): `git commit -s`.

## Before you start

- Read the plan: **[`docs/specs/roadmap/ROADMAP.md`](docs/specs/roadmap/ROADMAP.md)** (zero → 1.0).
- Read the invariants in **[`docs/wiki/`](docs/wiki/)** — these are non-negotiable.
- Pick up work from **[`docs/specs/`](docs/specs/)** (current milestone is M0, `docs/specs/m0-foundation/`) or a `good first issue`.

## Prerequisites

- **Node.js 22** and **pnpm** (`corepack enable`).
- **Git for Windows** if on Windows — the repo's hooks run via Git Bash (see the
  project memory note on Windows hooks; absolute Git Bash path is used by design).

## Local setup

> ⚠️ The repo is greenfield. These commands become real once M0 story **S0.2.1**
> lands the monorepo skeleton; until then they are the target contract.

```bash
pnpm i                 # install workspace
pnpm -r typecheck      # tsc --noEmit across packages
pnpm -r lint           # eslint
pnpm -r test           # vitest (core: pnpm --filter @arch/core test)
pnpm -r build          # build all packages
pnpm --filter @arch/client dev   # run the client locally
```

## Repository layout

| Path | What |
|---|---|
| `packages/core` (`@arch/core`) | Pure deterministic rule engine — **zero runtime deps** |
| `packages/protocol` | Shared WS/REST message types (zod) |
| `packages/server` | Colyseus rooms + Fastify REST |
| `packages/client` | Pixi.js v8 + React/Zustand + Vite |
| `packages/bots` | AI (heuristic → MCTS) |
| `docs/specs/` · `docs/adr/` · `docs/wiki/` | Plans/stories · decisions · invariants |

## Hard invariants (a PR that breaks these will be rejected)

1. **Deterministic core** — no `Date.now()`, `new Date()`, `Math.random()`, I/O, or iteration-order-dependent logic in `@arch/core`. Randomness/time enter only as event data from the seeded PRNG. ([wiki](docs/wiki/deterministic-core.md), [ADR-0003](docs/adr/0003-deterministic-core.md))
2. **Server authority** — clients send *intents*; only server-emitted *events* mutate state; hidden info is never sent to clients. ([wiki](docs/wiki/server-authority.md))
3. **Provably fair RNG** — commit-reveal seed; all randomness recomputable from the event log. ([wiki](docs/wiki/fair-rng-commit-reveal.md))
4. **No pay-to-win** — gameplay is never paywalled; monetization (if any) is cosmetic-only.

## Workflow (VULYK)

This repo uses the [VULYK](https://github.com/Black-coffe/vulyk) hive workflow.
Typical loop: `/vulyk-plan <epic>` → review stories in `docs/specs/<slug>/` →
`/vulyk-build` → `/vulyk-review` → merge. You don't need VULYK to contribute — a
normal fork-branch-PR flow is fine.

## Branches, commits, PRs

- Branch from `main`: `feat/<short>`, `fix/<short>`, `docs/<short>`, `chore/<short>`.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`); sign off (`-s`).
- One logical change per PR; reference the story (`docs/specs/...`) or issue it closes.
- CI must be green: typecheck, lint, test, and the **core determinism test**.
- Update `docs/wiki/` / `docs/adr/` when you change an invariant or make an architectural decision (write an [ADR](templates/adr.md) for the latter).

## Questions

Open a [discussion or issue](.github/ISSUE_TEMPLATE/) or join the Discord (link in
the [README](README.md)).
