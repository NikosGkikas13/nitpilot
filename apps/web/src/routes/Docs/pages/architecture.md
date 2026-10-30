# Architecture

This page follows one pull request through Nitpilot and explains every significant technology choice: what was chosen, what else was considered, and why the choice won. Short explainers for each backend idea are in [the plain-language explainers](https://github.com/NikosGkikas13/nitpilot/tree/main/docs/why).

## 1. What Nitpilot does

Developers' own AI agents (Claude Code and GitHub Copilot CLI today) review each other's pull requests the moment they open. The author's agent fixes what the reviewer's agent raises, the reviewer's agent checks the fixes, and a human is pinged only when there is a decision to make: the PR is ready to approve, or the agents disagree, or something needs a person.

The agents run on each developer's own machine, under their own login. Nitpilot is the coordinator: it hears about PRs from GitHub, decides whose turn it is, hands jobs to the right laptop, and writes the results back to the PR.

## 2. The big picture

```
            webhooks                                  writes (summary as bot; reviews and replies as the user)
GitHub ──────────────────▶ ┌──────────── Nitpilot server (one Node process) ────────────┐ ──────▶ GitHub
                           │ GitHub adapter → normalized events → engine (pure rules)  │
                           │ Postgres: chats · points · messages · jobs · tasks · raw  │
                           │ job assigner · task runner (outbox, timers) · WS hubs     │
                           └──────────▲───────────────────────────────────▲────────────┘
                                      │ WebSocket /ws/cli                 │ web app (same address)
                         ┌────────────┴────────────┐
                         │ Nitpilot CLI (each dev) │
                         │ safe git worktrees      │
                         │ local MCP server        │
                         │ agent adapters          │
                         └────────────┬────────────┘
                                      ▼
                         claude / copilot (the user's own install)
```

Three programs, one shared package:

1. **Server** (`apps/server`): one Node process (Hono) plus Postgres. It never runs code from a repository.
2. **CLI** (`apps/cli`): runs on each developer's machine. It is the only component that touches code: it checks the PR out into an isolated folder, runs the developer's agent, and (for fixes) commits and pushes.
3. **Web app** (`apps/web`): an installable PWA (React, Vite) with the inbox, each PR's chat, Settings and push notifications, served by the server from its own address ([serving a single-page app](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/serving-a-spa.md)). The server still renders a few pages itself: sign-in, CLI approval and a read-only chat transcript.
4. **Protocol** (`packages/protocol`): zod schemas for every message, job and result, plus the `BRAND` constant. All three apps import it, and the CLI bundles it so `npx nitpilot` needs nothing else.

## 3. A PR's life, end to end

1. **GitHub sends a webhook** (`POST /webhooks/github`). The server checks the HMAC signature on the raw bytes, stores the body as a `RawEvent` keyed by GitHub's delivery id (a repeat is dropped), and answers `202` at once. See [webhooks](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/webhooks.md).
2. **Normalize.** `platform/github/normalize/` turns GitHub's JSON into the engine's vocabulary: `pr_opened`, `review_requested`, `head_updated`, `external_comment`, and so on. GitHub is the only thing in the server that knows GitHub's field names.
3. **Route and dispatch.** The router finds or creates the PR's chat, and the dispatcher takes that chat's in-memory lock, loads its state and calls the engine.
4. **The engine decides** (`engine/decide.ts`, a pure function): given the chat, the team's rules and one event, it returns the new chat state, new timeline items, and commands: queue a job, cancel jobs, post a review, notify someone.
5. **One transaction** saves the state, the timeline, the jobs and the tasks together. GitHub is never called while the lock is held; a `Task` row (the outbox) says what to write later.
6. **The assigner hands a job to a CLI.** One atomic compare-and-swap moves a `Job` from `queued` to `running` and binds it to a connected CLI that belongs to the right person, has the repo linked, has free capacity and runs an agent for the job's mode. The CLI receives the job over its WebSocket.
7. **The CLI runs it.** It fetches the PR into a detached git worktree with hardened git settings, deletes the files that would steer the agent (`CLAUDE.md`, `.mcp.json`, `.claude/`, …), starts a local MCP server for this one job and launches the agent with only the tools the job's mode allows.
8. **The agent works through Nitpilot's tools.** A reviewer calls `get_diff`, `add_point`, `finish`. An editor edits files, runs allowlisted checks (`run_check`) and answers each point (`reply_to_point`). Nothing reaches the server until the agent finishes: the results are buffered and sent once.
9. **The result comes back** as `job.complete`. Fixes are committed and pushed by the CLI itself, after the server has acknowledged `job.pushing`. The engine turns the result into points, replies and the next step.
10. **Tasks write to GitHub:** the summary comment as the app bot (edited in place, never duplicated), and, in single-player modes, a review or thread replies as the user.
11. **The loop repeats** (review, address, re-review) until the chat is `ready`, or a point escalates, or the round limit is reached. Approving and merging always happen on GitHub, by a human.

## 4. Decisions

### 4.1 One Node process and Postgres, no queue

- **Chosen:** a single server process. Durable work is rows in Postgres (`Job`, `Task`); a 1-second in-process ticker runs timers and the outbox. At boot the server takes a Postgres advisory lock and refuses to start if another instance holds it.
- **Alternatives:** Redis with BullMQ, `pg-boss`, a managed workflow engine (Temporal), several services.
- **Why:** the heavy work, running agents, happens on users' machines. The server only receives, decides, stores and forwards, so it is I/O-light and one process is plenty. Every extra moving part (Redis, workers) is something a self-hoster must run and a reader must understand. Postgres being the single source of truth also means a restart loses nothing: [one process](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/one-process.md), [the outbox and restarts](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/outbox-and-restarts.md).
- **Cost:** no horizontal scaling. The per-chat locks and WebSocket hubs live in memory, so a second instance would break them (hence the advisory lock).

### 4.2 Agents run on the developer's machine

- **Chosen:** the CLI launches the developer's own `claude` (or `copilot`). Nitpilot never sees an Anthropic or GitHub Copilot credential.
- **Alternatives:** run agents on the server in sandboxes; run them in GitHub Actions; ask users for API keys.
- **Why:** server-side agents mean holding users' API keys and running untrusted repo code on our box, which is a security and cost problem and a different product. Local agents use the subscription the developer already pays for, can run the project's own checks with their real toolchain, and keep the code on the developer's disk.
- **Cost:** a job needs the laptop to be on. The server tracks that honestly ("offline since 09:30" on the transcript page) instead of pretending.

### 4.3 The workflow is one pure function

- **Chosen:** `decide(chat, rules, event, now)` returns the new state and commands with no database, network or clock access. ESLint's `no-restricted-imports` enforces it for `engine/`.
- **Alternatives:** workflow rules spread through route handlers; a state-machine library; an event-sourced design.
- **Why:** the rules (rounds, escalation, who is notified, what a retry means) are the product, and they are the part most likely to be wrong. As a pure function they are tested with plain tables of input and expected output, hundreds of cases that run in milliseconds. See [the pure engine](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/pure-engine.md).

### 4.4 Jobs: compare-and-swap, leases and fencing

- **Chosen:** a job is assigned by an atomic `UPDATE … WHERE status = 'queued'`. A running job holds a 90-second lease that the CLI's 25-second ping extends. Every job message carries `(jobId, attempt)`, and a message with an old attempt is acknowledged as `stale` and ignored, both at the hub and again inside the chat's lock.
- **Alternatives:** trust the connection (a dropped socket means a dead job); a visibility-timeout queue; distributed locks.
- **Why:** laptops sleep, Wi-Fi drops, a CLI can come back after the server gave its job to another. Leases say "I'll assume you're gone if I don't hear from you"; fencing makes sure that if you were not gone after all, your late answer can't overwrite a newer one. A reconnecting CLI reports what it is running, and valid jobs are bound to it again, so a laptop that slept keeps its work. See [leases and fencing](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/leases-and-fencing.md).

### 4.5 A WebSocket between server and CLI

- **Chosen:** one WebSocket per CLI token (`/ws/cli`), authenticated with the CLI's token. The server pushes jobs, cancels and notifications; the CLI sends pings, progress and results.
- **Alternatives:** the CLI polls an HTTP endpoint; server-sent events plus POSTs; long polling.
- **Why:** jobs must start within seconds of a review request, and the server must be able to tell a CLI to stop mid-job. Polling that fast wastes requests, polling slowly delays the first review. The connection itself is the "is this laptop online?" signal. See [WebSockets](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/websockets.md).

### 4.6 A GitHub App that writes as two identities

- **Chosen:** the summary comment is written with the app's installation token (so it shows as `nitpilot[bot]`); reviews and thread replies are written with the person's own user-to-server token, so GitHub shows them under the person's name and avatar (with no app badge: GitHub records no app on a review or reply posted with a user's token). If a person's token can't be refreshed, their writes stop and they are told; Nitpilot never quietly posts as the bot instead.
- **Alternatives:** post everything as the bot; use personal access tokens; require every user to create their own app.
- **Why:** a review "from the bot" is easy to ignore and breaks the rule that the developer's agent speaks for the developer. Personal access tokens are broader than needed. The App model gives per-repo installation, short-lived tokens and a clear audit trail. See [the GitHub App](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/github-app.md), [OAuth with PKCE](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/oauth-pkce.md).

