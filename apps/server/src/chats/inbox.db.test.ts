import { describe, expect, it } from 'vitest';
import { makeChat, makeMessage, makeParticipant, makeRepo, makeUser } from '../../test/db';
import { countQueries } from '../../test/queries';
import type { SessionUser } from '../auth/session';
import { prisma } from '../lib/prisma';
import type { LiveClis } from './activity';
import { loadInboxRow, loadInboxRows } from './inbox';

const noClis: LiveClis = { connectionsFor: () => [] };
const DAY = 86_400_000;

const viewer = (u: { id: string; githubId: string; login: string; avatarUrl: string | null }): SessionUser => ({ id: u.id, githubId: u.githubId, login: u.login, avatarUrl: u.avatarUrl });

/** maya's PR, reviewed by leo (requested, on Nitpilot) and sam (not on Nitpilot). */
async function scene() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await prisma.user.update({ where: { id: (await makeUser({ login: 'leo' })).id }, data: { avatarUrl: 'https://avatars.githubusercontent.com/u/2' } });
  const sam = { githubId: `gh-sam-${maya.id}`, login: 'sam' };
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  await makeParticipant(chat.id, maya, 'author');
  await makeParticipant(chat.id, sam, 'reviewer');
  await makeParticipant(chat.id, leo, 'reviewer', { requested: true });
  return { maya, leo, sam, repo, chat };
}

