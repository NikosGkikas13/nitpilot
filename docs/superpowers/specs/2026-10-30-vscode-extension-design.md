# Nitpilot for VS Code: design

Status: draft, waiting for approval (2026-10-30).

## Why

Nitpilot pings a human only when there's a decision to make. Today that ping lands on nitpilot.dev (web push) or in Claude Code (the 0.3.0 status line and `/nitpilot:status`). Developers who live in VS Code still have to open the web app to see whether anything waits on them. The extension puts that answer where they already are: one glance at the status bar, one click to the chat.

It is the same goal as 0.3.0's Claude Code integration, for the other editor most of our users have open.

## Goals

- At a glance, from any VS Code window: how many of my open PRs need me right now.
- A list of my open PRs, the ones that need me first, each one click away from its chat on Nitpilot.
- Run a failed agent again without leaving the editor.
- Works for anyone who already ran `nitpilot login`: no second sign-in, no settings to fill in.
- Published on the VS Code Marketplace and Open VSX (so Cursor, Windsurf and VSCodium users get it too).

## Non-goals (v1)

- Making decisions, sending or discarding drafts, or reading the chat inside VS Code. Those stay on the web app, which has the full chat. The extension links there.
- Running the agent (`nitpilot start`) from the extension. That stays the CLI's job, in a terminal.
- Live push. The extension polls (see "Polling"); a live channel needs new server work and isn't worth it for a counter.
- Filtering by the repo open in the workspace, PR diffs, inline comments, notifications/toasts. The web app already sends push notifications; a second ping would be noise.
- Its own sign-in. It reads the CLI's login.

## Anti-goals

- It must never nag or block the editor: no modal dialogs, no toasts on every poll, no slow startup. If the server is down it says so quietly in the status bar and keeps trying.
- It must never write to `~/.config/nitpilot/config.json` or print the token anywhere (logs, tooltips, errors).

## What the user sees

### Status bar (left side, low priority)

| State | Text | Background |
|---|---|---|
| Something needs you | `$(bell-dot) 2 need you` | the theme's warning background |
| Open PRs, nothing needs you | `$(check) 5 open` | normal |
| No open PRs | `$(check) Nitpilot` | normal |
| Not logged in | `$(account) Nitpilot: log in` | normal |
| Can't reach the server | `$(cloud-offline) Nitpilot` | normal |
| GitHub sign-in expired (`githubAuth: needs_reauth`) | `$(warning) Nitpilot: sign in again` | the theme's warning background |
| Anything else went wrong (broken config, version mismatch) | `$(warning) Nitpilot` | normal |

The tooltip says the same in a full sentence (for example "2 PRs need you · 5 open on nitpilot.dev"). Clicking it opens the Nitpilot sidebar; when not logged in, it runs **Nitpilot: Log in** instead; when GitHub sign-in expired, it opens the server's home page.

The counts match `nitpilot status --line` exactly: "need you" is every chat whose `attention` isn't `none`.

### Sidebar

A Nitpilot icon in the activity bar (the brand mark from `apps/web/public/icons/icon.svg`, as a single-color SVG) opens one view, **Pull requests**:

```
NEEDS YOU (2)
  ? acme/shop-api#142  Fix cart rounding        a decision
  ✕ acme/web#88        Add dark mode            agent failed
OPEN (3)
  ⎇ acme/shop-api#140  Bump deps                reviewing · round 2
  ...
```