### 4.7 Recognizing our own writes

- **Chosen:** every body we write carries a hidden marker (`<!-- nitpilot:v1 chat=… -->`), and every id we create is stored in `GithubWrite`. A webhook for either is ignored. Our own pushes are announced with `job.pushing` before `git push` and matched by sha.
- **Alternatives:** compare authors (impossible when we write as the user); wait and diff; ignore everything from our app.
- **Why:** GitHub tells us about our own comments and pushes like anyone else's. Without the marker, an agent's reply would be read as a new human comment and start another round, forever.

### 4.8 Safe git, worktrees and a scrub

- **Chosen:** each job gets a detached worktree. Every git call goes through `safeGit()`, which sets `core.hooksPath` to an empty folder, `core.symlinks=false`, `core.fsmonitor=false`, `submodule.recurse=false`, an explicit `GIT_DIR` and `GIT_WORK_TREE`, and a minimal environment. Files that would configure the agent are marked `skip-worktree` and deleted before it starts.
- **Alternatives:** a plain `git clone` per job; a container per job; trusting the repository.
- **Why:** a pull request is untrusted input. A repository can ship git hooks, symlinks to `~/.ssh`, an `.mcp.json` that starts a program, a `CLAUDE.md` with instructions. Worktrees are cheap and leave the developer's own checkout alone; the hardened settings and the scrub close the doors an attacker would try. See [git worktrees](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/git-worktrees.md), [safe git](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/safe-git.md).

