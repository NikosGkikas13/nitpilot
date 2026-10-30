# Use GitHub Copilot CLI

Nitpilot runs Claude Code by default. It can drive [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) instead, under your own Copilot subscription.

## Set it up

Install it and sign in:

```bash
npm install -g @github/copilot
copilot login
```

Then set `"agent": "copilot"` in `~/.config/nitpilot/config.json`, the file `nitpilot login` writes. An optional `"model"` picks the model in the agent's own naming, such as `"claude-sonnet-5.5"`; without it the agent uses its default.

```json
{
  "agent": "copilot",
  "model": "claude-sonnet-5.5"
}
```

Keep the other fields that `nitpilot login` wrote in the file; just add these two.

Copilot Business and Enterprise users need their admin to leave the Copilot CLI policy on.

## What to know

- **`nitpilot doctor` can't see your Copilot login.** Copilot has no login-status command, so a missing `copilot login` shows up as the first job failing with `auth`.
- **Same safety rules as Claude Code.** The agent gets only Nitpilot's tools, and the files in the PR that Copilot would load by itself (`.copilot/`, and the instructions, agents, skills, prompts and hooks under `.github/`) are deleted first. See [Security](/docs/security).

Why Nitpilot drives Copilot the way it does: [why/copilot-cli.md](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/copilot-cli.md).
