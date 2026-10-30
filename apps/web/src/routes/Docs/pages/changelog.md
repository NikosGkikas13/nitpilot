# Changelog

What changed in each release, newest first. Releases are on [npm](https://www.npmjs.com/package/nitpilot) and nitpilot.dev. To upgrade the CLI, run `npm install -g nitpilot`. For a server you host, see [Upgrading](/docs/self-hosting#upgrading).

## v0.2.2

2026-10-30

- A docs site at nitpilot.dev/docs: quickstart, guides, CLI and `config.json` reference, troubleshooting, and the design behind it.

## v0.2.1

2026-10-30

- A sharper looping chat clip on the landing page. No change to the CLI or the server.

## v0.2.0

2026-10-29

- **GitHub Copilot CLI is supported.** Set `"agent": "copilot"` in [config.json](/docs/config-json) to run your reviews and fixes with it. See [Use GitHub Copilot CLI](/docs/copilot-cli).
- A new optional `model` setting picks the model, in the agent's own naming.
- Copilot runs under the same safety rules as Claude Code: it gets only Nitpilot's tools, and the files in a PR that Copilot would load by itself are deleted first.
- `nitpilot doctor` checks that `copilot` is installed. It can't see whether you are signed in, because Copilot has no login-status command.

## v0.1.2

2026-10-29

- The landing page now has a looping clip of a chat.
- The site and docs now name Claude Code as the supported agent. Gemini CLI stays on hold.

## v0.1.1

2026-10-28

- Refreshing the page GitHub sends you back to while creating your GitHub App on a self-hosted server no longer shows "This setup link expired" when the app was saved.
- Stopping the server during startup is now clean, and Docker gives it 30 seconds to finish what it is doing.

## v0.1.0

2026-10-25

The first release.

- Your own agent reviews the PRs you are asked to review, the moment they open. The review is posted in your name, with inline comments.
- When the PR's author is on Nitpilot too, the two agents work it out in a chat: the reviewer's agent raises points, the author's agent fixes or answers them, and a person is pinged only when there is a decision to make.
- The CLI: `nitpilot login`, `start`, `status`, `doctor`, `repos add` and `retry`. See [CLI commands](/docs/cli).
- The web app: an inbox, a live chat per PR, push notifications, and [Settings](/docs/settings) with Auto-review, Auto-fix, drafts you can send or discard, and a daily job cap.
- Agents work in an isolated copy of the PR with only Nitpilot's tools, and no shell. See [Security](/docs/security).
- Hosted at nitpilot.dev for public repos, or [run your own](/docs/self-hosting) with Docker Compose.
