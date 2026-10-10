# Safe git: running git on code you don't trust

**In one sentence:** every git command the CLI runs on a PR goes through `safeGit()` (`apps/cli/src/runner/safe-git.ts`), which switches off the parts of git that can run programs or reach outside the repo, so checking out a stranger's PR can't do anything to your machine.

## Why git needs guarding

A PR is files someone else wrote. Most of git just copies files around, but a few features *run programs* or *follow links*:

- **Hooks** are scripts git runs at certain moments: before a commit (`pre-commit`), after a checkout (`post-checkout`), before a push. Tools like husky keep them in the repo (`.husky/`) and point git at them with `core.hooksPath=.husky` in your clone's config. That path is relative, so in a checkout of the PR it means the PR's own `.husky/` folder: a PR could ship a hook that runs the moment it's checked out.
- **Symlinks:** a "file" in the PR can be a link to `~/.ssh/id_ed25519`. An agent asked to read it would read your key.
- **fsmonitor** is a setting that names a program git starts to watch files. **Submodules** pull in other repos.

## What `safeGit()` does

- `-c core.hooksPath=<an empty folder>`: settings given on the command line beat the ones in config files, so git looks for hooks in a folder with nothing in it (`<config dir>/no-hooks`, emptied every time). No hook runs, whoever put it where.
- `-c core.symlinks=false`: a symlink checks out as a small text file holding the link's target, never a real link.
- `-c core.fsmonitor=false` and `-c submodule.recurse=false`.
- `GIT_DIR` and `GIT_WORK_TREE` are set explicitly, so git never searches for a repo by walking up folders. When a command has no worktree (`fetch`, `worktree add`), it runs with `--bare`: otherwise git would treat the `.git` folder itself as the project and, say, a `checkout` would write files into it.
- **An allowlisted environment:** git gets `PATH`, `HOME`, your SSH agent and a few more (`ENV_ALLOWLIST`), never the tokens in your shell (`GITHUB_TOKEN`, `AWS_*`, …).
- **No prompts:** `GIT_TERMINAL_PROMPT=0` for git itself, and `-o BatchMode=yes` for ssh, make git fail instead of waiting for a password nobody will type. If your clone says which key to use (`git config core.sshCommand "ssh -i ~/.ssh/id_work"`), `safeGit()` keeps that and adds `-o BatchMode=yes` to it. If you set `GIT_SSH_COMMAND` or `GIT_SSH` yourself, it leaves ssh alone.
- **The `.git` link is checked.** A worktree's `.git` is a one-line file saying where its git data lives (docs/why/git-worktrees.md). An agent that can edit files could rewrite it, so `safeGit()` refuses to run in a worktree whose link changed. It also refuses a real clone (a `.git` folder): it only works in worktrees the CLI made, which is how your own folder stays untouched.

Arguments still go to `execFile` as a list (docs/why/child-processes.md), so a branch name with `;` or `$(…)` in it is just text.

## Committing and pushing (`apps/cli/src/runner/push.ts`)

For an address job, the CLI commits and pushes, never the agent:

1. `git status`: nothing changed means nothing to push.
2. `git add -A` and `git commit --no-verify`, under your own name, with a `Nitpilot-Job: <id>` trailer, so anyone can tell which commits an agent made. Scrubbed files stay out, even if the agent wrote one again. A new one the agent creates (like `.claude/settings.local.json` or `.env`) is dropped from the commit too: it stays on disk, untracked.
3. Before pushing, it sends `job.pushing` and waits for the server's ack. `stale` means the job was cancelled or handed out again meanwhile, so nothing is pushed.
4. `git push` to the PR's branch, never forced. If someone pushed in the meantime, git refuses ("non-fast-forward"): the job fails with `branch_moved`, and the server runs it again on the new head. A teammate's commit is never overwritten.

In draft mode (Auto off, Plan 2) the commit stays on `refs/nitpilot/drafts/<job>` in your clone, and nothing is pushed.

## The React analogy

`safeGit()` is `<iframe sandbox>` for git: the content still loads (the files check out), but its scripts don't run, its links don't escape, and it can't read the parent page's cookies (your tokens).
