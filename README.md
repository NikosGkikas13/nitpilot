# Nitpilot

Your own AI agent reviews your teammates' pull requests, and theirs reviews yours.

You find Nitpilot here, run `npm install -g nitpilot`, sign in at [nitpilot.dev](https://nitpilot.dev) and install the app on your public repos. The next time a teammate requests your review, your own agent (Claude Code or GitHub Copilot CLI, on your own machine, under your own subscription) reads the PR and posts its review within seconds, in your name. Nobody else has to sign up for anything.

## Install

You need Node 22 and one agent, installed and signed in: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (the default), or [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) (`npm install -g @github/copilot`, then `copilot login`).

```bash
npm install -g nitpilot
nitpilot login          # opens nitpilot.dev in your browser to approve this computer
```

Then, on nitpilot.dev's **Setup** page, click **Install on GitHub** and pick the repos (public ones on nitpilot.dev). In a local clone of each repo:

```bash
nitpilot repos add      # link this clone, so jobs for its PRs can come to this computer
nitpilot start          # stay connected and run jobs (Ctrl-C stops)
```

To use Copilot CLI, set `"agent": "copilot"` in `~/.config/nitpilot/config.json` (the file `nitpilot login` writes). An optional `"model"` picks the model in the agent's own naming, such as `"claude-sonnet-5.5"`; without it the agent uses its default. Copilot Business and Enterprise users need their admin to leave the Copilot CLI policy on.

That's it. When someone requests your review, `nitpilot start` prints `→ review of owner/repo#12`, your agent reviews the PR in an isolated copy of it, and the review appears on GitHub with inline comments. `nitpilot status` shows your open PRs, and `nitpilot doctor` says what's wrong if nothing happens.

The web app at nitpilot.dev shows each PR as a chat: the points, the replies, and what is waiting for you. It installs to your Home Screen and sends push notifications. In **Settings** you can turn **Auto-review** off, and then your agent's review waits as a draft for you to send.

## When your teammate is on it too

When both sides of a PR are on Nitpilot, the agents work it out between them. The reviewer's agent raises points; the author's agent fixes them, answers or declines each one, and pushes a commit; the reviewer's agent checks the fixes. The PR gets one summary comment from `nitpilot[bot]`, edited as the rounds go, and a person is pinged only when there's a decision to make: the PR is ready to approve, or the agents disagree, or a point needs a human (security points always do). Approving and merging stay on GitHub, done by a person.

The author side works alone too: if you're the author and your reviewer isn't on Nitpilot, their comments become points your agent can fix, and its replies go in each comment thread.

## What to know

- **Claude Code or GitHub Copilot CLI.** A Gemini CLI adapter waits on a way to sign in that Google allows. [docs/adapters.md](docs/adapters.md) shows how to add an agent.
- **Copilot CLI: `nitpilot doctor` can't see your login.** Copilot has no login-status command, so a missing `copilot login` shows up as the first job failing with `auth`.
- **nitpilot.dev is for public repos.** Webhooks from private repos are dropped there. For private repos, [run your own](docs/self-hosting.md).
- **Your review is posted in your name.** It uses your GitHub token, so GitHub shows it under your name and avatar, with no app badge. Only the summary comment comes from `nitpilot[bot]`.
- **Single-player reviewing needs the author to be off Nitpilot.** Once the PR's author has an account on the same instance, the PR becomes agent-to-agent, and the points go to the chat and the summary comment instead of a GitHub review.
- **Your computer has to be on.** Jobs run on your machine. When it's off, the job waits, and the chat says since when you've been offline.
- **Jobs start by themselves only for trusted authors** (owners, members, collaborators, and bots you list). A PR from an outside contributor waits for you to start the review.

## How it works

Four pieces, in one repository:

- **The server** (`apps/server`): one Node process and Postgres. It hears about PRs from GitHub's webhooks, decides whose turn it is with a pure workflow function, and hands jobs to the right computer over a WebSocket. It never runs code from a repository.
- **The CLI** (`apps/cli`): runs on each developer's computer. It checks the PR out into an isolated folder, runs the developer's own agent with only Nitpilot's tools, and sends the result back.
- **The web app** (`apps/web`): the inbox, each PR's chat, Settings and push notifications, served by the server from the same address.
- **The protocol** (`packages/protocol`): every message between them as a zod schema, shared by all three.

[docs/architecture.md](docs/architecture.md) follows one PR through all of it and explains each choice. [docs/why/](docs/why/) has short, plain-language explainers for each backend idea (webhooks, leases, the outbox, git worktrees, prompt injection, and more). The full design is in [the spec](docs/superpowers/specs/2026-10-07-nitpilot-design.md).

## Self-hosting

One Docker image, Postgres and Caddy, started with Docker Compose. The first time it starts, a page on your domain creates your own GitHub App for you, so private repos work. [docs/self-hosting.md](docs/self-hosting.md) walks through it.

## Security

A pull request is untrusted input, and the agent reading it runs on your computer. So:

- **The agent gets tools, not a shell.** Each job starts a small local server (MCP) on `127.0.0.1` with a token that works for that job only. A reviewer can read the code and raise points, nothing else. An author's agent can also edit files and run the checks your repo allows (`npm test`, say), without a shell. Neither gets web access or a GitHub token.
- **The repo can't configure the agent.** Before the agent starts, the CLI deletes the files an agent would load by itself: `.claude/`, `.gemini/`, `.mcp.json`, `.env`, `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, and Copilot's `.copilot/` and `.github/` instructions, agents, skills, prompts and hooks, at any depth and in any letter case. Git runs with hooks, symlinks and submodules off.
- **Text from the PR is marked as untrusted.** The title, body and comments reach the agent wrapped as data from an outside source, and the agent is told what that means.
- **Your credentials stay yours.** Nitpilot never sees your Anthropic or Copilot login. Your GitHub token is stored encrypted on the server and used only to post your reviews and replies.

More in [why/prompt-injection.md](docs/why/prompt-injection.md), [why/safe-git.md](docs/why/safe-git.md) and [why/local-mcp-server.md](docs/why/local-mcp-server.md).

Found a vulnerability? Please report it privately through [GitHub's vulnerability reporting](https://github.com/NikosGkikas13/nitpilot/security/advisories/new), not in a public issue.

## Development

### Running it locally

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

### Tests

```bash
npm test                 # every package's unit and database tests
npm run typecheck && npm run lint
npm run test:e2e         # the server, two CLIs and a scripted agent, end to end
npm run test:web-e2e     # builds the web app, then Playwright drives it in Chromium against that same setup
npm run image:smoke      # builds the Docker image and checks it starts, stops and migrates
```

CI runs them on every pull request. The live acceptance runs, against real GitHub, real accounts and a real agent, are checklists: [Plan 1](docs/acceptance/plan-1.md) for the agents and the CLI, [Plan 2](docs/acceptance/plan-2.md) for the web app, [Plan 3](docs/acceptance/plan-3.md) for nitpilot.dev. Releases are in [docs/releasing.md](docs/releasing.md); running nitpilot.dev is in [docs/hosting.md](docs/hosting.md).

## License

[MIT](LICENSE)
