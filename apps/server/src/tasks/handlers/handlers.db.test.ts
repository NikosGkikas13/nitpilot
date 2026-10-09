import { beforeEach, describe, expect, it } from 'vitest';
import { ghId, makeChat, makeRepo, makeUser, resetDb } from '../../../test/db';
import type { Prisma } from '../../generated/prisma/client';
import { NeedsReauthError } from '../../auth/user-tokens';
import { prRefOf } from '../../chats/refs';
import { summaryMarker } from '../../lib/markers';
import { prisma } from '../../lib/prisma';
import { FakePlatform } from '../../platform/fake/fake-platform';
import type { Notification } from '../notifier';
import { PermanentTaskError } from '../runner';
import { createTaskHandlers } from './index';

beforeEach(resetDb);

async function scene(opts: { authorOnNitpilot: boolean }) {
  const maya = opts.authorOnNitpilot ? await makeUser({ login: 'maya' }) : null;
  const leo = await makeUser({ login: 'leo' });
  const mayaGithubId = maya?.githubId ?? ghId();
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: mayaGithubId });
  await prisma.participant.createMany({
    data: [
      { chatId: chat.id, githubId: mayaGithubId, role: 'author', login: 'maya', userId: maya?.id ?? null },
      { chatId: chat.id, githubId: leo.githubId, role: 'reviewer', login: 'leo', userId: leo.id, requested: true },
    ],
  });
  const platform = new FakePlatform();
  const sent: Notification[] = [];
  const handlers = createTaskHandlers({ platform, notifier: { notify: async (n) => { sent.push(n); } }, dispatch: async () => { throw new Error('not used'); } });
  const ref = prRefOf(await prisma.prChat.findUniqueOrThrow({ where: { id: chat.id }, include: { repo: true } }));
  const point = (number: number, over: Partial<Prisma.PointUncheckedCreateInput> = {}) =>
    prisma.point.create({ data: { chatId: chat.id, number, raisedByGithubId: leo.githubId, origin: 'agent', severity: 'major', category: 'bug', title: `Point ${number}`, body: 'Explanation.', round: 1, path: 'src/a.ts', line: 10, side: 'RIGHT', commitSha: 'a'.repeat(40), ...over } });
  const task = (kind: string, payload: Prisma.InputJsonValue, attempts = 1) => prisma.task.create({ data: { kind, chatId: chat.id, payload, status: 'running', attempts } });
  return { maya, leo, repo, chat, platform, sent, handlers, ref, point, task };
}

describe('summary', () => {
  it('posts one summary, then edits it only when the content changes', async () => {
    const s = await scene({ authorOnNitpilot: true });
    await prisma.prChat.update({ where: { id: s.chat.id }, data: { phase: 'ready', round: 2 } });
    await s.point(1, { status: 'resolved', authorResolution: 'fixed' });
    await prisma.message.create({ data: { chatId: s.chat.id, seq: 1, kind: 'point_reply', pointNumber: 1, body: 'Added the check.', data: { resolution: 'fixed', commit: 'c0ffee1234' } } });

    await s.handlers.summary!(await s.task('summary', {}));
    const [summary] = s.platform.writesFor(s.ref, 'summary');
    expect(summary!.body.startsWith(summaryMarker(s.chat.id))).toBe(true);
    expect(summary!.body).toContain('ready for approval');
    expect(summary!.body).toContain('fixed in c0ffee1');
    const chat = await prisma.prChat.findUniqueOrThrow({ where: { id: s.chat.id } });
    expect(chat.summaryCommentId).toBe(summary!.id);
    expect(await prisma.githubWrite.count({ where: { kind: 'summary', githubId: `issue:${summary!.id}` } })).toBe(1);

    await s.handlers.summary!(await s.task('summary', {}));
    expect(summary!.edits).toBe(0);

    await s.point(2, { title: 'New point' });
    await s.handlers.summary!(await s.task('summary', {}));
    expect(s.platform.writesFor(s.ref, 'summary')).toHaveLength(1);
    expect(summary!.edits).toBe(1);
  });

  it('after a crash, finds the summary it already posted instead of posting another (Review Focus #2)', async () => {
    const s = await scene({ authorOnNitpilot: true });
    await s.point(1);
    await s.platform.upsertSummary(s.ref, `${summaryMarker(s.chat.id)}\nolder version`);
    await s.handlers.summary!(await s.task('summary', {}, 2));
    expect(s.platform.writesFor(s.ref, 'summary')).toHaveLength(1);
  });
});

