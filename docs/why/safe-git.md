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
- `GIT_DIR` and `GIT_WORK_TREE` are set explicitly, so git never searches for a repo by walking up folders.
- **An allowlisted environment:** git gets `PATH`, `HOME`, your SSH agent and a few more (`ENV_ALLOWLIST`), never the tokens in your shell (`GITHUB_TOKEN`, `AWS_*`, …).
- **No prompts:** `GIT_TERMINAL_PROMPT=0`, and `ssh -o BatchMode=yes` unless you set your own `GIT_SSH_COMMAND`, make git fail instead of waiting for a password nobody will type.
- **The `.git` link is checked.** A worktree's `.git` is a one-line file saying where its git data lives (docs/why/git-worktrees.md). An agent that can edit files could rewrite it, so `safeGit()` refuses to run in a worktree whose link changed. It also refuses a real clone (a `.git` folder): it only works in worktrees the CLI made, which is how your own folder stays untouched.

Arguments still go to `execFile` as a list (docs/why/child-processes.md), so a branch name with `;` or `$(…)` in it is just text.

## The React analogy

`safeGit()` is `<iframe sandbox>` for git: the content still loads (the files check out), but its scripts don't run, its links don't escape, and it can't read the parent page's cookies (your tokens).
