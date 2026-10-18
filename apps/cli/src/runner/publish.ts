import type { PublishBundle, PushInfo } from '@nitpilot/protocol';
import type { JobIo } from '../daemon';
import { draftRef } from './draft';
import { JobFailure } from './job-failure';
import { pushTarget, rejectedBecauseMoved } from './push';
import { safeGit, SafeGitError, type GitPlace } from './safe-git';
import { cloneGitDir } from './worktree';

export type PublishContext = {
  /** The linked clone that holds the draft: the one its address job ran in. */
  clonePath: string;
  hooksDir: string;
  /** Ask the server before pushing (JobIo.pushing). Push only on 'applied'. */
  pushing: JobIo['pushing'];
  /** Stops git when the job is cancelled. */
  signal: AbortSignal;
  env?: Record<string, string | undefined>;
};

/** Letters, digits, `.`, `_` and `-`: what a job id may be made of (the same rule as the worktree's folder names). */
const REF_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * A publish job (spec §11 "Publish jobs"): send an author's draft. No worktree and no agent: the draft commit is
 * already in the clone, at refs/nitpilot/drafts/<draft job>. Check the ref still points at the draft's commit, ask
 * the server (`job.pushing`), push it to the PR's branch without forcing, then delete the ref. See
 * docs/why/drafts-and-publish-jobs.md.
 *
 * The failures the server cares about (spec §9 "Drafts"): a ref that's gone or moved is `setup_failed`, not
 * retryable, and a branch someone pushed to is `branch_moved`; both make the draft out of date. A `stale` ack is
 * `stale_head`, and nothing is pushed. A retry finds an earlier attempt's push and reports it instead of failing:
 * with the ref gone, the remote branch already pointing at the draft counts as pushed.
 */
export async function publishDraft(bundle: PublishBundle, ctx: PublishContext): Promise<{ push: PushInfo }> {
  const { draft } = bundle;
  // The draft job's id becomes part of a ref name: a server bug must never make it name another ref.
  if (!REF_NAME.test(draft.jobId) || draft.jobId === '.' || draft.jobId === '..') {
    throw new JobFailure('setup_failed', false, `This draft's job id can't be a ref name: ${JSON.stringify(draft.jobId.slice(0, 100))}`);
  }
  let place: GitPlace;
  try {
    place = { gitDir: cloneGitDir(ctx.clonePath), hooksDir: ctx.hooksDir, signal: ctx.signal, env: ctx.env };
  } catch (err) {
    // The clone moved or an unplugged drive: it may be back next time, so this one is retryable.
    throw new JobFailure('setup_failed', true, (err as Error).message);
  }
  try {
    return await pushDraft(bundle, place, ctx.pushing);
  } catch (err) {
    // As in commitAndPush: git's own failure is a retryable `git_error`; a JobFailure, or `pushing()` rejecting, goes up as it is.
    if (err instanceof SafeGitError) throw new JobFailure('git_error', true, err.message);
    throw err;
  }
}

async function pushDraft(bundle: PublishBundle, place: GitPlace, pushing: JobIo['pushing']): Promise<{ push: PushInfo }> {
  const { draft } = bundle;
  const ref = draftRef(draft.jobId);
  const found = await commitAt(place, ref);
  if (found !== draft.sha) {
    // A retry after an earlier attempt pushed and deleted the ref, but its answer never reached the server (the
    // CLI stopped first): the branch already is the draft. Tell the server, as for any push, and report that push.
    if (await branchIsAt(bundle, place, draft.sha)) {
      await askServer(pushing, draft);
      return { push: { from: draft.from, to: draft.sha } };
    }
    const where = found === null ? 'is gone' : `points at ${found.slice(0, 7)} now`;
    throw new JobFailure('setup_failed', false, `The drafted commit isn't on this computer any more: ${ref} ${where}, not ${draft.sha.slice(0, 7)}. Nothing was pushed.`);
  }
  // Where it goes, asked before the server is: a deleted fork or a missing remote fails now.
  const remote = await pushTarget(bundle, place);
  await askServer(pushing, draft);
  try {
    // If an earlier attempt already pushed (and stopped before deleting the ref), this push changes nothing and succeeds.
    // `--`: whatever `remote` is, git reads it as a repository, never as an option. Never forced (no `+`, no `--force`).
    await safeGit(place, ['push', '--porcelain', '--no-verify', '--', remote, `${ref}:refs/heads/${bundle.git.headBranch}`]);
  } catch (err) {
    if (err instanceof SafeGitError && rejectedBecauseMoved(err.stdout)) {
      // Not retryable: the same commit would be refused again. The ref stays, so you can still look at the work.
      throw new JobFailure('branch_moved', false, `Someone pushed to ${bundle.git.headBranch} since the draft was made. Nothing was forced.`);
    }
    throw err;
  }
  // Pushed: the draft is on the branch now. Delete the ref only if it still points at the draft, without the job's
  // signal (a cancel can't stop it half-way), and never fail the job over it: the push happened, and
  // `nitpilot start` prunes old drafts anyway.
  await safeGit({ ...place, signal: undefined }, ['update-ref', '-d', ref, draft.sha]).catch(() => {});
  return { push: { from: draft.from, to: draft.sha } };
}

/** `job.pushing` (spec §10): the push counts only on an `applied` ack. `stale` means this attempt isn't the current one. */
async function askServer(pushing: JobIo['pushing'], draft: PublishBundle['draft']): Promise<void> {
  if ((await pushing(draft.from, draft.sha)) === 'stale') {
    throw new JobFailure('stale_head', true, 'The server moved on before the push, so nothing was pushed.');
  }
}

/**
 * Whether the PR's branch on the remote points at `sha` now (`git ls-remote`, through safe git). False when there is
 * nowhere to ask (a deleted fork, no remote for it): then no attempt of ours can have pushed it either.
 */
async function branchIsAt(bundle: PublishBundle, place: GitPlace, sha: string): Promise<boolean> {
  let remote: string;
  try {
    remote = await pushTarget(bundle, place);
  } catch (err) {
    if (err instanceof JobFailure) return false;
    throw err;
  }
  const branch = `refs/heads/${bundle.git.headBranch}`;
  // `--`: the remote is read as a repository, never as an option. Patterns match the end of ref names, so compare whole lines.
  const listed = (await safeGit(place, ['ls-remote', '--', remote, branch])).stdout;
  return listed.split('\n').some((line) => line === `${sha}\t${branch}`);
}

/** The object a ref points at, or null when there's no such ref. */
async function commitAt(place: GitPlace, ref: string): Promise<string | null> {
  try {
    // `--verify --quiet`: exit code 1 and no output when the ref doesn't exist.
    return (await safeGit(place, ['rev-parse', '--verify', '--quiet', ref])).stdout.trim();
  } catch (err) {
    if (err instanceof SafeGitError && err.code === 1) return null;
    throw err;
  }
}