describe('post_review (single-player reviewer)', () => {
  it("posts the points as one review in leo's name and links each point to its GitHub thread", async () => {
    const s = await scene({ authorOnNitpilot: false });
    await s.point(1);
    await s.point(2, { path: null, line: null, title: 'General: needs tests' });
    await s.handlers.post_review!(await s.task('post_review', { reviewerGithubId: s.leo.githubId, pointNumbers: [1, 2] }));

    const [review] = s.platform.writesFor(s.ref, 'review');
    expect(review!.asUser).toBe(s.leo.id);
    expect(review!.comments).toEqual([expect.objectContaining({ path: 'src/a.ts', line: 10, side: 'RIGHT' })]);
    expect(review!.body).toContain('General: needs tests');
    const p1 = await prisma.point.findFirstOrThrow({ where: { chatId: s.chat.id, number: 1 } });
    expect(p1.githubCommentId).toBe(review!.commentIds[0]);
    expect(p1.githubThreadRootId).toBe(review!.commentIds[0]);
    expect(await prisma.githubWrite.count({ where: { chatId: s.chat.id } })).toBe(2);
  });

  it('falls back to a review without inline comments when GitHub rejects a line', async () => {
    const s = await scene({ authorOnNitpilot: false });
    await s.point(1);
    s.platform.rejectNextInlineReview = true;
    await s.handlers.post_review!(await s.task('post_review', { reviewerGithubId: s.leo.githubId, pointNumbers: [1] }));
    const [review] = s.platform.writesFor(s.ref, 'review');
    expect(review!.comments).toEqual([]);
    expect(review!.body).toContain('Point 1');
    expect((await prisma.point.findFirstOrThrow({ where: { chatId: s.chat.id, number: 1 } })).githubCommentId).toBeNull();
  });

  it('cleans agent text before posting', async () => {
    const s = await scene({ authorOnNitpilot: false });
    await s.point(1, { body: `Leaked ghp_${'a'.repeat(36)}; ask @someone or @maya. ![x](https://evil.example/p.png)` });
    await s.handlers.post_review!(await s.task('post_review', { reviewerGithubId: s.leo.githubId, pointNumbers: [1] }));
    const body = s.platform.writesFor(s.ref, 'review')[0]!.comments[0]!.body;
    expect(body).toContain('[redacted]');
    expect(body).toContain('`@\u200Bsomeone`');
    expect(body).toContain('@maya');
    expect(body).not.toContain('evil.example');
  });
});

describe('a reviewer whose GitHub sign-in expired (spec §15)', () => {
  it('stops the write for good, and posts nothing as the bot instead', async () => {
    const s = await scene({ authorOnNitpilot: false });
    await s.point(1);
    s.platform.postReview = async () => {
      throw new NeedsReauthError(s.leo.id);
    };
    const run = s.handlers.post_review!(await s.task('post_review', { reviewerGithubId: s.leo.githubId, pointNumbers: [1] }));
    await expect(run).rejects.toBeInstanceOf(PermanentTaskError);
    expect(s.platform.writes).toEqual([]);
  });
});

describe('thread_replies', () => {
  it('replies in each point thread, and skips points that have none', async () => {
    const s = await scene({ authorOnNitpilot: true });
    await s.point(1, { origin: 'github', githubCommentId: '9001', githubThreadRootId: '9001' });
    await s.point(2);
    await s.handlers.thread_replies!(await s.task('thread_replies', { asGithubId: s.maya!.githubId, replies: [{ pointNumber: 1, body: 'Fixed in c0ffee1.' }, { pointNumber: 2, body: 'x' }] }));
    const replies = s.platform.writesFor(s.ref, 'reply');
    expect(replies).toEqual([expect.objectContaining({ asUser: s.maya!.id, threadRootId: '9001' })]);
    expect(replies[0]!.body).toMatch(/^Fixed in c0ffee1\.\n\n<!-- nitpilot:v1 chat=.* point=1 -->$/);
    expect(await prisma.githubWrite.count({ where: { kind: 'reply', githubId: replies[0]!.id } })).toBe(1);
  });
});

describe('notify', () => {
  it('sends a titled notification with a link to the chat', async () => {
    const s = await scene({ authorOnNitpilot: true });
    await s.handlers.notify!(await s.task('notify', { userIds: [s.leo.id], kind: 'ready', pointNumbers: [] }));
    expect(s.sent).toEqual([
      { userIds: [s.leo.id], kind: 'ready', chatId: s.chat.id, title: `Ready for your approval: ${s.repo.fullName}#${s.chat.number}`, url: `http://localhost:8787/c/${s.repo.fullName}/${s.chat.number}` },
    ]);
  });

  it('names the points that need a decision', async () => {
    const s = await scene({ authorOnNitpilot: true });
    await s.handlers.notify!(await s.task('notify', { userIds: [s.leo.id], kind: 'escalated', pointNumbers: [1, 3] }));
    expect(s.sent[0]!.title).toBe(`Needs you: ${s.repo.fullName}#${s.chat.number}: P1, P3 need a human decision`);
  });
});

describe('a chat that no longer exists', () => {
  it('is a quiet no-op', async () => {
    const s = await scene({ authorOnNitpilot: true });
    const t = await s.task('summary', {});
    await prisma.prChat.delete({ where: { id: s.chat.id } });
    await expect(s.handlers.summary!({ ...t, chatId: s.chat.id })).resolves.toBeUndefined();
  });
});
