import type { JobResult } from '@nitpilot/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { Dispatcher } from '../../src/chats/dispatch';
import { createDeliveryHandler } from '../../src/ingest/handle';
import { createIngest } from '../../src/ingest/process';
import { prisma } from '../../src/lib/prisma';
import { FakePlatform } from '../../src/platform/fake/fake-platform';
import { createTaskHandlers } from '../../src/tasks/handlers/index';
import type { Notification } from '../../src/tasks/notifier';
import { TaskRunner } from '../../src/tasks/runner';
import { testApp } from '../app';
import { resetDb } from '../db';
import { installationEvent, issueCommentEvent, people, prEvent } from '../fixtures/github';
import { sendWebhook } from '../webhooks';

beforeEach(resetDb);

const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };
const point = (title: string, severity: 'major' | 'nit') => ({ path: 'src/orders/list.ts', line: 48, side: 'RIGHT' as const, severity, category: 'bug' as const, title, body: `${title}.`, snippet: null });

/** The server, wired exactly like main.ts, with GitHub replaced by FakePlatform. */
async function server() {
  const platform = new FakePlatform();
  const sent: Notification[] = [];
  const dispatcher = new Dispatcher();
  const ingest = createIngest(createDeliveryHandler({ platform, dispatch: dispatcher.dispatch }));
  // Run tasks as if a minute had passed, so debounced ones are due.
  const runner = new TaskRunner(createTaskHandlers({ platform, notifier: { notify: async (n) => { sent.push(n); } }, dispatch: dispatcher.dispatch }), { now: () => new Date(Date.now() + 60_000) });
  const app = testApp({ ingest });
  const deliver = async (event: string, payload: unknown) => {
    expect((await sendWebhook(app, event, payload)).status).toBe(202);
    await ingest.idle();
  };
  const maya = await prisma.user.create({ data: { githubId: String(people.maya.id), login: 'maya' } });
  const leo = await prisma.user.create({ data: { githubId: String(people.leo.id), login: 'leo' } });
  await deliver('installation', installationEvent('created'));
  return { platform, sent, dispatcher, runner, deliver, maya, leo };
}

describe('Plan 1a end to end', () => {
  it('takes an agent-to-agent PR from opened to ready with one summary comment, telling only the reviewer', async () => {
    const s = await server();
    await s.deliver('pull_request', prEvent('opened'));
    const chatId = (await prisma.prChat.findFirstOrThrow()).id;

    // Plays the part of Plan 1b's CLI hub: hand the queued job to a CLI, then report its result.
    async function runJob(type: string, result: JobResult, pushTo?: string) {
      const job = await prisma.job.findFirstOrThrow({ where: { chatId, type, status: 'queued' } });
      await prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1, expectedPushSha: pushTo ?? null } });
      if (pushTo) await s.deliver('pull_request', prEvent('synchronize', { before: 'a'.repeat(40), after: pushTo }));
      await s.dispatcher.dispatch(chatId, { type: 'job_completed', jobId: job.id, attempt: 1, result });
      return job;
    }

    await runJob('review', { summary: 'Two issues.', points: [point('`parseOrder` crashes on empty input', 'major'), point('Rename `fetchAll`', 'nit')], decisions: [], replies: [], push: null });
    await runJob(
      'address',
      {
        summary: 'Fixed one, declined one.',
        points: [],
        decisions: [],
        replies: [
          { point: 1, resolution: 'fixed', comment: 'Added the empty check.' },
          { point: 2, resolution: 'declined', comment: 'Kept for API compatibility.' },
        ],
        push: { from: 'a'.repeat(40), to: 'c'.repeat(40) },
      },
      'c'.repeat(40),
    );
    expect(await prisma.job.findFirstOrThrow({ where: { chatId, type: 're_review' } })).toMatchObject({ sinceSha: 'a'.repeat(40), headSha: 'c'.repeat(40) });
    await runJob('re_review', { summary: 'All settled.', points: [], decisions: [{ point: 1, decision: 'resolve', comment: 'Fixed.' }, { point: 2, decision: 'resolve', comment: 'Fair.' }], replies: [], push: null });

    await s.runner.runDue();

    expect((await prisma.prChat.findUniqueOrThrow({ where: { id: chatId } })).phase).toBe('ready');
    const summaries = s.platform.writesFor(ref, 'summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.body).toContain('ready for approval');
    expect(summaries[0]!.body).toContain('fixed in ccccccc');
    // The agents talked in Nitpilot; the PR's review threads stay clean.
    expect(s.platform.writesFor(ref, 'review')).toEqual([]);
    expect(s.platform.writesFor(ref, 'reply')).toEqual([]);
    // Only the reviewer hears about it.
    expect(s.sent.map((n) => [n.kind, n.userIds])).toEqual([['ready', [s.leo.id]]]);
    expect(await prisma.rawEvent.count({ where: { status: { not: 'processed' } } })).toBe(0);
    expect(await prisma.job.count({ where: { chatId } })).toBe(3);

    // The summary comment's own webhook comes back and changes nothing (Review Focus #1).
    await s.deliver('issue_comment', issueCommentEvent('created', { id: 8800, user: people.bot, body: summaries[0]!.body }));
    expect(await prisma.point.count({ where: { chatId } })).toBe(2);
  });

  it("waits for a manual review on an outside contributor's PR and tells the reviewer", async () => {
    const s = await server();
    await s.deliver('pull_request', prEvent('opened', { pull: { author_association: 'FIRST_TIME_CONTRIBUTOR' } }));
    await s.runner.runDue();
    expect(await prisma.job.count()).toBe(0);
    expect(s.sent).toEqual([expect.objectContaining({ kind: 'manual_review', userIds: [s.leo.id] })]);
  });
});
