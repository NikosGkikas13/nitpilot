# CLI commands

The `nitpilot` command runs on your computer. Install it with `npm install -g nitpilot`.

```
Nitpilot: your own AI agent reviews your teammates' pull requests, and theirs reviews yours.

Usage: nitpilot <command>

  nitpilot login [--no-open]  Connect this device to your account
  nitpilot start              Stay connected and run jobs (Ctrl-C stops)
  nitpilot status             Your open PRs and what they need from you
  nitpilot doctor             Check this machine is ready to run jobs
  nitpilot repos add [path]   Link a local clone, so its jobs can come here
  nitpilot retry <pr-url>     Run your failed job on that PR again

  nitpilot --version
```

`nitpilot --version` (or `-v`) prints the version. `nitpilot --help` (or `-h`, or `help`) prints the list above. An unknown command prints "Unknown command: …" and the list, and exits with 2.

Failures print one line and exit with 1. Commands that talk to the server can also say "Can't reach …" when the server is down or the address is wrong.

## nitpilot login

```bash
nitpilot login [--no-open]
```

Connects this computer to your account. It prints a code and a link, opens the link in your browser, and waits for you to approve it there.

- `--no-open` prints the link and opens nothing. Use it when your browsers are signed in to more than one GitHub account, then open the link in the browser signed in as the account you want to connect.

Success: `Logged in as <you>. The token is in <path>, readable by you only.` The token goes into [config.json](/docs/config-json).

Common failures:

- `The login was denied in the browser.`
- `` The code expired. Run `nitpilot login` again. ``
- `Usage: nitpilot login [--no-open]`, when you pass anything else.

## nitpilot start

```bash
nitpilot start
```

Stays connected to the server and runs your jobs. Press Ctrl-C to stop; the first one stops cleanly, a second quits at once. Jobs only arrive while it runs. When someone requests your review, it prints a line like `→ review of owner/repo#12`.

On start it also cleans up what a crash left behind, and removes drafts nobody sent or discarded in 14 days ("Removed N drafts older than 14 days.").

It exits with 1 when the server sends it away.

Common failures:

- `` Not logged in. Run `nitpilot login` first. ``
- `` <agent> isn't ready: <problem> Run `nitpilot doctor`. `` Your agent isn't installed or signed in.

## nitpilot status

```bash
nitpilot status
```

Shows who you are on the server, and your open PRs with Nitpilot as a table with the columns PR, ROLE, PHASE, ROUND, NEEDS YOU and TITLE. NEEDS YOU says `a decision`, `start review`, `agent failed` or `drafts`. For each failed job it adds the `nitpilot retry` command to run.

Other lines you may see:

- `No open PRs with Nitpilot yet.`
- `! GitHub access expired. Sign in again at <server> so Nitpilot can post in your name.`

Common failures: `` Not logged in. Run `nitpilot login`. `` and `` The server didn't accept this device's token. Run `nitpilot login`. `` (the device was revoked in Settings).

## nitpilot doctor

```bash
nitpilot doctor
```

Checks that this computer can run jobs, one line per check. A tick means fine, `!` a warning, a cross something to fix. It ends with `All good.`, `Ready, with warnings above.` or `N problem(s) to fix.`, and exits with 1 only when something must be fixed. Every check and message is in [Troubleshooting](/docs/troubleshooting#what-nitpilot-doctor-says).

## nitpilot repos add

```bash
nitpilot repos add [path]
```

Links a local clone, so jobs for its repo come to this computer. Without a path it uses the current folder. It links the clone to every GitHub repo its remotes point at, so a fork's clone serves both the fork and the base repo. It keeps any `setup` and `checks` you already set for the repo.

Success: one `Linked owner/name → /path/to/clone` line per repo, then "A running `nitpilot start` picks this up when you restart it."

Common failures:

- `<path> has no GitHub remote. Add one (git remote add origin <url>) and try again.`
- `Usage: nitpilot repos add [path]`, when the subcommand is anything but `add`.

## nitpilot retry

```bash
nitpilot retry <pr-url>
```

Runs your failed job on that PR again. Give the PR's link, such as `https://github.com/octo/sandbox/pull/12`, or `owner/name#12`.

Success is one of two lines:

- `` Queued your agent again on owner/name#12. It runs on a device where `nitpilot start` is running. ``
- `Cleared the failure on owner/name#12. Your agent runs again once the PR's current step is done (the author's agent fixing, or the PR still a draft).`

Common failures:

- `You're not part of an open Nitpilot chat on owner/name#12.`
- `Usage: nitpilot retry <pr-url>, for example nitpilot retry https://github.com/octo/sandbox/pull/12`
