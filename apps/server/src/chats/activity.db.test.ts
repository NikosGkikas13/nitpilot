import { describe, expect, it } from 'vitest';
import { makeChat, makeRepo, makeUser } from '../../test/db';
import { prisma } from '../lib/prisma';
import { loadActivity } from './activity';

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

describe('loadActivity (spec §9.1)', () => {
  it("is nobody's turn for an addressed point an agent raised", async () => {
    const chat = await chatWithAddressedPoint('agent');
    expect(await loadActivity(chat.id, noClis)).toEqual({ kind: 'none' });
  });

  it("is the reviewer's turn for an addressed point they raised on GitHub", async () => {
    const chat = await chatWithAddressedPoint('github');
    expect(await loadActivity(chat.id, noClis)).toEqual({ kind: 'human_turn', who: 'leo' });
  });
});
