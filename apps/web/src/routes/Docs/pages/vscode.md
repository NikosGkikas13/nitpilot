# Use Nitpilot in VS Code

See your PRs and what they need from you without leaving VS Code: a count in the status bar, and a sidebar with each open PR one click from its chat. It also works in Cursor, Windsurf and VSCodium.

## Install

- VS Code: [Nitpilot on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=nitpilot.nitpilot-vscode), or search for "Nitpilot" in the Extensions view.
- Cursor, Windsurf, VSCodium: [Nitpilot on Open VSX](https://open-vsx.org/extension/nitpilot/nitpilot-vscode).

It uses the login of the `nitpilot` CLI, so there's nothing to set up if you've already run `nitpilot login`. If you haven't, click **Log in** in the Nitpilot sidebar: it runs `nitpilot login` in a VS Code terminal. Any CLI version works.

## The status bar

At the bottom left:

| You see | It means |
|---|---|
| `2 need you`, on a warning color | Two PRs wait on you: a decision, a review to start by hand, a failed agent, or drafts to Send or Discard |
| `5 open` | Five open PRs, nothing needs you |
| `Nitpilot` with a check | No open PRs |
| `Nitpilot: log in` | Not logged in. Click it to log in |
| `Nitpilot: sign in again`, on a warning color | Your GitHub sign-in on Nitpilot expired. Click it to open Nitpilot and sign in again, or your agent can't post in your name |
| `Nitpilot` with a cloud icon | The server can't be reached. Hover for the reason; it keeps trying |

The counts are the same as `nitpilot status --line` shows in [Claude Code](/docs/claude-code). Click the item to open the sidebar.

## The sidebar

The Nitpilot icon in the activity bar opens **Pull requests**: the PRs that need you first, then the rest. Each one says what it needs (`a decision`, `start review`, `agent failed`, `drafts`), or its phase and round.

- **Click a PR** to open its chat on Nitpilot. Decisions and drafts are made there.
- **Right-click** for **Open PR on GitHub**, and on a failed PR, **Retry agent**: it queues your agent again, like `nitpilot retry`. It runs on a device where `nitpilot start` is running.
- **Refresh** is at the top of the view.

## How fresh it is

It asks the server every 30 seconds while the VS Code window is focused, and right away when you switch back to it. Background windows don't ask at all. If the server can't be reached, the last list stays, marked with the time it's from.

## Troubleshooting

- **"Log in" doesn't work:** the `nitpilot` command isn't installed. Run `npm install -g nitpilot`, then **Log in** again.
- **Behind a company proxy:** the extension may not reach the server if your proxy is only set in VS Code's settings. Not tested yet; [open an issue](https://github.com/NikosGkikas13/nitpilot/issues) if it happens to you.
- **Another server:** it uses the server you logged in to with the CLI (`server` in `config.json`, or `NITPILOT_SERVER`). See [config.json](/docs/config-json).