- Two groups, **Needs you** and **Open**, each with its count; empty groups are hidden. Needs you is expanded; Open is expanded too (both are short lists).
- Each PR row: label `repo#number`, description = the title, then what it needs (same words as the CLI's NEEDS YOU column: `a decision`, `start review`, `agent failed`, `drafts`) or, in Open, `phase · round N`. Icon per attention: `decision` → `question`, `manual_review` → `eye`, `failed` → `error`, `drafts` → `edit`, `none` → `git-pull-request` (codicons). Tooltip: full title, role (author or reviewer), phase, round.
- Order inside a group: the server's order (it is already newest first by `updatedAt`).
- Click a row: open its `url` (the chat on Nitpilot) in the browser.
- Right-click a row: **Open chat on Nitpilot**, **Open PR on GitHub**, and on `failed` rows only, **Retry agent**. The server sends only the chat link; the GitHub link comes from the CLI's `prUrl()` (`apps/cli/src/commands/status.ts`), since Nitpilot is github.com-only.
- View title bar: **Refresh**.
- If `githubAuth` is `needs_reauth`, a first row above the groups: "GitHub sign-in expired. Sign in again", which opens the server's home page.

Empty and error states use VS Code's "welcome view" (text plus a button in the empty view):

- Not logged in: "Sign in to Nitpilot to see your PRs here." Button: **Log in** (runs **Nitpilot: Log in**).
- Logged in, no open PRs: "No open PRs with Nitpilot yet. When a PR opens on a repo with Nitpilot, it shows up here." Link to the quickstart.
- Can't reach the server: "Can't reach <server>. Trying again every 30 seconds." Button: **Retry now**.

### Commands (Command Palette, all prefixed "Nitpilot:")

- **Refresh**: poll now.
- **Log in**: opens a VS Code terminal named "Nitpilot" and runs `nitpilot login` in it. The next poll picks up the token (config is re-read on every poll). If `nitpilot` isn't installed, the terminal shows the shell's "command not found"; the welcome text above also says "Needs the nitpilot CLI: `npm install -g nitpilot`".
- **Retry agent** (row menu only): runs the retry, then shows a short status-bar message with the CLI's wording ("Queued your agent again on acme/web#88" or "Cleared the failure on acme/web#88. Your agent runs again once the PR's current step is done"), then refreshes. An error shows as a normal VS Code error message.
- **Show PRs**: focuses the sidebar view (what the status bar click runs).

No settings in v1. The server and token come from the CLI's config, like every other Nitpilot tool.

## How it works

### Talking to the server: call the API directly, reusing the CLI's own code

The extension calls the same two endpoints `nitpilot status` calls, `GET /api/me` and `GET /api/me/chats`, and `POST /api/chats/:id/retry` for retry, with the device token from the CLI's config. It does this by importing the CLI's own `loadConfig` (`apps/cli/src/config/config.ts`) and `ServerClient` (`apps/cli/src/http.ts`), bundled into the extension at build time.

Why not shell out to `nitpilot status --json`:

- **PATH.** VS Code started from the Dock or Start menu often doesn't see the shell's PATH, and nvm/volta installs make it worse. "command not found" in an editor extension is the most common support issue of this kind; calling the API has none of it.
- **Versions.** The extension would need CLI 0.3.0 or later and break on any older install. Calling the API needs only a logged-in config, which every CLI version writes the same way.
- **Speed.** A Node process per poll is ~0.3 s of CPU each time; a fetch is nothing.

Why it's still safe to reuse: `loadConfig` already finds the config the same way the CLI does (`NITPILOT_CONFIG_DIR`, then `XDG_CONFIG_HOME`, then `~/.config/nitpilot`), lets `NITPILOT_SERVER` / `NITPILOT_TOKEN` win, and validates the file; `ServerClient` already joins server paths correctly, checks every answer against the protocol's zod schemas, and turns failures into readable errors. One source of truth for both; a bug fixed in the CLI is fixed in the extension at its next build.

Retry looks up nothing: the row already has the chat `id`, so it calls `ServerClient.retry(id)` directly.

### Polling, not the WebSocket

The server has two WebSockets. `/ws/cli` is for the agent daemon (`nitpilot start`): it claims jobs, and a second connection would confuse it. `/ws/web` signs in with the browser's cookie, not a device token, and streams one chat at a time; there is no "my PRs changed" stream. Adding one is server work for a counter that can be 30 seconds late. So the extension polls:

- Every 30 seconds (the same as `LINE_CACHE_MS`) **while the VS Code window is focused**.
- Immediately when the window gains focus, when the extension starts, after **Refresh**, and after **Retry agent**.
- Not at all while the window is in the background, so ten open windows don't mean ten clients hammering the server.
- One poll at a time: if one is still running, a new trigger waits for it instead of starting a second.
- Each poll: `me()` and `myChats()` in parallel, each with a 10 s timeout. `me()` gives `githubAuth`.

`shortcut: polling (30 s, focused windows only); a live "my chats changed" stream on a token-authed socket if users ask for instant updates.`

### Errors

`ServerClient` (`apps/cli/src/http.ts`) throws `ServerError` with `status` 0 for a network failure or timeout, the HTTP status for a 4xx/5xx, and the answer's status (usually 200) when the answer doesn't match the protocol's schema. A missing token throws a plain `CliError` before any request, so `poll.ts` checks `token === null` first.

How the two calls combine: `/api/me` never needs GitHub, so it decides who you are. `/api/me/chats` asks GitHub which repos you can still read, so when your GitHub sign-in expired it fails with 401 (`code: 'reauth'`, `apps/server/src/chats/repo-filter.ts`) at the same moment `/api/me` answers 200 with `githubAuth: 'needs_reauth'`. The extension never reads error text or codes to tell these apart; `me()` tells it. No CLI change is needed.

A poll ends in one of five states, and the status bar, view and welcome text follow it:

- `ok`: show the chats.
- `needs_reauth`: `me()` says `githubAuth: 'needs_reauth'`. If the chats still came back, show them under the "sign in again" row; if they failed (the usual case), keep the last good list, marked stale, under that row, or with no list yet, a welcome text "Your GitHub sign-in expired. Sign in again on <server> to see your PRs." with a button that opens the server.
- `logged_out`: no token in the config, or `me()` answered 401 (revoked device).
- `unreachable`: `ServerError` with status 0 or 5xx (this includes 502 `github_unavailable`, "GitHub didn't answer"). The last good list stays in the tree, marked stale ("as of 14:02"), so a blip doesn't empty the sidebar; the status bar shows the offline icon and the tooltip shows the error's message.
- `error`: anything else. `loadConfig` threw (broken JSON, bad server address: its message already names the file and field), an answer didn't match the schema (the server and the extension's bundled protocol drifted apart: the message adds "Update the Nitpilot extension, or check the server's version"), or another 4xx. The welcome view shows the message; the status bar shows `$(warning) Nitpilot` with the message as its tooltip.

