import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentJobBundle, PublishBundle } from '@nitpilot/protocol';
import { publishBundle } from '@nitpilot/protocol/test-samples';
import { describe, expect, it, vi } from 'vitest';
import { CANARY_HOOK, overSsh, prRepo } from '../../test/git-fixtures';
import { tempDir } from '../../test/temp';
import type { JobIo } from '../daemon';
import { draftRef } from './draft';
import { JobFailure } from './job-failure';
import { publishDraft } from './publish';
import { commitAndPush } from './push';
import { emptyHooksDir } from './safe-git';
import { SCRUB_PATHS } from './scrub';
import { prepareWorktree } from './worktree';

type Pr = ReturnType<typeof prRepo>;

/** Where the PR's branch points on the "GitHub" repo. */
const branchOf = (pr: Pr) => pr.git(pr.base, 'rev-parse', `refs/heads/${pr.bundle.git.headBranch}`);
/** Where the draft ref points in the clone, or '' when it's gone. */
const draftOf = (pr: Pr, jobId = 'job_1') => pr.git(pr.clone, 'for-each-ref', '--format=%(objectname)', draftRef(jobId));

/**
 * An author's address job that ran with Auto off, the real way: a worktree, the agent's edit, and the draft commit
 * at refs/nitpilot/drafts/job_1 in the clone. Then the publish job that sends it, and the env that reaches "GitHub".
 */
async function drafted(pr: Pr) {
  const env = overSsh(pr);
  const address: AgentJobBundle = { ...pr.bundle, type: 'address', apply: 'draft', you: { login: 'maya', role: 'author' } };
  const configDir = tempDir();
  const worktree = await prepareWorktree(address, pr.clone, { configDir, hooksDir: emptyHooksDir(configDir), scrubPaths: SCRUB_PATHS, env });
  writeFileSync(join(worktree.dir, 'src/orders.ts'), 'export const pageSize = 25;\n');
  const { draft } = await commitAndPush({ bundle: address, worktree, remote: null, scrubPaths: SCRUB_PATHS, pushing: vi.fn() });
  await worktree.cleanup();
  const bundle: PublishBundle = { ...publishBundle(), git: pr.bundle.git, draft: { jobId: address.jobId, sha: draft!.sha, from: draft!.from } };
  return { bundle, env, sha: draft!.sha };
}

/** What publishDraft gets from the executor, for this PR's clone. */
function contextFor(pr: Pr, env: Record<string, string | undefined>, pushing: JobIo['pushing'] = async () => 'applied') {
  return { clonePath: pr.clone, hooksDir: emptyHooksDir(tempDir()), pushing, signal: new AbortController().signal, env };
}

