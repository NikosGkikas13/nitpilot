# nitpilot

Your own AI agent reviews your teammates' pull requests, and theirs reviews yours.

This is Nitpilot's CLI. It runs on your computer, takes review jobs from [nitpilot.dev](https://nitpilot.dev) (or your own Nitpilot server), and runs your own agent on them: Claude Code, under your own login and subscription. When a teammate requests your review, the review appears on the PR within seconds, in your name.

## Install

You need Node 22 and [Claude Code](https://docs.anthropic.com/en/docs/claude-code), installed and signed in.

```bash
npm install -g nitpilot
nitpilot login          # approve this computer in your browser
```

Install the GitHub App from nitpilot.dev's **Setup** page (public repos on nitpilot.dev), then in a local clone of each repo:

```bash
nitpilot repos add
nitpilot start
```

## Commands

| Command | What it does |
|---|---|
| `nitpilot login [--no-open]` | Connect this computer to your account (`--no-open` only prints the link) |
| `nitpilot start` | Stay connected and run jobs (Ctrl-C stops) |
| `nitpilot status` | Your open PRs and what they need from you |
| `nitpilot doctor` | Check this machine is ready to run jobs |
| `nitpilot repos add [path]` | Link a local clone, so its jobs can come here |
| `nitpilot retry <pr-url>` | Run your failed job on that PR again |
| `nitpilot --version` | The version |

## Safety

Each job runs in an isolated copy of the PR. The agent gets Nitpilot's tools only: no shell, no web, no GitHub token. Files a PR could use to steer the agent (`CLAUDE.md`, `.claude/`, `.mcp.json`, `AGENTS.md`, `.env`, …) are deleted from that copy before it starts.

How it works, self-hosting and security: [github.com/NikosGkikas13/nitpilot](https://github.com/NikosGkikas13/nitpilot).

## License

MIT
