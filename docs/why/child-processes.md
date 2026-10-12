# Running other programs (child processes)

**In one sentence:** the CLI sometimes starts another program (`git`, `osascript`, `open`), waits for it and reads its answer, and it always passes arguments as a list, never as a shell command string, so nothing a PR title says can run as a command.

## What a child process is

Node can start any program installed on your machine, the way you type `git status` in a terminal. That program is a *child process*. Node waits, and when it ends Node gets back what it printed (`stdout`), what it complained about (`stderr`) and an *exit code*.

## `execFile` with a list, never a shell string

`execFile('git', ['-C', path, 'remote', '-v'])` starts `git` with exactly those four arguments. The other way, ``exec(`git -C "${path}" remote -v`)``, hands one string to a *shell* (`sh`), which cuts it up and *interprets* it: `"`, `;` and `$(…)` all mean something to it. A branch name or PR title containing `"; rm -rf ~; "` would become a second command. With a list there is no shell, so those characters stay plain text. That's why Nitpilot never builds a shell string, even for a desktop notification.

## Exit codes

- `0`: it worked.
- Any other number: it ran and failed. `git` exits with `128` for a folder that isn't a clone, and says why on `stderr`.
- No number (`null` in our `RunResult`): it never ran or didn't finish. Usually `ENOENT` (the program isn't installed), or it was killed by a timeout.

## Timeouts

A program can hang forever (a password prompt, a dead network). `execFile` takes a `timeout` and kills the program after that long. `nitpilot doctor` gives every check 10 s (`CHECK_TIMEOUT_MS`), so one stuck check can't freeze the report.

## Where it's used

- `apps/cli/src/git/remotes.ts`: `git rev-parse` and `git remote -v`, to link a clone to its GitHub repo.
- `apps/cli/src/notify-os.ts`: `osascript` / `notify-send` for desktop notifications.
- `apps/cli/src/commands/login.ts`: `open` / `xdg-open` to show the browser page.
- `apps/cli/src/commands/doctor.ts`: `runProgram`, which never throws and turns every outcome into `{ code, stdout, stderr }`.

Git that runs on PR code goes through `safeGit()` (`apps/cli/src/runner/safe-git.ts`), which adds safe settings on top: no hooks, no symlinks, no prompts (docs/why/safe-git.md). Agents never get a shell at all.

## Process groups: stopping everything a check started

A check like `npm test` starts programs of its own: the test runner, maybe a test server. Killing `npm` alone would leave those running. So `run_check` (`apps/cli/src/mcp/tools/run-check.ts`) starts each check with `spawn(…, { detached: true })`, which puts it in a new *process group*, and stops it with `process.kill(-pid)`: a negative pid means "the whole group". That happens after 10 minutes (`CHECK_TIMEOUT_MS`), when the job is cancelled, and when the check exits, so a server it left behind goes too. The agent gets the last 4 KB of the output, where the failures are.

A check also gets a short environment (`PATH`, `HOME`, the locale; no tokens), plus `CI=true`, so a test runner runs once instead of waiting in watch mode.

## The React analogy

- A shell string is `innerHTML`; an argument list is `textContent`. One parses what you give it as code, the other only shows it.
- Exit codes are `response.ok`: non-zero is a `500` (it answered, badly); `null` is `fetch` throwing because nothing answered.
- `timeout` is `fetch(url, { signal: AbortSignal.timeout(10_000) })`, which is exactly what doctor uses for its two server checks.
