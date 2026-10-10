import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobBundle } from '@nitpilot/protocol';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { CANARY_HOOK, prRepo } from '../../test/git-fixtures';
import { tempDir } from '../../test/temp';
import type { JobIo } from '../daemon';
import { JobFailure } from './job-failure';
import { commitAndPush, pickPushRemote } from './push';
import { emptyHooksDir } from './safe-git';
import { SCRUB_PATHS } from './scrub';
import { prepareWorktree } from './worktree';

type Pr = ReturnType<typeof prRepo>;

/** Where the PR's branch points on the "GitHub" repo. */
const branchOf = (pr: Pr) => pr.git(pr.base, 'rev-parse', `refs/heads/${pr.bundle.git.headBranch}`);

/** An address job's worktree for a test PR, removed when the test ends. */
async function addressJob(pr: Pr, apply: JobBundle['apply'] = 'auto') {
  const bundle: JobBundle = { ...pr.bundle, type: 'address', apply, you: { login: 'maya', role: 'author' } };
  const configDir = tempDir();
  const worktree = await prepareWorktree(bundle, pr.clone, { configDir, hooksDir: emptyHooksDir(configDir), scrubPaths: SCRUB_PATHS, env: pr.env });
  onTestFinished(() => worktree.cleanup());
  return { bundle, worktree };
}

const applied: JobIo['pushing'] = async () => 'applied';

