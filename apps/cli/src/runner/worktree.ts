import { lstatSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BRAND, type JobBundle } from '@nitpilot/protocol';
import { remoteFor } from '../git/remotes';
import { JobFailure } from './job-failure';
import { linkedGitDir, safeGit, type GitPlace } from './safe-git';
import { scrub } from './scrub';

/** Where repos keep conventions for agents. Read from the base branch, so a PR can't rewrite its own rules (spec §11 step 3). */
const CONVENTION_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

/** A job's own checkout of the PR (spec §11 steps 1–3). */
export type Worktree = {
  /** The folder the agent works in. */
  dir: string;
  /** Where git commands for this worktree run (safeGit). */
  git: GitPlace & { workTree: string };
  /** The PR head it's checked out at. */
  headSha: string;
  /** The tip of the PR's base branch, fetched with it (for diffs and conventions). */
  baseSha: string;
  /** The repo's conventions from the base branch, by file name (`CLAUDE.md`, …). */
  conventions: Record<string, string>;
  /** Remove the worktree, its folder and the job's refs. Never throws. */
  cleanup(): Promise<void>;
};

export type PrepareOptions = {
  configDir: string;
  hooksDir: string;
  /** What to scrub: the agent adapter's list (SCRUB_PATHS covers every agent). */
  scrubPaths: readonly string[];
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
};

/**
 * Check the PR out for one job, without touching the person's own folder (spec §11 steps 1–3):
 * fetch the PR's head and base into the job's refs, refuse a head that moved (`stale_head`), add a
 * detached worktree under <config dir>/worktrees, scrub agent files, and read the conventions from
 * the base branch. Anything else that goes wrong is `setup_failed`. See docs/why/git-worktrees.md.
 */
export async function prepareWorktree(bundle: JobBundle, repoPath: string, opts: PrepareOptions): Promise<Worktree> {
  const key = `${bundle.jobId}-${bundle.attempt}`;
  const headRef = `${BRAND.gitRefNamespace}/${key}/head`;
  const baseRef = `${BRAND.gitRefNamespace}/${key}/base`;
  const dir = join(opts.configDir, 'worktrees', ...bundle.pr.repoFullName.split('/'), `${bundle.pr.number}-${bundle.you.role}-${key}`);
  let repo: GitPlace | null = null;
  try {
    repo = { gitDir: cloneGitDir(repoPath), hooksDir: opts.hooksDir, signal: opts.signal, env: opts.env };
    // The PR's ref lives on the base repo, forks included. Fetch through the clone's own remote for it when
    // there is one (your credentials, your SSH setup), else from its public URL.
    const remotes = (await safeGit(repo, ['remote', '-v'])).stdout;
    const source = remoteFor(remotes, bundle.pr.repoFullName, 'fetch') ?? bundle.git.baseCloneUrl;
    await safeGit(repo, ['fetch', '--no-tags', '--no-recurse-submodules', source, `+${bundle.git.fetchRef}:${headRef}`, `+refs/heads/${bundle.pr.baseRef}:${baseRef}`]);
    const headSha = await commitOf(repo, headRef);
    if (headSha !== bundle.pr.headSha) {
      throw new JobFailure('stale_head', true, `The PR's head is ${headSha.slice(0, 7)} now, not ${bundle.pr.headSha.slice(0, 7)}.`);
    }
    const baseSha = await commitOf(repo, baseRef);
    mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
    await safeGit(repo, ['worktree', 'add', '--detach', dir, headSha]);
    const git = { ...repo, gitDir: linkedGitDir(dir), workTree: dir };
    await scrub(git, opts.scrubPaths);
    const conventions = await readConventions(repo, baseSha);
    const place = repo;
    return { dir, git, headSha, baseSha, conventions, cleanup: () => removeWorktree(place, dir, [headRef, baseRef]) };
  } catch (err) {
    if (repo) await removeWorktree(repo, dir, [headRef, baseRef]);
    if (err instanceof JobFailure) throw err;
    throw new JobFailure('setup_failed', true, `Couldn't check out the PR: ${(err as Error).message}`);
  }
}

/** The git directory of the person's clone: its `.git` folder, or the one its `.git` file names (a clone that is itself a worktree). */
export function cloneGitDir(repoPath: string): string {
  let isFolder: boolean;
  try {
    isFolder = lstatSync(join(repoPath, '.git')).isDirectory();
  } catch {
    throw new Error(`${repoPath} is not a git clone anymore. Run \`${BRAND.cli} doctor\`.`);
  }
  return isFolder ? join(repoPath, '.git') : linkedGitDir(repoPath);
}

async function commitOf(repo: GitPlace, ref: string): Promise<string> {
  return (await safeGit(repo, ['rev-parse', '--verify', `${ref}^{commit}`])).stdout.trim();
}

/** The convention files the base commit has, by name. Read with `git show`, never from the worktree. */
async function readConventions(repo: GitPlace, baseSha: string): Promise<Record<string, string>> {
  const found = (await safeGit(repo, ['ls-tree', '-z', '--name-only', baseSha, ...CONVENTION_FILES])).stdout.split('\0').filter(Boolean);
  const conventions: Record<string, string> = {};
  for (const file of found) conventions[file] = (await safeGit(repo, ['show', `${baseSha}:${file}`])).stdout;
  return conventions;
}

/** Remove a job's worktree, folder and refs, whatever state they're in. Runs even after a cancel. Never throws. */
async function removeWorktree(repo: GitPlace, dir: string, refs: string[]): Promise<void> {
  const place = { ...repo, signal: undefined };
  await safeGit(place, ['worktree', 'remove', '--force', dir]).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
  await safeGit(place, ['worktree', 'prune']).catch(() => {});
  for (const ref of refs) await safeGit(place, ['update-ref', '-d', ref]).catch(() => {});
}

/**
 * At `nitpilot start`, before any job runs (spec §11 step 8): delete the worktrees a crash left in
 * <config dir>/worktrees, and let each linked clone forget them (`git worktree prune`).
 */
export async function cleanUpWorktrees(opts: { configDir: string; repoPaths: string[]; hooksDir: string; env?: Record<string, string | undefined> }): Promise<void> {
  rmSync(join(opts.configDir, 'worktrees'), { recursive: true, force: true });
  for (const repoPath of opts.repoPaths) {
    try {
      await safeGit({ gitDir: cloneGitDir(repoPath), hooksDir: opts.hooksDir, env: opts.env }, ['worktree', 'prune']);
    } catch {
      // A clone that's gone or broken: `nitpilot doctor` reports it, and its jobs fail with setup_failed.
    }
  }
}
