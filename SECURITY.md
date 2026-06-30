# Security Policy

We take the integrity of the game and the safety of players' data seriously.
Thank you for helping keep Archipelago secure.

## Supported versions

| Version | Supported |
|---|---|
| `main` (pre-1.0, in development) | ✅ — all security fixes land here |
| tagged releases | ✅ from 1.0 onward |

Until 1.0 there are no released versions; report against `main`.

## Reporting a vulnerability

**Please do not open a public issue, PR, or Discord message for a vulnerability.**

Use **GitHub's private vulnerability reporting**: the repo's **Security** tab →
**“Report a vulnerability.”** This opens a private advisory visible only to maintainers.

<!-- TODO(owner): add a security@<domain> fallback address once the domain is
     registered (tracked by story S0.1.2). -->

Please include:

- a description and impact,
- steps to reproduce (a minimal repro, match seed, or event log if relevant),
- affected component (`@arch/core`, server, client, auth, infra),
- any suggested fix.

### What to expect

- **Acknowledgement** within ~72 hours.
- An initial assessment and severity rating shortly after.
- Coordinated disclosure: we'll agree on a timeline and credit you (if you wish) in
  the advisory and release notes. Please give us reasonable time to fix before any
  public disclosure.

## Areas of particular interest

Given the design, we especially want reports about:

- **Server-authority bypass** — making the server accept an illegal action / state (see [`docs/wiki/server-authority.md`](docs/wiki/server-authority.md)).
- **RNG fairness** — predicting or influencing rolls, or breaking the commit-reveal scheme (see [`docs/wiki/fair-rng-commit-reveal.md`](docs/wiki/fair-rng-commit-reveal.md)).
- **Hidden-information leaks** — a client receiving data it should not see (opponents' dev cards, unrevealed state).
- **Auth / account** — session, JWT/refresh, OAuth, or GDPR delete/export flaws.
- **Anti-cheat / abuse** — rate-limit bypass, denial of service against a room.

## Safe harbor

Good-faith security research that respects players' privacy, avoids data
destruction, and follows this policy is welcome; we will not pursue action against
researchers acting accordingly.
