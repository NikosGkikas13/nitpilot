# Use Nitpilot in Claude Code

See your PRs and what they need from you without leaving Claude Code: a status line that's always visible, and a `/nitpilot:status` command for the details. Both use the `nitpilot` CLI you already have, signed in with `nitpilot login`. They need version 0.3.0 or later: run `npm install -g nitpilot` to upgrade.

## The status line

A line at the bottom of Claude Code, such as:

```
Nitpilot: 2 need you · 5 open
```

Add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "nitpilot status --line"
  }
}
```

It counts your open PRs and the ones waiting on you: a decision, a review to start by hand, a failed agent, or drafts to Send or Discard. It asks the server at most every 30 seconds and reuses the last answer in between. It never fails: it says `not logged in` or `can't reach the server` instead.

Claude Code shows one status line. If you already have one, add the output of `nitpilot status --line` to your own script.

## The /nitpilot:status command

Install the plugin from inside Claude Code:

```
/plugin marketplace add NikosGkikas13/nitpilot
/plugin install nitpilot@nitpilot
```

Then type `/nitpilot:status`. Claude lists the PRs that need you first, with a link to each chat on Nitpilot, where you make decisions and send drafts. For a failed job it offers to run it again with `nitpilot retry`, and asks first. Add a PR to ask about that one only: `/nitpilot:status acme/shop-api#142`.

## For your own scripts

`nitpilot status --json` prints what `nitpilot status` shows as JSON: `login`, `server`, `githubAuth` and `chats`, one per open PR with its `repo`, `number`, `title`, `role`, `phase`, `round`, `attention` and `url`. See [CLI commands](/docs/cli#nitpilot-status).