Retry has no timeout (`ServerClient.retry` takes no signal, as in the CLI); while it runs, the status bar shows a spinner (`$(sync~spin) Retrying…`). Its errors show as a normal VS Code error message with `ServerError`'s text.

Known side effect of reusing the CLI's client: requests carry the CLI's user-agent (`nitpilot/<CLI version>`). Harmless; the server doesn't branch on it.

Nothing is logged except to a "Nitpilot" Output channel, one line per state change (never per poll, never the token).

## Where it lives and how it's built

- New workspace `apps/vscode`, package name `nitpilot-vscode` (private to npm; it ships as a `.vsix`, never to npm). Display name "Nitpilot". Publisher: `nitpilot` (the user creates it; see Releasing).
- Imports `nitpilot` (the CLI workspace) and `@nitpilot/protocol` as dev dependencies, and bundles both into one file with tsup, like the CLI does. `vscode` stays external. Output is CommonJS (`dist/extension.cjs`): the format every VS Code fork loads.
- `engines.vscode`: `^1.90.0` (mid-2024; recent enough for everything used here, old enough for Cursor and Windsurf, which lag behind).
- Activation: `onStartupFinished`, so it never slows the editor's start.
- Code is split so the logic is testable without VS Code:
  - `src/poll.ts`: one poll, returning the state above. Plain functions taking the CLI's `loadConfig` result and a `ServerClient`. No `vscode` import.
  - `src/view-model.ts`: from a poll result to the status bar text/tooltip/warning flag and the tree's groups and rows. No `vscode` import.
  - `src/extension.ts`: the thin VS Code wiring (status bar item, tree data provider, commands, focus listener, timer).
