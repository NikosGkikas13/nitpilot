import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { prEvent, pull } from '../fixtures/github';
import { startE2e, waitFor, type E2e, type RunningCli } from './harness';

let e2e: E2e;
beforeEach(async () => {
  e2e = await startE2e();
});
afterEach(() => e2e.close());

const jobOf = async (type: string) => (await e2e.chat()).jobs.filter((j) => j.type === type);
/** The job folders a CLI still has on disk. */
const worktreesOf = (cli: RunningCli) => {
  const folder = join(cli.configDir, 'worktrees', ...pull().base.repo.full_name.split('/'));
  return existsSync(folder) ? readdirSync(folder) : [];
};

describe('Plan 1 end to end: when things go differently', () => {
  it('escalates a security point and tells both people', async () => {
    await e2e.startCli('maya');
    await e2e.startCli('leo', 'security.json');
    await e2e.openPr();
    await waitFor(async () => (await e2e.chat()).phase === 'escalated', 'the chat to escalate');
    await waitFor(() => e2e.notified.some((n) => n.kind === 'escalated'), 'the escalation notice');
    expect(e2e.notified.find((n) => n.kind === 'escalated')!.userIds.sort()).toEqual([e2e.users.leo.id, e2e.users.maya.id].sort());
    expect(await jobOf('address')).toEqual([]); // a person decides now, not an agent
  });

  it("keeps the reviewer's job waiting while their CLI is off, and runs it once it's back", async () => {
    await e2e.startCli('maya');
    const leo = await e2e.startCli('leo');
    await leo.stop();
    await e2e.openPr();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect((await jobOf('review')).map((j) => [j.status, j.attempt])).toEqual([['queued', 0]]);
    await e2e.startCli('leo');
    await waitFor(async () => (await jobOf('review'))[0]?.status === 'done', 'the review to finish');
  });

  it("cancels the reviewer's job when the PR is closed mid-run, and the CLI cleans up", async () => {
    await e2e.startCli('maya');
    const leo = await e2e.startCli('leo', 'slow.json');
    await e2e.openPr();
    await waitFor(async () => (await jobOf('review'))[0]?.status === 'running' && worktreesOf(leo).length === 1, 'the review to be running');
    // The folder appears a moment before the agent starts (the CLI still scrubs it and reads the conventions). Give
    // it that moment, so the job ends through the executor's `finally`, where the worktree is removed, and not
    // half-way through checking out, where the checkout cleans up after itself.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await e2e.deliver('pull_request', prEvent('closed', { pull: { state: 'closed', head: { ...pull().head, sha: e2e.github.headSha } } }));
    await waitFor(async () => (await jobOf('review'))[0]?.status === 'cancelled', 'the review to be cancelled');
    expect((await jobOf('review'))[0]!.cancelReason).toBe('pr_closed');
    await waitFor(() => worktreesOf(leo).length === 0, "leo's worktree to be removed", 10_000);
    expect(leo.lines.join('\n')).toContain('pr closed');
  });

  it('starts the fixes over on the new head when a human pushes during the address job, and never forces (Review Focus #2)', async () => {
    await e2e.startCli('maya');
    await e2e.startCli('leo');
    let human = '';
    e2e.intercept(async (_conn, msg) => {
      // Just before maya's CLI pushes its first fix, someone pushes to the branch by hand.
      if (msg.t !== 'job.pushing' || human) return;
      human = e2e.github.pushAsHuman({ 'README.md': 'Shop API, edited by hand\n' });
      await e2e.deliver('pull_request', prEvent('synchronize', { before: e2e.github.headSha, after: human, pull: { head: { ...pull().head, sha: human } } }));
    });
    await e2e.openPr();
    await waitFor(async () => (await e2e.chat()).phase === 'ready', 'the chat to be ready', 60_000);

    const addresses = await jobOf('address');
    expect(addresses.map((j) => [j.status, j.cancelReason]).sort()).toEqual([['cancelled', 'branch_moved'], ['done', null]]);
    const redone = addresses.find((j) => j.status === 'done')!;
    // maya's fix sits on top of the human's commit: nothing was force-pushed away.
    expect(e2e.github.branchLog().slice(0, 3)).toEqual([
      { sha: expect.any(String), author: 'maya', job: redone.id },
      { sha: human, author: 'maya', job: '' },
      { sha: e2e.github.headSha, author: 'maya', job: '' },
    ]);
    expect(await prisma.rawEvent.count({ where: { status: { not: 'processed' } } })).toBe(0);
  });
});
