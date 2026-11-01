# config.json

`config.json` holds your computer's Nitpilot settings. `nitpilot login` and `nitpilot repos add` write it, and you can edit it by hand.

## Where it lives

`~/.config/nitpilot/config.json`. If `XDG_CONFIG_HOME` is set, it is `$XDG_CONFIG_HOME/nitpilot/config.json`. If `NITPILOT_CONFIG_DIR` is set, the folder is that one.

Nitpilot saves the file so that only you can read it (mode 0600), because it holds your device token.

Every field has a default, so a missing or empty file is valid.

## An example

```json
{
  "server": "https://nitpilot.dev",
  "token": "nit_…",
  "agent": "claude-code",
  "concurrency": 1,
  "jobTimeoutMinutes": 15,
  "apiBilling": false,
  "repos": {
    "octo/sandbox": {
      "path": "/Users/me/code/sandbox",
      "setup": ["npm", "ci"],
      "checks": { "test": ["npm", "test"], "lint": ["npm", "run", "lint"] }
    }
  }
}
```

## The fields

| Field | Type | Default | Written by |
| --- | --- | --- | --- |
| `server` | text | `https://nitpilot.dev` | you, for another server; `nitpilot login` keeps it |
| `token` | text starting with `nit_` | none | `nitpilot login` |
| `agent` | `claude-code`, `copilot`, `codex` or `gemini-cli` | `claude-code` | you |
| `model` | text | none: the agent's default | you |
| `concurrency` | whole number, 1 to 4 | `1` | you |
| `jobTimeoutMinutes` | whole number, 1 to 120 | `15` | you |
| `apiBilling` | true or false | `false` | you |
| `repos` | one entry per repo | none | `nitpilot repos add` |

- **`server`** is the address of the Nitpilot server. It must start with `https://`. `http://` is accepted only for a server on your own computer, because http would send your token in the clear. It can't have a `?query` or `#fragment`.
- **`token`** is your device's token, from `nitpilot login`.
- **`agent`** picks the coding agent that runs your jobs. See [Use GitHub Copilot CLI](/docs/copilot-cli); `codex` runs OpenAI Codex CLI (`codex login` first); `gemini-cli` runs Gemini CLI, which needs `apiBilling`.
- **`model`** picks the model in the agent's own naming, such as `claude-sonnet-5.5`. Without it the agent uses its default.
- **`concurrency`** is how many jobs run at once on this computer.
- **`jobTimeoutMinutes`** is how long one job may run before it times out.
- **`apiBilling`** lets your agent bill your own API account. For Claude Code, on means it may use your `ANTHROPIC_API_KEY` instead of your Claude login. For Gemini CLI it must be on: Google doesn't let its login work with Nitpilot, so the agent uses your `GEMINI_API_KEY` (a [Google AI Studio](https://aistudio.google.com/apikey) key) and the runs are billed to that key's account (the free tier works, but each model has its own daily allowance: the default `gemini-3.8-flash` allows only 20 requests a day, so set `"model": "gemini-3.5-flash-lite"`). Off, neither key ever reaches the agent. Set the key in your shell profile, never in this file.

### Each entry in `repos`

The key is the repo as `owner/name`. `nitpilot repos add` sets `path`, and keeps the other two if they are there.

- **`path`** (required): the local clone.
- **`setup`** (optional): a command to prepare a fresh checkout, such as `["npm", "ci"]`. It is written as a list: the program, then its arguments. Nitpilot runs it before an agent starts fixing review points, not the agent.
- **`checks`** (optional): the commands the agent is allowed to run, by name, such as `{ "test": ["npm", "test"] }`. Each is a list like `setup`, and not empty. The agent can ask for a check by its name, and nothing else.

## Environment variables

Two variables override the file, one field at a time, without being written to it:

- `NITPILOT_SERVER` for `server`
- `NITPILOT_TOKEN` for `token`

## Settings that moved to the web app

Older versions kept `auto` and `dailyJobCap` here. They live on the server now, in [Settings](/docs/settings). A file that still has them works: they are ignored, and dropped the next time Nitpilot saves the file. `nitpilot doctor` warns about them.

## When the file is wrong

A misspelled name is an error, not a setting silently ignored. The message names the problem:

- `Unknown setting "agnet" in <path> (or NITPILOT_SERVER / NITPILOT_TOKEN). Check the spelling.`
- `Invalid setting "<name>" in <path> (or NITPILOT_SERVER / NITPILOT_TOKEN): <reason>`
- `<path> is not valid JSON: <reason>`
- `<path> must hold a JSON object.`
- `The server address must start with https:// (http is only for a server on this computer).`

`nitpilot doctor` shows the same message on its **Config** line.
