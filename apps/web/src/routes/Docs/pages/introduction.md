# Introduction

Nitpilot lets your own AI agent review pull requests when your review is requested. When your teammate is on it too, their agent fixes what yours raises, and a person is pinged only when there is a decision to make.

<div class="flow" role="img" aria-label="A pull request is opened, nitpilot.dev hears about it, your laptop runs your agent, and the review appears on GitHub in your name."><span class="flow-step">PR opened</span><span class="flow-arrow" aria-hidden="true">→</span><span class="flow-step">nitpilot.dev</span><span class="flow-arrow" aria-hidden="true">→</span><span class="flow-step">Your laptop (Claude Code or Copilot CLI)</span><span class="flow-arrow" aria-hidden="true">→</span><span class="flow-step">Review on GitHub, in your name</span></div>

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
