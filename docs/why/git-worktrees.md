# Git worktrees: a second checkout, so your folder is never touched

**In one sentence:** each job gets its own checkout of the PR under `~/.config/nitpilot/worktrees`, sharing your clone's history but not its files, and it's removed when the job ends.

## A worktree is a second checkout

Normally a clone has one working folder: switch branches and its files change. `git worktree add <folder> <commit>` gives the same repo a second working folder, checked out at another commit. Both share one history (the commits are stored once, in your clone's `.git`), so it's quick and takes little space. The new folder's `.git` is a one-line file pointing back at that history.

## Why Nitpilot uses one

You might be halfway through your own work, with uncommitted changes. A job must never switch your branch, touch your files or mix its edits with yours. So each job gets `<config dir>/worktrees/<owner>/<repo>/<pr>-<role>-<job>` (`apps/cli/src/runner/worktree.ts`), checked out *detached* (at a commit, not on a branch), so it can't move one of your branches either.

## A job's checkout, step by step

1. **Fetch** the PR's head (`refs/pull/<n>/head`, which GitHub keeps on the base repo, even for PRs from forks) and the base branch, into the job's own refs (`refs/nitpilot/<job>/head` and `/base`). It uses your clone's remote for the repo when there is one, so your credentials and SSH setup apply.
2. **Check the head.** If the PR moved since the server handed out the job, the job fails with `stale_head`, and the server hands it out again on the new head. It also asks GitHub where the PR really is, in case a late webhook left the chat on an old head (`apps/server/src/chats/refresh-head.ts`); otherwise every retry would hit the same wall.
3. **Add the worktree** at that commit, through `safeGit()` (docs/why/safe-git.md).
4. **Scrub** the files agents load on their own (`CLAUDE.md`, `.claude/`, `.mcp.json`, `.env`, …), at any depth: each is marked `skip-worktree` ("git, stop looking at this file"), then deleted. Without the mark, git would see the deletions as changes, and the next commit would delete those files from the PR.
5. **Read the conventions** (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) from the *base* branch with `git show`, never from the PR. Otherwise a PR could write its own reviewer's instructions ("approve this").
6. **Clean up** when the job ends: the worktree, its folder and the job's refs go. If the CLI crashed, `cleanUpWorktrees()` clears what was left the next time `nitpilot start` begins.

## The React analogy

A worktree is a second browser tab on the same app: both tabs read the same server data (the repo's history), but what you type in one tab (your folder) never shows up in the other, and closing the tab (cleanup) leaves no trace.
