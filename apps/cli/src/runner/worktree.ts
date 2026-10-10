import { chmodSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
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
  checkBundle(bundle);
  const key = `${bundle.jobId}-${bundle.attempt}`;
  const headRef = `${BRAND.gitRefNamespace}/${key}/head`;
  const baseRef = `${BRAND.gitRefNamespace}/${key}/base`;
  const dir = join(opts.configDir, 'worktrees', ...bundle.pr.repoFullName.split('/'), `${bundle.pr.number}-${bundle.you.role}-${key}`);
  let repo: GitPlace | null = null;
  let dirIsOurs = false; // set just before `worktree add`: until then `dir` isn't ours to delete
  try {
    repo = { gitDir: cloneGitDir(repoPath), hooksDir: opts.hooksDir, signal: opts.signal, env: opts.env };
    // The PR's ref lives on the base repo, forks included. Fetch through the clone's own remote for it when
    // there is one (your credentials, your SSH setup), else from its public URL.
    const remotes = (await safeGit(repo, ['remote', '-v'])).stdout;
    const source = remoteFor(remotes, bundle.pr.repoFullName, 'fetch') ?? bundle.git.baseCloneUrl;
    // `--refmap=` and `--no-write-fetch-head`: a fetch through a remote would otherwise move your `origin/<base>` and write FETCH_HEAD.
    // `--`: whatever `source` is, git reads it as a repository, never as an option.
    await safeGit(repo, [
      'fetch', '--no-tags', '--no-recurse-submodules', '--refmap=', '--no-write-fetch-head', '--',
      source, `+${bundle.git.fetchRef}:${headRef}`, `+refs/heads/${bundle.pr.baseRef}:${baseRef}`,
    ]);
    const headSha = await commitOf(repo, headRef);
    if (headSha !== bundle.pr.headSha) {
      throw new JobFailure('stale_head', true, `The PR's head is ${headSha.slice(0, 7)} now, not ${bundle.pr.headSha.slice(0, 7)}.`);
    }
    const baseSha = await commitOf(repo, baseRef);
    if (pathExists(dir)) throw new JobFailure('setup_failed', true, `${dir} is already there, so it isn't safe to check the PR out into it.`);
    mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
    dirIsOurs = true;
    await safeGit(repo, ['worktree', 'add', '--detach', dir, headSha]);
    const git = { ...repo, gitDir: linkedGitDir(dir), workTree: dir };
    await scrub(git, opts.scrubPaths);
    const conventions = await readConventions(repo, baseSha);
    const place = repo;
    return { dir, git, headSha, baseSha, conventions, cleanup: () => removeWorktree(place, dir, [headRef, baseRef]) };
  } catch (err) {
    if (repo) await removeWorktree(repo, dirIsOurs ? dir : null, [headRef, baseRef]);
    if (err instanceof JobFailure) throw err;
    throw new JobFailure('setup_failed', true, `Couldn't check out the PR: ${(err as Error).message}`);
  }
}

/** Letters, digits, `.`, `_` and `-`: what a job id or a repo's owner and name may be made of. */
const FOLDER_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * What the bundle names becomes folders, refs and a git command line, so check it before any git runs:
 * a server bug must never reach outside <config dir>/worktrees, or turn a URL into an option. Not
 * retryable: the same bundle would fail again.
 */
function checkBundle(bundle: JobBundle): void {
  checkFolderNames(bundle);
  checkCloneUrl(bundle);
}

/** The job id and the repo's `owner` and `name` become folder and ref names. */
function checkFolderNames(bundle: JobBundle): void {
  const repoParts = bundle.pr.repoFullName.split('/');
  const names = [bundle.jobId, ...repoParts];
  if (repoParts.length === 2 && names.every((name) => FOLDER_NAME.test(name) && name !== '.' && name !== '..')) return;
  const shown = JSON.stringify({ jobId: bundle.jobId, repo: bundle.pr.repoFullName }).slice(0, 300);
  throw new JobFailure('setup_failed', false, `This job's ids can't be used as folder names: ${shown}`);
}