- Packaging: everything is bundled, so `vsce package --no-dependencies` (the npm-workspace `node_modules` never reaches the `.vsix`). A `.vscodeignore` keeps only `dist/`, the icons, README, CHANGELOG and LICENSE.
- Tests: Vitest for `poll.ts` (fake fetch: ok, `me` 401, `me` needs_reauth with chats 401 reauth, timeout, 502, schema mismatch, broken config, no token) and `view-model.ts` (counts match `--line`, grouping, labels, icons, the "as of" stale case). The wiring is checked by hand in the Extension Development Host, using a checklist in the plan. No `@vscode/test-electron` suite in v1: it downloads a whole VS Code in CI to test a few lines of glue.
- Root `typecheck`, `test` and `lint` pick it up through the workspaces like the other apps.

## Releasing

The extension has its own version, starting at `0.1.0`, independent of the CLI and server. It changes rarely and doesn't need a new server image; tying it to `vX.Y.Z` would publish an unchanged extension with every server release.

- Tag `vscode-vX.Y.Z` releases it. A new workflow `.github/workflows/release-vscode.yml` runs on `vscode-v*` tags (the existing `release.yml` runs on `v*`, which `vscode-v…` doesn't match): check the tag equals `version` in `apps/vscode/package.json`, build, package the `.vsix` once with `@vscode/vsce`, publish that same file to the Marketplace (`vsce publish --packagePath`) and Open VSX (`ovsx publish`), and attach it to a GitHub release so people can install it by hand.
- Auth: trusted publishing (the store checks a token GitHub signs for this workflow run, as npm does), so no store password is stored. Marketplace personal access tokens are retired on 2026-12-01 anyway. Open VSX trusts a workflow only once the extension exists there, so the first release uses a one-time `OVSX_PAT` secret, deleted afterwards. Both publish steps use `--skip-duplicate`, so re-running a failed job is safe. (Changed while building Task 5, 2026-10-30.)
- No release candidates: the Marketplace's own pre-release channel isn't worth the extra rules for v1. Try the `.vsix` locally before tagging (`npx vsce package`, then "Install from VSIX…").
- CI (`ci.yml`) gains one step: package the `.vsix` on every push, so a broken manifest fails before release day.
- `docs/releasing.md` gets a section "Releasing the VS Code extension" with the above. `docs/why/releasing.md` gets a short paragraph on why it has its own version.

What the user must do once, by hand (the plan gives each click):

1. Create the Marketplace publisher `nitpilot` and add a Trusted Publishing policy for `NikosGkikas13/nitpilot`, workflow `release-vscode.yml`.
2. Create an Eclipse account, sign the Open VSX publisher agreement, create and claim the `nitpilot` namespace, and store a one-time token as `OVSX_PAT` for the first release; after it, add the trusted publisher and delete the secret.

Both listings use the same README (the docs page below, adapted), a 128 px PNG icon made from `icon-512.png`, MIT license, and the repository link.

## Docs

- New docs page `apps/web/src/routes/Docs/pages/vscode.md`, "Use Nitpilot in VS Code", in the Guides group right after the Claude Code page: install (Marketplace / Open VSX links), log in, what the status bar and sidebar show, retry, and "it polls every 30 seconds while the window is focused".
- `docs/why/vscode-extensions.md`: what a VS Code extension is in React terms (the `contributes` block in package.json is a static manifest like a route table; `activate()` is the app's `main.tsx`; a TreeDataProvider is a component whose `getChildren` is its render, and firing `onDidChangeTreeData` is `setState`), and why polling rather than a socket.
- Main spec (`2026-10-07-nitpilot-design.md`): §16 gains a short "VS Code" paragraph and §21 the new docs page, in the build's first commit (per CLAUDE.md: spec and code change together).
- Changelog docs page: the extension's 0.1.0 entry.

## Risks to check while building

- **Corporate proxies.** Whether Node's global `fetch` in the extension host follows VS Code's `http.proxy` setting varies by version. Check on the hand-test; if it doesn't, note it in the docs page's troubleshooting line rather than adding a proxy library in v1.

## Left to the builder

- Exact wording of tooltips and welcome text, within the tone above.
- The activity-bar SVG (single-color, from the brand mark).
- How the tree marks stale data, as long as it's visible and quiet.
- tsup options beyond: one CJS file, `vscode` external, protocol and CLI code bundled.