describe('loadInboxRows (spec §16 "Inbox")', () => {
  it('lists the author row with the requested reviewer, and the reviewer row with the author', async () => {
    const { maya, leo, repo, chat } = await scene();
    const [mine] = await loadInboxRows(viewer(maya), noClis);
    expect(mine).toMatchObject({
      chatId: chat.id, repo: repo.fullName, number: chat.number, title: chat.title, url: chat.url, role: 'author',
      other: { login: 'leo', avatarUrl: 'https://avatars.githubusercontent.com/u/2', agentActive: false },
      status: { kind: 'quiet', who: null, reason: null }, round: 1, maxRounds: 3, needsYou: false,
    });
    const [review] = await loadInboxRows(viewer(leo), noClis);
    expect(review).toMatchObject({ chatId: chat.id, role: 'reviewer', other: { login: 'maya', avatarUrl: `https://avatars.githubusercontent.com/u/${maya.githubId}` } });
  });

  it('counts the rounds people granted with Continue in the limit', async () => {
    const { maya, chat } = await scene();
    await prisma.prChat.update({ where: { id: chat.id }, data: { extraRounds: 2 } });
    const [mine] = await loadInboxRows(viewer(maya), noClis);
    expect(mine!.maxRounds).toBe(5);
  });

  it('gives a person who is both author and reviewer one row per role', async () => {
    const { maya, chat } = await scene();
    await makeParticipant(chat.id, maya, 'reviewer');
    const rows = await loadInboxRows(viewer(maya), noClis);
    expect(rows.map((r) => r.role).sort()).toEqual(['author', 'reviewer']);
    // `other` never picks you: on your own PR it is the requested reviewer; as a reviewer there is no other author.
    expect(rows.find((r) => r.role === 'author')!.other).toMatchObject({ login: 'leo' });
    expect(rows.find((r) => r.role === 'reviewer')!.other).toBeNull();
  });

  it("keeps chats closed in the last 14 days, and never lists someone else's chat", async () => {
    const { maya, leo, repo } = await scene();
    const recent = await makeChat(repo.id, { authorGithubId: maya.githubId });
    await makeParticipant(recent.id, maya, 'author');
    await prisma.prChat.update({ where: { id: recent.id }, data: { phase: 'closed', closedAt: new Date(Date.now() - 2 * DAY) } });
    const old = await makeChat(repo.id, { authorGithubId: maya.githubId });
    await makeParticipant(old.id, maya, 'author');
    await prisma.prChat.update({ where: { id: old.id }, data: { phase: 'closed', closedAt: new Date(Date.now() - 15 * DAY) } });
    const leosOwn = await makeChat(repo.id, { authorGithubId: leo.githubId });
    await makeParticipant(leosOwn.id, leo, 'author');

    const ids = (await loadInboxRows(viewer(maya), noClis)).map((r) => r.chatId);
    expect(ids).toContain(recent.id);
    expect(ids).not.toContain(old.id);
    expect(ids).not.toContain(leosOwn.id);
  });

  it('marks the other side’s agent active while it has a job, and says who works', async () => {
    const { maya, leo, chat } = await scene();
    const leoAsReviewer = await prisma.participant.findFirstOrThrow({ where: { chatId: chat.id, githubId: leo.githubId } });
    await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'reviewing' } });
    await prisma.job.create({ data: { chatId: chat.id, participantId: leoAsReviewer.id, activeFor: leoAsReviewer.id, userId: leo.id, type: 'review', status: 'running', round: 1, headSha: chat.headSha } });
    const [row] = await loadInboxRows(viewer(maya), noClis);
    expect(row!.other).toMatchObject({ login: 'leo', agentActive: true });
    expect(row!.status).toEqual({ kind: 'working', who: 'leo', reason: null });
  });

  it('counts a ready chat as needing the reviewer, not the author', async () => {
    const { maya, leo, chat } = await scene();
    await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'ready' } });
    expect((await loadInboxRows(viewer(leo), noClis))[0]).toMatchObject({ status: { kind: 'ready' }, needsYou: true });
    expect((await loadInboxRows(viewer(maya), noClis))[0]).toMatchObject({ status: { kind: 'their_turn' }, needsYou: false });
  });

  it('shows the newest timeline item on one line, cut at 120 characters', async () => {
    const { maya, leo, chat } = await scene();
    await makeMessage(chat.id, null, 'Pull request opened by maya');
    await makeMessage(chat.id, leo, `First line\nsecond   line ${'x'.repeat(200)}`);
    const [row] = await loadInboxRows(viewer(maya), noClis);
    expect(row!.lastActivity).toHaveLength(120);
    expect(row!.lastActivity.startsWith('First line second line xxx')).toBe(true);
    expect(row!.lastActivity.endsWith('…')).toBe(true);
  });

  it("counts as unread everything someone else wrote (system items too) until the person reads it, and never their own", async () => {
    const { maya, leo, chat } = await scene();
    await makeMessage(chat.id, null); // 1: system
    await makeMessage(chat.id, leo); // 2
    await makeMessage(chat.id, maya); // 3: maya's own
    await makeMessage(chat.id, leo); // 4
    await makeMessage(chat.id, leo); // 5
    await makeMessage(chat.id, leo); // 6
    expect((await loadInboxRows(viewer(maya), noClis))[0]!.unread).toBe(5);

    await prisma.chatRead.create({ data: { userId: maya.id, chatId: chat.id, lastReadSeq: 5 } });
    expect((await loadInboxRows(viewer(maya), noClis))[0]!.unread).toBe(1);
  });

  it('reads 30 chats with as many queries as one (no query per chat)', async () => {
    const { maya, leo, repo, chat } = await scene();
    await makeMessage(chat.id, leo);
    const user = viewer(maya);
    const one = await countQueries(() => loadInboxRows(user, noClis));
    for (let i = 0; i < 29; i++) {
      const more = await makeChat(repo.id, { authorGithubId: maya.githubId });
      await makeParticipant(more.id, maya, 'author');
      await makeParticipant(more.id, leo, 'reviewer', { requested: true });
      await makeMessage(more.id, leo);
    }
    const rows = await loadInboxRows(user, noClis);
    expect(rows).toHaveLength(30);
    expect(await countQueries(() => loadInboxRows(user, noClis))).toBe(one);
  });
});

describe('loadInboxRow (one chat, for live updates)', () => {
  it('keeps a chat closed more than 14 days ago out, as the full list does', async () => {
    const { maya, chat } = await scene();
    await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'closed', closedAt: new Date(Date.now() - 15 * DAY) } });
    expect(await loadInboxRow(chat.id, maya.id, noClis)).toEqual([]);
    expect(await loadInboxRows(viewer(maya), noClis)).toEqual([]);
  });

  it('gives the same rows the full list gives for that chat', async () => {
    const { maya, chat } = await scene();
    await makeParticipant(chat.id, maya, 'reviewer');
    const all = (await loadInboxRows(viewer(maya), noClis)).filter((r) => r.chatId === chat.id);
    expect(await loadInboxRow(chat.id, maya.id, noClis)).toEqual(all);
  });
});
