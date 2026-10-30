# Quickstart

This takes you from nothing to a PR reviewed by your own agent.

## Before you start

- Node 22.
- One agent, installed and signed in: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (the default), or [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli). For Copilot, run `npm install -g @github/copilot`, then `copilot login`.

## Connect your computer

1. Install the CLI:

   ```bash
   npm install -g nitpilot
   ```

2. Sign in:

   ```bash
   nitpilot login
   ```

   This opens nitpilot.dev in your browser, where you approve this computer.

## Give it your repos

1. On the **Setup** page at nitpilot.dev, click **Install on GitHub** and pick the repos. nitpilot.dev works with public repos. For private ones, run your own server.
2. In a local clone of each repo, link it:

   ```bash
   nitpilot repos add
   ```

3. Stay connected, so jobs can reach you:

   ```bash
   nitpilot start
   ```

   Press Ctrl-C to stop. Jobs only arrive while this is running.

## Use Copilot CLI instead

Claude Code is the default. To use Copilot CLI, set `"agent": "copilot"` in `~/.config/nitpilot/config.json`, the file `nitpilot login` writes. An optional `"model"` picks the model, in the agent's own naming, such as `"claude-sonnet-5.5"`. Without it the agent uses its default.

Copilot Business and Enterprise users need their admin to leave the Copilot CLI policy on.

## What you will see

When someone requests your review, `nitpilot start` prints a line like this:

```
→ review of owner/repo#12 (attempt 1)
```

Your agent reviews the PR in an isolated copy of it. The review then appears on GitHub with inline comments, under your name.

`nitpilot status` shows your open PRs, and `nitpilot doctor` says what is wrong if nothing happens. See [Troubleshooting](/docs/troubleshooting) if you are stuck.

Next, read [How it works](/docs/how-it-works).