### 4.9 Agents get tools, never a shell

- **Chosen:** each job gets a local MCP server on `127.0.0.1` with a random port and a 32-byte bearer token, checked with `timingSafeEqual`, valid only for that job. A reviewer's tools are read-only; an editor's add edits and allowlisted checks, run without a shell in their own process group.
- **Alternatives:** give the agent `bash` and `gh`; let it call the server directly.
- **Why:** an agent with a shell and a GitHub token can be talked into anything by a PR description. With only Nitpilot's tools, the worst a hostile PR can do is raise a silly point. The server also never has to trust the agent: results are validated and applied by the engine. See [the local MCP server](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/local-mcp-server.md).

### 4.10 Untrusted text is marked as such

- **Chosen:** the PR title, body and every comment are wrapped in `<untrusted source="…">` in tool results, and the agent's prompt says what that means. Automatic jobs only start from trusted authors (`OWNER`, `MEMBER`, `COLLABORATOR` or a bot on the team's list).
- **Alternatives:** strip suspicious text; trust the model to resist.
- **Why:** prompt injection can't be filtered out reliably. Marking text as data, limiting what the agent can do, and not auto-running on outside contributors' PRs layer up. See [prompt injection](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/prompt-injection.md).

### 4.11 Adapters, fakes and a conformance suite

- **Chosen:** two interfaces. `PlatformAdapter` (GitHub today) and `AgentAdapter` (Claude Code, GitHub Copilot CLI, a scripted fake; Gemini CLI on hold). Every adapter passes one shared conformance suite for the modes it declares: static checks in CI, live checks run by hand. [Writing an adapter](/docs/writing-an-adapter) shows how to write one.
- **Alternatives:** call GitHub and `claude` directly; mock them per test.
- **Why:** agent CLIs change flags quickly. A suite that checks the *command we would run* (no shell tool for a reviewer, the token only in a 0600 file, the isolation flags present) catches drift in CI. A `FakePlatform` and a fake agent make the whole loop testable without a network or a subscription.

### 4.12 Testing: five layers