/** What a call threw. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

describe('commitAndPush', () => {
  it("commits the agent's changes as you, with the job's trailer, and pushes after the server's ack", async () => {
    const pr = prRepo();
    const { bundle, worktree } = await addressJob(pr);
    writeFileSync(join(worktree.dir, 'src/orders.ts'), 'export const pageSize = 25;\n');
    writeFileSync(join(worktree.dir, 'CLAUDE.md'), 'An agent wrote this.\n'); // a scrubbed path that is tracked: never committed
    writeFileSync(join(worktree.dir, '.env'), 'SECRET=1\n'); // scrubbed paths the agent made new: never committed either
    mkdirSync(join(worktree.dir, '.claude'));
    writeFileSync(join(worktree.dir, '.claude/settings.local.json'), '{}\n');
    let branchWhenAsked = '';
    const pushing = vi.fn<JobIo['pushing']>(async () => {
      branchWhenAsked = branchOf(pr);
      return 'applied';
    });

    const { push } = await commitAndPush({ bundle, worktree, remote: pr.base, scrubPaths: SCRUB_PATHS, pushing });
    expect(push).toEqual({ from: pr.headSha, to: branchOf(pr) });
    expect(pushing).toHaveBeenCalledWith(pr.headSha, push!.to);
    expect(branchWhenAsked).toBe(pr.headSha); // asked first, pushed after
    expect(pr.git(pr.base, 'log', '-1', '--format=%an <%ae>%n%B', push!.to)).toBe('Maya Test <maya@example.com>\nAddress review feedback (round 1)\n\nNitpilot-Job: job_1');
    expect(pr.git(pr.base, 'show', '--name-only', '--format=', push!.to)).toBe('src/orders.ts');
  });

  it('pushes nothing, and asks nothing, when the agent changed nothing, or only agent files', async () => {
    const pr = prRepo();
    const { bundle, worktree } = await addressJob(pr);
    const pushing = vi.fn<JobIo['pushing']>();
    expect(await commitAndPush({ bundle, worktree, remote: pr.base, scrubPaths: SCRUB_PATHS, pushing })).toEqual({ push: null });
    writeFileSync(join(worktree.dir, '.mcp.json'), '{}\n'); // the agent's own file: not a change to the PR
    expect(await commitAndPush({ bundle, worktree, remote: pr.base, scrubPaths: SCRUB_PATHS, pushing })).toEqual({ push: null });
    expect(pushing).not.toHaveBeenCalled();
    expect(branchOf(pr)).toBe(pr.headSha);
  });

  it("never runs the repo's hooks, husky's included", async () => {
    const hooks = { '.husky/pre-commit': CANARY_HOOK, '.husky/post-commit': CANARY_HOOK, '.husky/pre-push': CANARY_HOOK, '.husky/reference-transaction': CANARY_HOOK };
    const pr = prRepo({ head: hooks });
    pr.git(pr.clone, 'config', 'core.hooksPath', '.husky');
    const { bundle, worktree } = await addressJob(pr);
    writeFileSync(join(worktree.dir, 'README.md'), 'changed\n');
    await commitAndPush({ bundle, worktree, remote: pr.base, scrubPaths: SCRUB_PATHS, pushing: applied });
    expect(branchOf(pr)).not.toBe(pr.headSha);
    expect(existsSync(join(pr.home, 'hook-ran'))).toBe(false);
  });

  it('fails with branch_moved when someone pushed meanwhile, and forces nothing (Review Focus #2)', async () => {
    const pr = prRepo();
    const { bundle, worktree } = await addressJob(pr);
    const human = pr.pushAsHuman({ 'README.md': 'a human was here\n' });
    writeFileSync(join(worktree.dir, 'src/orders.ts'), 'export const pageSize = 25;\n');
    const failed = await commitAndPush({ bundle, worktree, remote: pr.base, scrubPaths: SCRUB_PATHS, pushing: applied }).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(JobFailure);
    expect(failed).toMatchObject({ reason: 'branch_moved', retryable: true });
    expect(branchOf(pr)).toBe(human);
  });

  it('pushes nothing when the server answers stale', async () => {
    const pr = prRepo();
    const { bundle, worktree } = await addressJob(pr);
    writeFileSync(join(worktree.dir, 'src/orders.ts'), 'export const pageSize = 25;\n');
    const failed = await commitAndPush({ bundle, worktree, remote: pr.base, scrubPaths: SCRUB_PATHS, pushing: async () => 'stale' }).catch((err: unknown) => err);
    expect(failed).toMatchObject({ reason: 'stale_head' });
    expect(branchOf(pr)).toBe(pr.headSha);
  });

  it("fails, and pushes nothing, when repo code committed in the job's worktree", async () => {
    const pr = prRepo();
    const { bundle, worktree } = await addressJob(pr);
    writeFileSync(join(worktree.dir, 'README.md'), 'sneaky\n'); // what a setup command or a rewritten `npm test` could do
    pr.git(worktree.dir, 'add', '-A');
    pr.git(worktree.dir, 'commit', '-q', '--no-verify', '-m', 'sneaky');
    const pushing = vi.fn<JobIo['pushing']>();
    const failed = await commitAndPush({ bundle, worktree, remote: pr.base, scrubPaths: SCRUB_PATHS, pushing }).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(JobFailure);
    expect(failed).toMatchObject({ reason: 'git_error', retryable: false, message: expect.stringContaining('committed in the job') });
    expect(pushing).not.toHaveBeenCalled();
    expect(branchOf(pr)).toBe(pr.headSha);
  });

  it('keeps a draft on refs/nitpilot/drafts/<job>, even after cleanup, and pushes nothing', async () => {
    const pr = prRepo();
    const { bundle, worktree } = await addressJob(pr, 'draft');
    writeFileSync(join(worktree.dir, 'src/orders.ts'), 'export const pageSize = 25;\n');
    const pushing = vi.fn<JobIo['pushing']>();
    expect(await commitAndPush({ bundle, worktree, remote: pr.base, scrubPaths: SCRUB_PATHS, pushing })).toEqual({ push: null });
    await worktree.cleanup();
    expect(pushing).not.toHaveBeenCalled();
    expect(branchOf(pr)).toBe(pr.headSha);
    expect(pr.git(pr.clone, 'show', '--name-only', '--format=', 'refs/nitpilot/drafts/job_1')).toBe('src/orders.ts');
  });
});

describe('pickPushRemote', () => {
  const remotes = [
    'origin\tgit@github.com:maya/shop-api.git (fetch)',
    'origin\tgit@github.com:maya/shop-api.git (push)',
    'upstream\thttps://github.com/acme/shop-api.git (fetch)',
    'upstream\thttps://github.com/acme/shop-api.git (push)',
  ].join('\n');

  it("picks the remote for the PR's head repo, and fails early for a deleted fork or a missing remote", () => {
    expect(pickPushRemote(remotes, 'maya/shop-api')).toBe('origin');
    expect(thrown(() => pickPushRemote(remotes, null))).toMatchObject({ reason: 'git_error', retryable: false, message: expect.stringContaining('fork was deleted') });
    expect(thrown(() => pickPushRemote(remotes, 'octo/other'))).toMatchObject({ reason: 'git_error', retryable: false, message: expect.stringContaining('No remote in your clone points at octo/other') });
  });
});
