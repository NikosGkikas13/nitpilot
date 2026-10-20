# Nitpilot

Developers' own AI agents review each other's pull requests the moment they open. The author's agent fixes what the reviewer's agent raises, the reviewer's agent checks the fixes, and a person is pinged only when there's a decision to make: the PR is ready to approve, or the agents need a human.

The agents run on each developer's own machine, under their own login (Claude Code today). Nitpilot is the coordinator: a server that hears about PRs from GitHub, decides whose turn it is and hands jobs to the right laptop; a CLI on each laptop that runs the agent; and a web app where people follow and steer each PR's chat.

Not released yet: the hosted version, self-hosting and the npm package come with Plan 3. [docs/architecture.md](docs/architecture.md) explains how it works and why; the design is in [the spec](docs/superpowers/specs/2026-10-07-nitpilot-design.md).

## What's in the repo

| Folder | What it is |
|---|---|
| `apps/server` | The server: one Node process (Hono, Prisma) and Postgres. Webhooks, the workflow engine, the CLI and web sockets, and the web app's files |
| `apps/cli` | `nitpilot`: logs a computer in, links repos, and runs the agent for the jobs it's given |
| `apps/web` | The web app: an installable PWA (React, Vite) with the inbox, each PR's chat, Settings and push notifications |
| `packages/protocol` | The shared contract: every message and REST body as a zod schema, and the `BRAND` names |
| `docs/` | The architecture, plain-language explainers in [`docs/why/`](docs/why/), and the live acceptance runbooks in [`docs/acceptance/`](docs/acceptance/) |

## The web app

The server serves the built web app from the same address as its API, so there is one origin and no CORS ([why/serving-a-spa.md](docs/why/serving-a-spa.md)). Signed in with GitHub, a person sees:

- **The inbox:** the PRs they review and their own, each with a status pill (working, waiting, needs you, ready…) and an unread count, updated live.
- **Each PR's chat:** the agents' points, replies and decisions as a timeline, a live line saying what an agent is doing this second, and the actions that are theirs to take: a note to the agents, Resolve or Continue on an escalated point, Retry on a failed job, and Send or Discard on a draft when their Auto switch is off.
- **Settings:** their computers (with Revoke), their agents, push notifications, the defaults for new chats, the daily cap.
- **Setup:** a checklist that ticks itself off as they install the GitHub App, log in a computer and start their agent.

It installs to the Home Screen (desktop and iPhone) and sends Web Push notifications, falling back to the CLI's desktop notification when push isn't on ([why/web-push.md](docs/why/web-push.md), [why/service-workers-and-pwa.md](docs/why/service-workers-and-pwa.md)).

## Running it locally

You need Node 22, Docker, and a GitHub App of your own for development (its settings go in `apps/server/.env`; see `apps/server/.env.example`).

```bash
npm ci
docker compose up -d                       # Postgres on port 5433
npm run db:deploy -w apps/server           # create the tables
npm run dev -w apps/server                 # the server on http://localhost:8787
npm run dev -w apps/web                    # the web app on http://localhost:5173 (it passes /api and /ws to the server)
npm run dev:tunnel                         # GitHub's webhooks reach your laptop while this runs
```

`npm run vapid:keys -w apps/server` makes the key pair Web Push needs; without it, push is off and notifications go to the CLI.

## Tests

```bash
npm test                 # every package's unit and database tests
npm run typecheck && npm run lint
npm run test:e2e         # the server, two CLIs and a scripted agent, end to end
npm run test:web-e2e     # builds the web app, then Playwright drives it in Chromium against that same setup
```

CI runs all of them on every pull request. The live acceptance runs, against real GitHub, real accounts and a real agent, are checklists: [Plan 1](docs/acceptance/plan-1.md) for the agents and the CLI, [Plan 2](docs/acceptance/plan-2.md) for the web app.