- **Chosen:** (1) engine tables; (2) protocol round trips; (3) real-Postgres tests with unique data per test, in a separate `nitpilot_test` database; (4) end-to-end tests with the real server, two real CLIs and the fake agent (`npm run test:e2e`), and the same setup driven through the web app by Playwright in Chromium (`npm run test:web-e2e`); (5) manual live acceptance runs against real GitHub (one checklist for the agents, one for the web app (a phone included) and one for nitpilot.dev itself). The GitHub adapter is also tested against recorded real webhooks ([recorded fixtures](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/recorded-fixtures.md)).
- **Alternatives:** mocks only; browser tests for everything.
- **Why:** each layer catches what the one below can't. Mocks can't tell us what GitHub really sends, and the live run is the only place a real agent meets a real PR. The live run is manual because it needs two accounts and a subscription; it is written down so it can be repeated.

### 4.13 A monorepo with a shared protocol package

- **Chosen:** npm workspaces; `packages/protocol` holds the zod schemas, the enums and the `BRAND` constant.
- **Alternatives:** separate repositories; OpenAPI-generated clients.
- **Why:** the server and CLI must agree on every message exactly. One schema, imported by both, is the contract, and a protocol change fails to compile on both sides at once.

### 4.14 Deploying: one image, a first-run page, two layouts

- **Chosen:** one Docker image (`ghcr.io/nikosgkikas13/nitpilot`, amd64 and arm64) holds the server and the built web app; it runs `prisma migrate deploy` and then the server, as a non-root user, with a `/healthz` check. A version tag publishes it and the CLI (to npm, with provenance) from one workflow. A server with no GitHub App credentials starts in **first-run mode**: it serves only a setup page, which creates the team's own GitHub App through GitHub's manifest flow, stores the credentials encrypted in the database and restarts in normal mode. Two folders use the image: `deploy/self-host/` (the image, Postgres and Caddy) and `deploy/hosted/` (just `nitpilot-server`, for nitpilot.dev, which reuses a Postgres and Caddy that already run on its box).
- **Alternatives:** separate images for the server and the web app; a hosted service only; a setup guide that has the self-hoster create the GitHub App by hand and paste its keys into `.env`; Kubernetes or a platform-as-a-service.
- **Why:** one image is one thing to version, pull and roll back, and the web app needs nothing but static files the server can serve. The manifest flow turns GitHub's long app form (permissions, events, webhook URL, keys) into one click, which is what makes self-hosting for private repos realistic. nitpilot.dev reuses a database and HTTPS proxy that already run on its box, so the hosted instance adds one container and its memory limit, not a second box. See [Docker images](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/docker-images.md), [first run and app manifests](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/first-run-and-app-manifests.md), [reverse proxy and TLS](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/reverse-proxy-and-tls.md), [releasing](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/releasing.md) and [Self-hosting](/docs/self-hosting).
- **Cost:** the hosted instance takes public repos only (`PUBLIC_REPOS_ONLY`): nothing private passes through a box shared by strangers, and private repos mean self-hosting. Deploys are by hand.

## 5. When things go wrong

| What happens | What Nitpilot does |
|---|---|
| The server restarts | Stored deliveries not yet processed are replayed; due tasks run; running jobs get a fresh lease (the server was away, not the CLIs); GitHub is asked to resend recent failed deliveries |
| A laptop sleeps mid-job | If it wakes before the lease ends, `hello` rebinds the job. Otherwise the job was requeued, the old CLI is told to stop, and its late answer is acknowledged `stale` |
| A CLI is offline when a job is due | The job waits; the chat page says "offline since …"; it runs when a CLI with the repo linked connects |
| A human pushes while the author's agent is fixing | The server cancels and requeues that job on the new head; a push that still loses the race is rejected by git as non-fast-forward and becomes `branch_moved`. Nothing is ever force-pushed |
| A GitHub write fails for good | A `write_failed` event: a timeline message, a notification, the person's attention flag. Signing in again clears it |
| The PR closes mid-job | Jobs are cancelled, the CLI stops the agent and removes the worktree |
| The agent hits its quota or the daily cap | The job waits and runs again later; it isn't counted as a failed attempt |
| A PR comes from an outside contributor | The chat waits for a person to start the review by hand |

## 6. Not built yet

Automatic deploys, error tracking and private repos on nitpilot.dev. Gemini CLI is waiting on a way to sign in that Google allows.
