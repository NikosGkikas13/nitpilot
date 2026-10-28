# Show HN draft

You post it yourself at https://news.ycombinator.com/submit, then add the first comment on the new item straight away.

**Title** (under 80 characters):

```
Show HN: Nitpilot – your own AI agent reviews your teammates' pull requests
```

**URL:**

```
https://github.com/NikosGkikas13/nitpilot
```

Leave the **text** box empty: HN shows either a URL or text, and the first comment carries the explanation.

## First comment

```
Hi HN. Nitpilot lets your own coding agent review your teammates' pull requests. When someone requests your review on GitHub, the agent on your laptop (Claude Code, under your own subscription) checks the PR out, reviews it, and posts the review with inline comments in your name. In my test runs the job starts in under a second and the review is on the PR about 40 seconds later. Nobody else on the team has to sign up.

Why: I already pay for an agent and use it all day, but reviews still meant opening the diff cold. I wanted my agent to do the first pass the moment the request comes in, so I start from its notes instead of from nothing.

If the author is on Nitpilot too, the two agents work the PR out between them: the reviewer's agent raises points, the author's agent fixes, answers or declines each one and pushes a commit, and the reviewer's agent checks the fixes. You're pinged only when there's a decision to make (it's ready to approve, the agents disagree, or a point always needs a human, like security). Approving and merging stay with people, on GitHub.

How it works: a CLI on each developer's machine, and one server (one Node process plus Postgres) that hears GitHub's webhooks and hands jobs to the right laptop over a WebSocket. The server never runs repository code. The agent runs on your machine in an isolated copy of the PR, with a small set of Nitpilot tools instead of a shell, no web access and no GitHub token; files a repo could use to configure the agent (.claude/, CLAUDE.md, .mcp.json and so on) are deleted first, and PR text reaches it marked as untrusted.

What to know:
- Claude Code only for now. A Gemini CLI adapter is waiting on a way to sign in that Google allows.
- nitpilot.dev is for public repos only. For private repos you can self-host: one Docker image, Postgres and Caddy, and a first-run page that creates your own GitHub App.
- Reviews are posted with your GitHub token, so they show under your name with no app badge. Only the summary comment in agent-to-agent mode comes from nitpilot[bot].
- Single-player reviewing works while the PR's author isn't on the same instance; once they join, that PR becomes agent-to-agent.
- Your laptop has to be on. When it's off, the job waits.

It's MIT licensed, and I'm a frontend developer, so this was my first real backend: the repo has short plain-language explainers (docs/why/) for each backend idea it uses. I'd like to hear what breaks, and whether the "review shows in your name" part feels right or wrong to you.

Repo: https://github.com/NikosGkikas13/nitpilot
Hosted: https://nitpilot.dev
npm: https://www.npmjs.com/package/nitpilot
Self-hosting: https://github.com/NikosGkikas13/nitpilot/blob/main/docs/self-hosting.md
```
