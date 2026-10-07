# Nitpilot

Developers' own AI agents (Claude Code, Gemini CLI) review each other's PRs the moment they open; humans are pinged only when there's a decision to make. Open source, portfolio-grade: polish and a strong demo before breadth.

## Source of truth

- Spec: `docs/superpowers/specs/2026-10-07-nitpilot-design.md`. Read the relevant section before building anything; if the code needs to differ, update the spec in the same change.
- UI design: `docs/design/handoff/design_handoff_nitpilot_web/README.md` (tokens, screens, states). The `.dc.html` files are reference prototypes, not code to copy. Spec §16 records the chosen direction and two fixes that override the mockups.
- Design brief (what was asked of Claude Design): `docs/design/design-brief.md`.

## About the developer

I'm a frontend (React) developer with little backend experience. Write the code so I can open any backend file and follow it, and teach as you go:

- When a backend concept first shows up in the code (webhooks, WebSockets, transactions, advisory locks, leases and fencing, outbox, git worktrees, HMAC, prompt injection, ...), add or update a short plain-language explainer in `docs/why/<topic>.md`. Explain it in terms a React developer already knows, say why Nitpilot needs it, and point to the file that uses it.
- In chat, explain backend decisions briefly before or after making them. Don't assume backend vocabulary.

## Backend: boring and readable

- **One Node process + Postgres.** No Redis, no workers, no queue system, no microservices. Durable work goes in Postgres (the `Job` and `Task` tables); timers and the outbox run on the in-process ticker. If something seems to need more infrastructure, stop and ask.
- Prefer plain, explicit code over clever abstractions: small functions, descriptive names, early returns, no magic.
- Keep workflow rules in the pure engine (`apps/server/src/engine/`): no database, platform or WebSocket imports there.
- TypeScript everywhere. Stack: Hono + Prisma 7 (server), React + Vite PWA (web), Node CLI, npm workspaces, Vitest. Shared zod schemas and the `BRAND` constant live in `packages/protocol`.

## Build order

1. **Plan 1: backend + CLI, no UI.** Milestones M0–M13 in spec §20. The only HTML is the few server-rendered pages listed there.
2. **Plan 2: web app** from the Claude Design handoff.
3. **Plan 3: deploy + launch** (Hetzner, self-hosting, npm, nitpilot.dev).

Finish and verify each plan before starting the next. Don't pull web-app work into Plan 1.
