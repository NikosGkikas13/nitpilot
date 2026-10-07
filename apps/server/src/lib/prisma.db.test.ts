import { describe, expect, it } from 'vitest';
import { ghId, makeChat, makeRepo, makeUser } from '../../test/db';
import { isUniqueViolation, prisma } from './prisma';

describe('schema', () => {
  it('deletes a chat and everything in it when its repo is deleted', async () => {
    const repo = await makeRepo();
    const chat = await makeChat(repo.id);
    await prisma.participant.create({ data: { chatId: chat.id, githubId: ghId(), role: 'author', login: 'maya' } });
    await prisma.message.create({ data: { chatId: chat.id, seq: 1, kind: 'system', body: 'hi' } });

    await prisma.installation.delete({ where: { id: repo.installationId } });

    expect(await prisma.prChat.findUnique({ where: { id: chat.id } })).toBeNull();
    expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(0);
  });

  it('allows only one active job per participant', async () => {
    const user = await makeUser();
    const chat = await makeChat((await makeRepo()).id);
    const p = await prisma.participant.create({ data: { chatId: chat.id, githubId: user.githubId, role: 'reviewer', login: user.login, userId: user.id } });
    const job = { chatId: chat.id, participantId: p.id, userId: user.id, type: 'review', round: 1, headSha: chat.headSha };

    const first = await prisma.job.create({ data: { ...job, activeFor: p.id } });
    const second = prisma.job.create({ data: { ...job, activeFor: p.id } });
    await expect(second).rejects.toSatisfy(isUniqueViolation);

    // Once the first job is done, a new one can start.
    await prisma.job.update({ where: { id: first.id }, data: { status: 'done', activeFor: null } });
    await expect(prisma.job.create({ data: { ...job, activeFor: p.id } })).resolves.toBeTruthy();
  });
});