describe('publishDraft', () => {
  it("pushes the draft to the PR's branch after the server's ack, deletes the draft ref, and reports the push", async () => {
    const pr = prRepo();
    const { bundle, env, sha } = await drafted(pr);
    let branchWhenAsked = '';
    const pushing = vi.fn<JobIo['pushing']>(async () => {
      branchWhenAsked = branchOf(pr);
      return 'applied';
    });
    expect(await publishDraft(bundle, contextFor(pr, env, pushing))).toEqual({ push: { from: pr.headSha, to: sha } });
    expect(pushing).toHaveBeenCalledWith(pr.headSha, sha);
    expect(branchWhenAsked).toBe(pr.headSha); // asked first, pushed after
    expect(branchOf(pr)).toBe(sha);
    expect(draftOf(pr)).toBe('');
  });

  it('completes a retry after a push that landed but whose answer was lost: the ref is gone, nothing is pushed again', async () => {
    const pr = prRepo();
    const { bundle, env, sha } = await drafted(pr);
    await publishDraft(bundle, contextFor(pr, env)); // attempt 1 pushed and deleted the ref; then the CLI died before the server's ack
    expect(draftOf(pr)).toBe('');
    const before = pr.git(pr.base, 'rev-list', '--count', `refs/heads/${pr.bundle.git.headBranch}`);
    const pushing = vi.fn<JobIo['pushing']>(async () => 'applied');
    expect(await publishDraft({ ...bundle, attempt: 2 }, contextFor(pr, env, pushing))).toEqual({ push: { from: pr.headSha, to: sha } });
    expect(pushing).toHaveBeenCalledWith(pr.headSha, sha); // the server still hears about it first, for this attempt
    expect(branchOf(pr)).toBe(sha);
    expect(pr.git(pr.base, 'rev-list', '--count', `refs/heads/${pr.bundle.git.headBranch}`)).toBe(before); // no extra commit
  });

  it('completes a retry after a push that landed before the ref was deleted: the push changes nothing, and the ref goes', async () => {
    const pr = prRepo();
    const { bundle, env, sha } = await drafted(pr);
    pr.git(pr.clone, 'push', '-q', pr.base, `${draftRef('job_1')}:refs/heads/${pr.bundle.git.headBranch}`); // attempt 1 got this far
    const before = pr.git(pr.base, 'rev-list', '--count', `refs/heads/${pr.bundle.git.headBranch}`);
    expect(await publishDraft({ ...bundle, attempt: 2 }, contextFor(pr, env))).toEqual({ push: { from: pr.headSha, to: sha } });
    expect(branchOf(pr)).toBe(sha);
    expect(pr.git(pr.base, 'rev-list', '--count', `refs/heads/${pr.bundle.git.headBranch}`)).toBe(before);
    expect(draftOf(pr)).toBe('');
  });

  it('answers stale_head on a retry whose server moved on, even when the push had landed', async () => {
    const pr = prRepo();
    const { bundle, env } = await drafted(pr);
    await publishDraft(bundle, contextFor(pr, env));
    const failed = await publishDraft({ ...bundle, attempt: 2 }, contextFor(pr, env, async () => 'stale')).catch((err: unknown) => err);
    expect(failed).toMatchObject({ reason: 'stale_head', retryable: true });
  });

  it("never runs the clone's hooks", async () => {
    const pr = prRepo();
    const { bundle, env } = await drafted(pr);
    pr.write(join(pr.clone, '.git/hooks'), { 'pre-push': CANARY_HOOK, 'reference-transaction': CANARY_HOOK });
    await publishDraft(bundle, contextFor(pr, env));
    expect(existsSync(join(pr.home, 'hook-ran'))).toBe(false);
  });

  it('fails with setup_failed, not retryable, and pushes nothing, when the draft ref is gone (Review Focus 4)', async () => {
    const pr = prRepo();
    const { bundle, env } = await drafted(pr);
    pr.git(pr.clone, 'update-ref', '-d', draftRef('job_1')); // re-cloned, or cleaned up by hand
    const pushing = vi.fn<JobIo['pushing']>(async () => 'applied');
    const failed = await publishDraft(bundle, contextFor(pr, env, pushing)).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(JobFailure);
    expect(failed).toMatchObject({ reason: 'setup_failed', retryable: false, message: expect.stringContaining("isn't on this computer any more") });
    expect(pushing).not.toHaveBeenCalled();
    expect(branchOf(pr)).toBe(pr.headSha);
  });

  it('fails with setup_failed, not retryable, and pushes nothing, when the draft ref points at another commit (Review Focus 4)', async () => {
    const pr = prRepo();
    const { bundle, env } = await drafted(pr);
    pr.git(pr.clone, 'update-ref', draftRef('job_1'), pr.headSha);
    const pushing = vi.fn<JobIo['pushing']>(async () => 'applied');
    const failed = await publishDraft(bundle, contextFor(pr, env, pushing)).catch((err: unknown) => err);
    expect(failed).toMatchObject({ reason: 'setup_failed', retryable: false });
    expect(pushing).not.toHaveBeenCalled();
    expect(branchOf(pr)).toBe(pr.headSha);
    expect(draftOf(pr)).toBe(pr.headSha); // not ours to delete: it isn't the draft
  });

  it('fails with branch_moved when someone pushed since the draft was made, forces nothing, and keeps the draft ref', async () => {
    const pr = prRepo();
    const { bundle, env, sha } = await drafted(pr);
    const human = pr.pushAsHuman({ 'README.md': 'a human was here\n' });
    const failed = await publishDraft(bundle, contextFor(pr, env)).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(JobFailure);
    expect(failed).toMatchObject({ reason: 'branch_moved', retryable: false });
    expect(branchOf(pr)).toBe(human);
    expect(draftOf(pr)).toBe(sha); // you can still look at it until it's pruned
  });

  it('pushes nothing when the server answers stale, and keeps the draft ref', async () => {
    const pr = prRepo();
    const { bundle, env, sha } = await drafted(pr);
    const failed = await publishDraft(bundle, contextFor(pr, env, async () => 'stale')).catch((err: unknown) => err);
    expect(failed).toMatchObject({ reason: 'stale_head', retryable: true });
    expect(branchOf(pr)).toBe(pr.headSha);
    expect(draftOf(pr)).toBe(sha);
  });

  it('fails with git_error, retryable, when git cannot push, and keeps the draft ref', async () => {
    const pr = prRepo();
    const { bundle, env, sha } = await drafted(pr);
    rmSync(pr.base, { recursive: true, force: true }); // "GitHub" can't be reached
    const failed = await publishDraft(bundle, contextFor(pr, env)).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(JobFailure);
    expect(failed).toMatchObject({ reason: 'git_error', retryable: true });
    expect(draftOf(pr)).toBe(sha);
  });

  it('fails early, asking nothing, when there is nowhere to push (a deleted fork)', async () => {
    const pr = prRepo();
    const { bundle, env } = await drafted(pr);
    const pushing = vi.fn<JobIo['pushing']>(async () => 'applied');
    const failed = await publishDraft({ ...bundle, git: { ...bundle.git, headRepoPath: null } }, contextFor(pr, env, pushing)).catch((err: unknown) => err);
    expect(failed).toMatchObject({ reason: 'git_error', retryable: false, message: expect.stringContaining('fork was deleted') });
    expect(pushing).not.toHaveBeenCalled();
  });

  it('fails with setup_failed, retryable, and asks nothing, when the linked clone is not there', async () => {
    const pr = prRepo();
    const { bundle, env } = await drafted(pr);
    const pushing = vi.fn<JobIo['pushing']>(async () => 'applied');
    const gone = { ...contextFor(pr, env, pushing), clonePath: join(pr.root, 'no-such-clone') };
    const failed = await publishDraft(bundle, gone).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(JobFailure);
    expect(failed).toMatchObject({ reason: 'setup_failed', retryable: true });
    expect(pushing).not.toHaveBeenCalled();
    expect(branchOf(pr)).toBe(pr.headSha);
  });

  it('fails with setup_failed, not retryable, and pushes nothing, when the draft ref is gone and there is no remote to ask (a deleted fork)', async () => {
    const pr = prRepo();
    const { bundle, env } = await drafted(pr);
    pr.git(pr.clone, 'update-ref', '-d', draftRef('job_1'));
    const pushing = vi.fn<JobIo['pushing']>(async () => 'applied');
    const noFork = { ...bundle, git: { ...bundle.git, headRepoPath: null } };
    const failed = await publishDraft(noFork, contextFor(pr, env, pushing)).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(JobFailure);
    expect(failed).toMatchObject({ reason: 'setup_failed', retryable: false, message: expect.stringContaining("isn't on this computer any more") });
    expect(pushing).not.toHaveBeenCalled();
    expect(branchOf(pr)).toBe(pr.headSha);
  });

  it('fails with git_error, retryable, and pushes nothing, when the draft ref is gone and the remote cannot be asked', async () => {
    const pr = prRepo();
    const { bundle, env } = await drafted(pr);
    pr.git(pr.clone, 'update-ref', '-d', draftRef('job_1'));
    rmSync(pr.base, { recursive: true, force: true }); // "GitHub" can't be reached, so `git ls-remote` fails
    const pushing = vi.fn<JobIo['pushing']>(async () => 'applied');
    const failed = await publishDraft(bundle, contextFor(pr, env, pushing)).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(JobFailure);
    expect(failed).toMatchObject({ reason: 'git_error', retryable: true });
    expect(pushing).not.toHaveBeenCalled();
  });

  it("refuses a draft job id that can't be a ref name, before any git runs", async () => {
    const pr = prRepo();
    const { bundle, env } = await drafted(pr);
    const failed = await publishDraft({ ...bundle, draft: { ...bundle.draft, jobId: '../heads/main' } }, contextFor(pr, env)).catch((err: unknown) => err);
    expect(failed).toMatchObject({ reason: 'setup_failed', retryable: false });
    expect(branchOf(pr)).toBe(pr.headSha);
  });
});