/**
 * Where git fetches from when the clone has no remote for the repo: an https address, or an absolute path
 * (a local copy; the tests use one). Anything else could be an option (`--upload-pack=…` runs a command)
 * or a transport that runs one (`ext::…`).
 */
function checkCloneUrl(bundle: JobBundle): void {
  const url = bundle.git.baseCloneUrl;
  if (url.startsWith('https://') || url.startsWith('/')) return;
  throw new JobFailure('setup_failed', false, `This job's clone URL isn't an https:// address or an absolute path: ${JSON.stringify(url.slice(0, 200))}`);
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path); // lstat, so a broken link counts as there too
    return true;
  } catch {
    return false;
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

/**
 * Remove a job's worktree, folder and refs, whatever state they're in. Runs even after a cancel. Never throws.
 * `dir` is null when the job never got as far as making its folder: then there is nothing of ours to delete.
 * No `git worktree prune`: it would also forget your own worktrees whose folder is missing (an unplugged drive).
 */
async function removeWorktree(repo: GitPlace, dir: string | null, refs: string[]): Promise<void> {
  const place = { ...repo, signal: undefined };
  if (dir !== null) {
    await safeGit(place, ['worktree', 'remove', '--force', '--force', dir]).catch(() => {}); // twice: a locked worktree goes too
    removeFolder(dir);
  }
  for (const ref of refs) await safeGit(place, ['update-ref', '-d', ref]).catch(() => {});
}

/**
 * Delete a folder and everything in it. A tree with read-only folders (Go's module cache is one) won't go
 * the first time, so make the folders writable and try once more. Never throws: if it still won't go,
 * the next `nitpilot start` tries again.
 */
function removeFolder(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
    return;
  } catch {
    // Probably a read-only folder inside. Fall through.
  }
  makeFoldersWritable(dir);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Give up quietly.
  }
}

/** Let the owner write in `dir` and every real folder below it. Links are never followed. */
function makeFoldersWritable(dir: string): void {
  try {
    const found = lstatSync(dir);
    if (!found.isDirectory()) return;
    chmodSync(dir, found.mode | 0o700);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) makeFoldersWritable(join(dir, entry.name));
    }
  } catch {
    // Not ours to change, or already gone. The delete will say.
  }
}

/**
 * At `nitpilot start`, before any job runs (spec §11 step 8): have each linked clone forget the worktrees
 * a crash left in <config dir>/worktrees, then delete that folder. Only entries inside it are touched, so
 * there is no `git worktree prune`: it would also forget your own worktrees whose folder is missing.
 */
export async function cleanUpWorktrees(opts: { configDir: string; repoPaths: string[]; hooksDir: string; env?: Record<string, string | undefined> }): Promise<void> {
  // Git lists real paths (`/tmp/x` is `/private/tmp/x` on macOS), so compare against the real path of our folder.
  const ours = join(realPathOrSame(opts.configDir), 'worktrees') + sep;
  for (const repoPath of opts.repoPaths) {
    try {
      const place = { gitDir: cloneGitDir(repoPath), hooksDir: opts.hooksDir, env: opts.env };
      const listed = (await safeGit(place, ['worktree', 'list', '--porcelain'])).stdout;
      for (const line of listed.split('\n')) {
        const path = line.startsWith('worktree ') ? line.slice('worktree '.length) : '';
        if (path.startsWith(ours)) await safeGit(place, ['worktree', 'remove', '--force', '--force', path]).catch(() => {});
      }
    } catch {
      // A clone that's gone or broken: `nitpilot doctor` reports it, and its jobs fail with setup_failed.
    }
  }
  removeFolder(join(opts.configDir, 'worktrees'));
}

function realPathOrSame(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
