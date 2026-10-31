import { describe, expect, it } from 'vitest';
import { makeChat, makeMessage, makeParticipant, makeRepo, makeUser } from '../../test/db';
import { READY_LINE } from '../engine/advance';
import { prisma } from '../lib/prisma';
import { loadStats } from './stats';

const NOW = new Date('2026-10-31T12:00:00Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

/** maya's PR, reviewed by leo's agent. */
async function scene() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  await makeParticipant(chat.id, maya, 'author');
  const reviewer = await makeParticipant(chat.id, leo, 'reviewer', { requested: true });
  return { maya, leo, repo, chat, reviewer };
}

let pointNumber = 0;
async function makePoint(chatId: string, raisedBy: string, over: { origin?: string; status?: string; authorResolution?: string; createdAt?: Date } = {}) {
  pointNumber += 1;
  const { origin = 'agent', status = 'open', authorResolution = null, createdAt = ago(DAY) } = over;
  return prisma.point.create({
    data: { chatId, number: pointNumber, raisedByGithubId: raisedBy, origin, status, authorResolution, createdAt, severity: 'major', category: 'bug', title: 'A point', body: 'Why.', round: 1 },
  });
}

/** A chat whose first review job was queued `reviewAt` and that became ready `readyAt`. */
async function timeToReady(s: Awaited<ReturnType<typeof scene>>, reviewAt: Date, readyAt: Date) {
  const chat = await makeChat(s.repo.id, { authorGithubId: s.maya.githubId });
  await makeParticipant(chat.id, s.maya, 'author');
  const reviewer = await makeParticipant(chat.id, s.leo, 'reviewer');
  await prisma.job.create({ data: { chatId: chat.id, participantId: reviewer.id, userId: s.leo.id, type: 'review', status: 'done', round: 1, headSha: chat.headSha, createdAt: reviewAt } });
  const ready = await makeMessage(chat.id, null, READY_LINE);
  await prisma.message.update({ where: { id: ready.id }, data: { createdAt: readyAt } });
  return chat;
}

describe('loadStats (spec §10 GET /api/me/stats)', () => {
  it("counts the points your agent raised by where each is now, an escalated one only as escalated", async () => {
    const { leo, chat } = await scene();
    await makePoint(chat.id, leo.githubId);
    await makePoint(chat.id, leo.githubId, { status: 'resolved', authorResolution: 'fixed' });
    await makePoint(chat.id, leo.githubId, { status: 'addressed', authorResolution: 'fixed' });
    await makePoint(chat.id, leo.githubId, { status: 'resolved', authorResolution: 'declined' });
    await makePoint(chat.id, leo.githubId, { status: 'escalated', authorResolution: 'declined' });
    await makePoint(chat.id, leo.githubId, { status: 'escalated' });
    expect(await loadStats(leo, 7, NOW)).toEqual({ days: 7, raised: 6, fixed: 2, declined: 1, escalated: 2, medianMsToReady: null });
  });

  it("leaves out points written by hand on GitHub and other people's points", async () => {
    const { maya, leo, chat } = await scene();
    await makePoint(chat.id, leo.githubId, { origin: 'github', status: 'resolved', authorResolution: 'fixed' });
    await makePoint(chat.id, maya.githubId, { status: 'escalated' });
    expect(await loadStats(leo, 7, NOW)).toMatchObject({ raised: 0, fixed: 0, escalated: 0 });
  });

  it('counts 7 or 30 days back', async () => {
    const { leo, chat } = await scene();
    await makePoint(chat.id, leo.githubId, { createdAt: ago(6 * DAY) });
    await makePoint(chat.id, leo.githubId, { createdAt: ago(8 * DAY) });
    await makePoint(chat.id, leo.githubId, { createdAt: ago(31 * DAY) });
    expect((await loadStats(leo, 7, NOW)).raised).toBe(1);
    expect((await loadStats(leo, 30, NOW)).raised).toBe(2);
  });

  it('gives the median time to ready, odd and even, and only for chats first ready in the window', async () => {
    const s = await scene();
    await timeToReady(s, ago(2 * DAY), ago(2 * DAY - 1 * HOUR));
    await timeToReady(s, ago(3 * DAY), ago(3 * DAY - 4 * HOUR));
    await timeToReady(s, ago(4 * DAY), ago(4 * DAY - 2 * HOUR));
    expect((await loadStats(s.leo, 7, NOW)).medianMsToReady).toBe(2 * HOUR);
    expect((await loadStats(s.maya, 7, NOW)).medianMsToReady).toBe(2 * HOUR); // the author's chats too

    // First ready 20 days ago, ready again yesterday: counted in 30 days only, from its first ready.
    const old = await timeToReady(s, ago(20 * DAY), ago(20 * DAY - 10 * HOUR));
    const again = await makeMessage(old.id, null, READY_LINE);
    await prisma.message.update({ where: { id: again.id }, data: { createdAt: ago(DAY) } });
    expect((await loadStats(s.leo, 7, NOW)).medianMsToReady).toBe(2 * HOUR);
    expect((await loadStats(s.leo, 30, NOW)).medianMsToReady).toBe(3 * HOUR); // 1, 2, 4, 10 hours
  });

  it('has no median when no chat of yours became ready, or one became ready with no agent review', async () => {
    const s = await scene();
    expect((await loadStats(s.leo, 7, NOW)).medianMsToReady).toBeNull();
    const ready = await makeMessage(s.chat.id, null, READY_LINE);
    await prisma.message.update({ where: { id: ready.id }, data: { createdAt: ago(HOUR) } });
    expect((await loadStats(s.leo, 7, NOW)).medianMsToReady).toBeNull();

    const sam = await makeUser({ login: 'sam' });
    await timeToReady(s, ago(DAY), ago(DAY - HOUR));
    expect((await loadStats(sam, 7, NOW)).medianMsToReady).toBeNull(); // not sam's chat
  });
});
