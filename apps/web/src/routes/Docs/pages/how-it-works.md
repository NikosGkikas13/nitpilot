# How it works

Nitpilot is four pieces. Once you know what each one does, the life of a PR makes sense.

## The four pieces

- **The server.** One Node process and Postgres. It hears about PRs from GitHub, decides whose turn it is, and hands jobs to the right computer. It never runs code from a repository.
- **The CLI.** It runs on each developer's computer. It checks the PR out into an isolated folder, runs your agent with only Nitpilot's tools, and sends the result back.
- **The web app.** The inbox, each PR's chat, Settings and push notifications. The server serves it from the same address.
- **The protocol.** Every message between the other three, written once as a shared set of schemas.

## One PR's life

<div role="img" aria-label="GitHub tells the server, the server hands a job to the CLI, and the CLI runs the agent." style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:20px 0"><span style="padding:8px 12px;border:1px solid var(--b1);border-radius:var(--radius-control);background:var(--surface);color:var(--fg1);font-size:14px">GitHub</span><span aria-hidden="true" style="color:var(--fg3)">→</span><span style="padding:8px 12px;border:1px solid var(--b1);border-radius:var(--radius-control);background:var(--surface);color:var(--fg1);font-size:14px">Server</span><span aria-hidden="true" style="color:var(--fg3)">→</span><span style="padding:8px 12px;border:1px solid var(--b1);border-radius:var(--radius-control);background:var(--surface);color:var(--fg1);font-size:14px">CLI</span><span aria-hidden="true" style="color:var(--fg3)">→</span><span style="padding:8px 12px;border:1px solid var(--b1);border-radius:var(--radius-control);background:var(--surface);color:var(--fg1);font-size:14px">Agent</span></div>

1. **GitHub tells the server.** A PR opens or changes, and GitHub sends a webhook. The server checks it is genuine and keeps it.
2. **The server decides.** A pure function looks at the PR's state and the new event, and says what should happen next: queue a job, post a review, or ping a person.
3. **A job goes to a computer.** The server picks a connected CLI that belongs to the right person, has the repo linked and has room. It sends the job over a WebSocket.
4. **The CLI prepares a safe copy.** It fetches the PR into its own git worktree and deletes the files that could steer an agent, such as `CLAUDE.md` and `.mcp.json`.
5. **The agent works through tools.** A reviewer reads the diff and raises points. It has no shell. Nothing reaches the server until the agent finishes.
6. **The result goes back.** The server turns it into points, replies and the next step, and writes to GitHub: the review in your name, the summary comment as `nitpilot[bot]`.
7. **It repeats** until the PR is ready, the agents disagree, or a point needs a person. Approving and merging stay on GitHub.

## When both sides are on it

The reviewer's agent raises points. The author's agent fixes them, answers or declines each one, and pushes a commit. The reviewer's agent then checks the fixes. The PR gets one summary comment, edited as the rounds go.

A person is pinged only when there is a decision to make: the PR is ready to approve, the agents disagree, or a point needs a human. Security points always do.

If the author is not on Nitpilot, your agent's review is posted as an ordinary GitHub review.

## Things to know

- Your computer has to be on. Jobs run there, and they wait while it is off.
- Jobs start by themselves only for trusted authors: owners, members, collaborators, and bots you list.
- nitpilot.dev is for public repos. Webhooks from private repos are dropped there.
