import { describe, expect, it } from 'vitest';
import { makeChat, makeRepo, makeUser } from '../../test/db';
import { countQueries } from '../../test/queries';
import { prisma } from '../lib/prisma';
import { loadActivities, loadActivity, type LiveClis } from './activity';

const noClis = { connectionsFor: () => [] };

/** A reviewing chat with no job, and one addressed point raised by leo, a reviewer, with this origin. */
async function chatWithAddressedPoint(origin: 'agent' | 'github') {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const chat = await makeChat((await makeRepo()).id, { authorGithubId: maya.githubId });
  await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'reviewing' } });
  await prisma.participant.create({ data: { chatId: chat.id, githubId: maya.githubId, role: 'author', userId: maya.id, login: 'maya' } });
  await prisma.participant.create({ data: { chatId: chat.id, githubId: leo.githubId, role: 'reviewer', userId: leo.id, login: 'leo' } });
  await prisma.point.create({
    data: { chatId: chat.id, number: 1, raisedByGithubId: leo.githubId, origin, severity: 'major', category: 'bug', title: 'A point', body: 'Body.', status: 'addressed', authorResolution: 'answered', round: 1 },
  });
  return chat;
}

/** A reviewing chat whose reviewer has a review job in this state. Their CLI was last seen at `lastSeenAt`. */
async function chatWithJob(status: 'queued' | 'running', lastSeenAt: Date) {
  const author = await makeUser();
  const reviewer = await makeUser();
  const chat = await makeChat((await makeRepo()).id, { authorGithubId: author.githubId });
  await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'reviewing' } });
  const participant = await prisma.participant.create({ data: { chatId: chat.id, githubId: reviewer.githubId, role: 'reviewer', userId: reviewer.id, login: reviewer.login } });
  await prisma.job.create({ data: { chatId: chat.id, participantId: participant.id, activeFor: participant.id, userId: reviewer.id, type: 'review', status, round: 1, headSha: chat.headSha } });
  await prisma.cliToken.create({ data: { userId: reviewer.id, name: 'laptop', tokenHash: `hash-${reviewer.id}`, prefix: 'nit_x', lastSeenAt } });
  return { chat, reviewer };
}

describe('loadActivity (spec §9.1)', () => {
  it("is nobody's turn for an addressed point an agent raised", async () => {
    const chat = await chatWithAddressedPoint('agent');
    expect(await loadActivity(chat.id, noClis)).toEqual({ kind: 'none' });
  });

  it("is the reviewer's turn for an addressed point they raised on GitHub", async () => {
    const chat = await chatWithAddressedPoint('github');
    expect(await loadActivity(chat.id, noClis)).toEqual({ kind: 'human_turn', who: 'leo' });
  });

  it("is none for a chat that is gone, so a page that read it a moment ago still renders", async () => {
    expect(await loadActivity('no-such-chat', noClis)).toEqual({ kind: 'none' });
  });
});

describe('loadActivities (many chats at once, for the inbox)', () => {
  it('gives each chat the answer loadActivity gives it', async () => {
    const seen = new Date('2026-10-15T09:30:00.000Z');
    const a = await chatWithJob('running', seen);
    const b = await chatWithJob('queued', seen);
    const c = await chatWithAddressedPoint('github');
    const clis: LiveClis = { connectionsFor: () => [] };

    const all = await loadActivities([a.chat.id, b.chat.id, c.id], clis);
    expect(all.get(a.chat.id)).toEqual({ kind: 'agent_working', who: a.reviewer.login });
    expect(all.get(b.chat.id)).toEqual({ kind: 'agent_waiting', who: b.reviewer.login, why: 'offline', offlineSince: seen });
    expect(all.get(c.id)).toEqual({ kind: 'human_turn', who: 'leo' });
    for (const id of [a.chat.id, b.chat.id, c.id]) expect(all.get(id)).toEqual(await loadActivity(id, clis));
  });

  it('reads three chats with as many queries as one (no query per chat)', async () => {
    const seen = new Date('2026-10-15T09:30:00.000Z');
    const chats = [await chatWithJob('queued', seen), await chatWithJob('queued', seen), await chatWithJob('running', seen)];
    const one = await countQueries(() => loadActivities([chats[0]!.chat.id], noClis));
    const three = await countQueries(() => loadActivities(chats.map((c) => c.chat.id), noClis));
    expect(one).toBeGreaterThan(0);
    expect(three).toBe(one);
  });

  it('asks the database nothing for no chats', async () => {
    expect(await countQueries(() => loadActivities([], noClis))).toBe(0);
  });
});
