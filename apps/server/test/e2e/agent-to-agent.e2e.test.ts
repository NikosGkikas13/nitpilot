import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { prEvent, pull } from '../fixtures/github';
import { startE2e, waitFor, type E2e } from './harness';

const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };

let e2e: E2e;
beforeEach(async () => {
  e2e = await startE2e();
});
afterEach(() => e2e.close());

describe('Plan 1 end to end', () => {
  it("takes a PR from opened to ready between two people's agents: one summary comment, fixes pushed by the author, only the reviewer told", async () => {
    await e2e.startCli('maya');
    await e2e.startCli('leo');
    // GitHub's webhook for the author's push, the way GitHub sends it: after the push, before the result arrives.
    e2e.intercept(async (_conn, msg) => {
      if (msg.t !== 'job.complete' || !msg.d.result.push) return;
      const { from, to } = msg.d.result.push;
      await e2e.deliver('pull_request', prEvent('synchronize', { before: from, after: to, pull: { head: { ...pull().head, sha: to } } }));
    });

    const requested = Date.now();
    await e2e.openPr();
    await waitFor(async () => (await e2e.chat()).jobs.some((j) => j.type === 'review' && j.status !== 'queued'), "leo's review to start", 5_000);
    expect(Date.now() - requested).toBeLessThan(5_000);
    await waitFor(async () => (await e2e.chat()).phase === 'ready', 'the chat to be ready', 60_000);

    const chat = await e2e.chat();
    // One job of each kind, each run once: nothing duplicated.
    expect(chat.jobs.map((j) => [j.type, j.status]).sort()).toEqual([['address', 'done'], ['re_review', 'done'], ['review', 'done']]);
    expect(chat.round).toBeLessThanOrEqual(3);
    // One summary comment, edited as the PR moved on, linking to the transcript; nothing in the review threads.
    await waitFor(() => e2e.platform.writesFor(ref, 'summary')[0]?.body.includes('ready for approval') ?? false, 'the summary to say ready');
    const summaries = e2e.platform.writesFor(ref, 'summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.edits).toBeGreaterThan(0);
    expect(summaries[0]!.body).toContain('/c/octo/sandbox/42');
    expect(e2e.platform.writesFor(ref, 'review')).toEqual([]);
    expect(e2e.platform.writesFor(ref, 'reply')).toEqual([]);
    // The fix is maya's own commit, with the trailer, on top of the PR's head: pushed, never forced.
    const address = chat.jobs.find((j) => j.type === 'address')!;
    expect(e2e.github.branchLog().slice(0, 2)).toEqual([
      { sha: expect.any(String), author: 'maya', job: address.id },
      { sha: e2e.github.headSha, author: 'maya', job: '' },
    ]);
    // Only the reviewer hears about it.
    await waitFor(() => e2e.notified.length > 0, 'a notification');
    expect(e2e.notified.map((n) => [n.kind, n.userIds])).toEqual([['ready', [e2e.users.leo.id]]]);
    expect(await prisma.rawEvent.count({ where: { status: { not: 'processed' } } })).toBe(0);
  });
});
