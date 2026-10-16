import { describe, expect, it } from 'vitest';
import { makeChat, makeMessage, makeRepo, makeUser } from '../../test/db';
import { prisma } from '../lib/prisma';
import { loadItemsAfter } from './timeline';

describe('loadItemsAfter', () => {
  it('reads every item after a seq, oldest first, as the web app shows them', async () => {
    const repo = await makeRepo();
    const chat = await makeChat(repo.id);
    const leo = await makeUser({ login: 'leo' });
    await makeMessage(chat.id, null, 'Pull request opened by maya');
    const said = await makeMessage(chat.id, leo, 'Please add a test');
    const items = await loadItemsAfter(chat.id, 0);
    expect(items.map((i) => i.seq)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({ kind: 'system', author: null, body: 'Pull request opened by maya', pointNumber: null, data: null });
    expect(items[1]).toEqual({ seq: 2, kind: 'human', author: { githubId: leo.githubId, login: 'leo' }, pointNumber: null, jobId: null, body: 'Please add a test', data: null, at: said.createdAt.toISOString() });
    expect(await loadItemsAfter(chat.id, 2)).toEqual([]);
  });

  it("gives a person's reply in a point's GitHub thread that point's number", async () => {
    const repo = await makeRepo();
    const chat = await makeChat(repo.id);
    const raisedBy = await makeUser();
    await prisma.point.create({
      data: { chatId: chat.id, number: 4, raisedByGithubId: raisedBy.githubId, origin: 'github', githubCommentId: '900', githubThreadRootId: '900', severity: 'minor', category: 'style', title: 'Name', body: 'Rename it', status: 'open', trusted: true, round: 1 },
    });
    await prisma.message.createMany({
      data: [
        { chatId: chat.id, seq: 1, kind: 'human', authorGithubId: raisedBy.githubId, authorLogin: raisedBy.login, body: 'Still not renamed', data: { threadRootId: '900' } },
        { chatId: chat.id, seq: 2, kind: 'human', authorGithubId: raisedBy.githubId, authorLogin: raisedBy.login, body: 'Elsewhere', data: { threadRootId: '901' } },
      ],
    });
    expect((await loadItemsAfter(chat.id, 0)).map((i) => i.pointNumber)).toEqual([4, null]);
  });
});
