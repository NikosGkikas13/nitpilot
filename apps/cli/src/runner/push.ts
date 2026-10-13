import { BRAND, type JobBundle, type PushInfo } from '@nitpilot/protocol';
import type { JobIo } from '../daemon';
import { remoteFor } from '../git/remotes';
import { JobFailure } from './job-failure';
import { safeGit, SafeGitError, type GitPlace } from './safe-git';
import { scrubPlan } from './scrub';
import type { Worktree } from './worktree';

export type PushContext = {
  bundle: JobBundle;
  worktree: Pick<Worktree, 'git' | 'headSha'>;
  /** Where the PR's branch lives: a remote name (pushTarget) or a URL. Null for a draft, which never pushes. */
  remote: string | null;
  /** The list prepareWorktree scrubbed with. Files matching it stay out of the commit, even ones the agent created. */
  scrubPaths: readonly string[];
  /**
   * Ask the server before pushing (JobIo.pushing). Push only on 'applied'. If it rejects (the socket
   * closed, the daemon stopped), that error is passed on as it is: the daemon reports it as a retryable `crash`.
   */
  pushing: JobIo['pushing'];
};

/**
 * Where an address job will push: the clone's remote for the PR's head repo (the author's fork, or
 * the repo itself). The executor asks before the agent runs, so a deleted fork or a missing remote
 * fails early with a clear reason, not after the work (spec §11 step 6).
 */
export async function pushTarget(bundle: JobBundle, place: GitPlace): Promise<string> {
  return pickPushRemote((await safeGit(place, ['remote', '-v'])).stdout, bundle.git.headRepoPath);
}

export function pickPushRemote(remoteList: string, headRepoPath: string | null): string {
  if (headRepoPath === null) throw new JobFailure('git_error', false, "The PR's fork was deleted, so there is nowhere to push fixes.");
  const remote = remoteFor(remoteList, headRepoPath, 'push');
  if (remote) return remote;
  throw new JobFailure('git_error', false, `No remote in your clone points at ${headRepoPath}. Add one (git remote add <name> <url>), then run \`${BRAND.cli} retry\`.`);
}

/**
 * Commit what the agent changed and push it to the PR's branch (spec §11 step 6): your own git
 * identity, a `Nitpilot-Job` trailer, no hooks, and only after the server acked `job.pushing`. Never
 * forced: if someone pushed meanwhile, git refuses and the job fails with `branch_moved`. In draft
 * mode the commit stays on refs/nitpilot/drafts/<job> and nothing is pushed. See docs/why/safe-git.md.
 */
export async function commitAndPush(ctx: PushContext): Promise<{ push: PushInfo | null }> {
  try {
    return await commitThenPush(ctx);
  } catch (err) {
    // Only git's own failure is a `git_error`. A JobFailure is already the right answer, and anything else
    // (`pushing()` rejecting) goes up unchanged so the daemon reports what really happened.
    if (err instanceof SafeGitError) throw new JobFailure('git_error', true, err.message);
    throw err;
  }
}

async function commitThenPush({ bundle, worktree, remote, scrubPaths, pushing }: PushContext): Promise<{ push: PushInfo | null }> {
  const git = (args: string[]) => safeGit(worktree.git, args);
  // Repo code runs in the worktree (setup, checks like `npm test`) and could commit by itself. Those
  // commits would be pushed without the trailer, or dropped as "no change", so stop. A rerun would run the same code.
  const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  if (head !== worktree.headSha) {
    throw new JobFailure('git_error', false, `Something other than ${BRAND.name} committed in the job's worktree (HEAD is ${head.slice(0, 7)}, not ${worktree.headSha.slice(0, 7)}), so nothing was pushed. Look at what ran there.`);
  }
  if ((await git(['status', '--porcelain'])).stdout === '') return { push: null }; // the agent changed nothing
  await git(['add', '-A']);
  await unstageAgentFiles(worktree.git, scrubPaths);
  if ((await git(['diff', '--cached', '--name-only', '-z'])).stdout === '') return { push: null }; // only agent files changed
  await git(['commit', '-q', '--no-verify', '-m', `Address review feedback (round ${bundle.round})`, '--trailer', `${BRAND.commitTrailer}: ${bundle.jobId}`]);
  const to = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  if (bundle.apply === 'draft') {
    await git(['update-ref', `${BRAND.gitRefNamespace}/drafts/${bundle.jobId}`, to]);
    return { push: null };
  }
  // The executor asks pushTarget before the agent runs, so an auto job always has a remote. Not having one is a bug.
  if (remote === null) throw new Error('An address job that pushes needs a remote (pushTarget).');
  if ((await pushing(worktree.headSha, to)) === 'stale') {
    throw new JobFailure('stale_head', true, 'The server moved on before the push, so nothing was pushed.');
  }
  try {
    // `--`: whatever `remote` is, git reads it as a repository, never as an option.
    await git(['push', '--porcelain', '--no-verify', '--', remote, `HEAD:refs/heads/${bundle.git.headBranch}`]);
  } catch (err) {
    if (err instanceof SafeGitError && rejectedBecauseMoved(err.stdout)) {
      throw new JobFailure('branch_moved', true, `Someone pushed to ${bundle.git.headBranch} while the agent worked. Nothing was forced.`);
    }
    throw err;
  }
  return { push: { from: worktree.headSha, to } };
}

/**
 * `git add -A` skips the scrubbed files the PR already had (they're skip-worktree), but not a file the
 * agent created (a new `.claude/settings.local.json` or `.env`), nor one repo code un-hid with
 * `git update-index --no-skip-worktree`. So after the add, put every staged scrubbed path back to the
 * PR head's version: a new file leaves the index, a changed or deleted one is restored. The files on
 * disk are left alone.
 */
async function unstageAgentFiles(place: GitPlace, scrubPaths: readonly string[]): Promise<void> {
  const staged = (await safeGit(place, ['diff', '--cached', '--name-only', '--no-renames', '-z'])).stdout.split('\0').filter(Boolean);
  const { hide } = scrubPlan(staged, scrubPaths);
  // `:(literal)`: a file name with `*` or `[` in it is a name, not a pattern.
  if (hide.length > 0) await safeGit(place, ['reset', '-q', '--', ...hide.map((path) => `:(literal)${path}`)]);
}

/** `git push --porcelain` marks a refused ref with `!`. "fetch first" and "non-fast-forward" mean the branch has commits we don't. */
function rejectedBecauseMoved(porcelain: string): boolean {
  return /^!\t.*\[rejected\] \((fetch first|non-fast-forward)\)/m.test(porcelain);
}
