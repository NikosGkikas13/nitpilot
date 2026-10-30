---
description: Your open PRs on Nitpilot and what each one needs from you
argument-hint: "[owner/repo#number]"
allowed-tools: Bash(nitpilot status --json), Bash(nitpilot retry:*)
---

Run `nitpilot status --json` and report what it says. It prints `{ login, server, githubAuth, chats }`. Each chat is one open PR: `repo`, `number`, `title`, `role` (are they the author or a reviewer), `phase`, `round`, `attention` and `url` (the PR's chat on Nitpilot).

How to report:

- Lead with the PRs whose `attention` isn't `none`, since those wait on the person: `decision` (the agents disagree and need a call), `manual_review` (an outside contributor's PR: start the review by hand), `failed` (their agent couldn't finish), `drafts` (the agent's work waits for Send or Discard). Then list the rest in one short line each.
- Give each PR's `url` as a link, so they can open the chat in one click. Decisions and drafts are made there.
- If `githubAuth` is `needs_reauth`, say first that they must sign in again at `server`, or their agent can't post in their name.
- For a `failed` PR, offer to run it again with `nitpilot retry https://github.com/<repo>/pull/<number>`, and run it only if they say yes.
- If the command isn't found, tell them to install it: `npm install -g nitpilot`, then `nitpilot login`. If it says they aren't logged in, tell them to run `nitpilot login`.

If they named a PR here, report on that one only: $ARGUMENTS

Keep it short: a few lines, no tables unless there are more than five PRs.
