import { describe, expect, it } from 'vitest';
import { makeChat, makeRepo, makeUser, personOf } from '../../test/db';
import { prisma } from '../lib/prisma';
import { Dispatcher } from './dispatch';
import { loadChat } from './load';
import { saveChatState } from './save';

/** maya's PR, reviewed by leo, with P1 from leo's agent, open and not on GitHub yet. */
async function scene() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const chat = await makeChat((await makeRepo()).id, { authorGithubId: maya.githubId });
  await new Dispatcher().dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
  await prisma.point.create({
    data: { chatId: chat.id, number: 1, raisedByGithubId: leo.githubId, origin: 'agent', severity: 'major', category: 'bug', title: 'Off by one', body: 'The last page is lost.', round: 1 },
  });
  return { chat };
}

describe('saveChatState', () => {
  it('writes only the fields that changed, so a thread link saved meanwhile by another write stays (M2)', async () => {
    const { chat } = await scene();
    const loaded = await loadChat(chat.id);
    // The review task posts P1 to GitHub and saves its comment id without the chat's lock (tasks/handlers/review.ts).
    await prisma.point.update({ where: { chatId_number: { chatId: chat.id, number: 1 } }, data: { githubCommentId: 'c-1', githubThreadRootId: 'c-1' } });
    const after = structuredClone(loaded.state);
    after.points[0]!.status = 'resolved';
    await prisma.$transaction((tx) => saveChatState(tx, chat.id, loaded.state, after, new Date()));
    expect(await prisma.point.findUniqueOrThrow({ where: { chatId_number: { chatId: chat.id, number: 1 } } })).toMatchObject({
      status: 'resolved',
      githubCommentId: 'c-1',
      githubThreadRootId: 'c-1',
    });
  });

  it('saves the rounds people granted with Continue, and reads them back', async () => {
    const { chat } = await scene();
    const loaded = await loadChat(chat.id);
    expect(loaded.state.extraRounds).toBe(0);
    await prisma.$transaction((tx) => saveChatState(tx, chat.id, loaded.state, { ...loaded.state, extraRounds: 1 }, new Date()));
    expect((await loadChat(chat.id)).state.extraRounds).toBe(1);
  });
});
