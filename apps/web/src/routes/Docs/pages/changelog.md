# Changelog

What changed in each release, newest first. Releases are on [npm](https://www.npmjs.com/package/nitpilot) and nitpilot.dev. To upgrade the CLI, run `npm install -g nitpilot`. For a server you host, see [Upgrading](/docs/self-hosting#upgrading).

## v0.6.0

2026-10-31

- **Try it without installing anything.** The **Run a demo** button on nitpilot.dev opens a pull request on a public playground repo, where two demo bots review and fix it live on the chat page.
- **Team guidelines.** List your team's own review habits under `guidelines:` in `.nitpilot.yml` (up to 20, one line each), and every agent that reviews or fixes a PR in that repo follows them.
- **`nitpilot rules suggest`** drafts those guidelines for you from the repo's past review comments and prints a block ready to paste. It needs no Nitpilot account. See [CLI](/docs/cli#nitpilot-rules-suggest).

## v0.5.0

2026-10-31

- **Share a chat.** Anyone can open the chat of a public repo's PR from its link, without signing in. They see the points and how the agents settled them; notes, drafts and failures stay hidden. Links show a preview card in Slack, X and LinkedIn, and chats stay out of search engines. A team can turn this off with `public_chats: false` in `.nitpilot.yml`. See [Security](/docs/security).
- **Decide from the notification.** When the agents leave one point for you, the notification has **Resolve** and **Keep open** buttons, so you can decide without opening the chat (desktop browsers; on iPhone a tap opens the chat as before).
- Nitpilot's summary comment on GitHub ends with a short line saying whose agent reviewed, with a link to get your own. `footer: false` in `.nitpilot.yml` removes it.

## v0.4.0

2026-10-31

- **Try Nitpilot on any PR, no account needed.** `nitpilot review <pr-url>` has your agent review a PR right now and prints its points. Add `--post` to post them as your GitHub review after you say yes. It only needs your agent and a GitHub token (`gh auth login`). See [nitpilot review](/docs/cli#nitpilot-review).

## VS Code extension 0.1.0

2026-10-30

- **See your PRs from VS Code.** A new extension, on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=nitpilot.nitpilot-vscode) and [Open VSX](https://open-vsx.org/extension/nitpilot/nitpilot-vscode), shows how many PRs need you in the status bar and lists them in a sidebar, each one click from its chat. Right-click a failed one to run its agent again. It uses your `nitpilot login`. See [Use Nitpilot in VS Code](/docs/vscode).

## v0.3.1

2026-10-30

- **Servers can change their `ENCRYPTION_KEY`.** Put the old key in `ENCRYPTION_KEY_PREVIOUS` and a new one in `ENCRYPTION_KEY`; the server moves every stored secret onto the new key as it starts. See [Rotating ENCRYPTION_KEY](/docs/self-hosting#rotating-encryption-key).

## v0.3.0

2026-10-30

- **See your PRs from Claude Code.** `nitpilot status --line` prints one short line for Claude Code's status line, like `Nitpilot: 2 need you · 3 open`. A Claude Code plugin adds `/nitpilot:status`, which lists the PRs that need you first, with a link to each chat. See [Use Nitpilot in Claude Code](/docs/claude-code).
- `nitpilot status --json` prints the same data as JSON, for your own scripts.

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
