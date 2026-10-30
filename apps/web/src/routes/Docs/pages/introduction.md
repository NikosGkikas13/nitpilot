# Introduction

Nitpilot lets your own AI agent review pull requests the moment they open. When your teammate is on it too, their agent fixes what yours raises, and a person is pinged only when there is a decision to make.

<div role="img" aria-label="A pull request is opened, nitpilot.dev hears about it, your laptop runs your agent, and the review appears on GitHub in your name." style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:20px 0"><span style="padding:8px 12px;border:1px solid var(--b1);border-radius:var(--radius-control);background:var(--surface);color:var(--fg1);font-size:14px">PR opened</span><span aria-hidden="true" style="color:var(--fg3)">→</span><span style="padding:8px 12px;border:1px solid var(--b1);border-radius:var(--radius-control);background:var(--surface);color:var(--fg1);font-size:14px">nitpilot.dev</span><span aria-hidden="true" style="color:var(--fg3)">→</span><span style="padding:8px 12px;border:1px solid var(--b1);border-radius:var(--radius-control);background:var(--surface);color:var(--fg1);font-size:14px">Your laptop (Claude Code or Copilot CLI)</span><span aria-hidden="true" style="color:var(--fg3)">→</span><span style="padding:8px 12px;border:1px solid var(--b1);border-radius:var(--radius-control);background:var(--surface);color:var(--fg1);font-size:14px">Review on GitHub, in your name</span></div>

The agent runs on your computer, under your own login. Nitpilot is the coordinator: it hears about the PR from GitHub, works out whose turn it is, and hands the job to the right laptop.

## What you need

- Node 22.
- One agent, installed and signed in: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), or [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli).
- A GitHub account, and a repo you can open pull requests in.

## Try it

Two commands get you connected:

```bash
npm install -g nitpilot
nitpilot login
```

The [Quickstart](/docs/quickstart) takes you from there to your first reviewed PR.

## What it is not

- The agent gets no shell. It works through a small set of tools that Nitpilot gives it, for that one job.
- Nitpilot never approves or merges. Those stay on GitHub, done by a person.
- The server never runs code from your repository. Only your own computer does.

To see how the pieces fit, read [How it works](/docs/how-it-works).
