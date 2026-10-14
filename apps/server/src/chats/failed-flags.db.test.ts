import { beforeEach, describe, expect, it } from 'vitest';
import { makeChat, makeRepo, makeUser, resetDb } from '../../test/db';
import type { DomainEvent } from '../engine/types';
import { prisma } from '../lib/prisma';
import type { Dispatch } from './dispatch';
import { resumeAfterSignIn } from './failed-flags';

beforeEach(resetDb);

/** A dispatch that only writes down what it was asked to send. */
function recordingDispatch() {
  const calls: { chatId: string; event: DomainEvent }[] = [];
  const dispatch: Dispatch = async (chatId, event) => {
    calls.push({ chatId, event });
    return undefined as never;
  };
  return { calls, dispatch };
}

/** `who` is flagged `failed` as the author of a new chat; `newestJob` is how their newest job there ended (none: no job). */
async function flaggedIn(repoId: string, who: { id: string; githubId: string; login: string }, newestJob: 'done' | 'failed' | null) {
  const chat = await makeChat(repoId, { authorGithubId: who.githubId });
  const participant = await prisma.participant.create({ data: { chatId: chat.id, githubId: who.githubId, role: 'author', login: who.login, userId: who.id, attention: 'failed' } });
  if (newestJob) await prisma.job.create({ data: { chatId: chat.id, participantId: participant.id, userId: who.id, type: 'address', status: newestJob, round: 1, headSha: chat.headSha } });
  return chat;
}

describe('resumeAfterSignIn (spec §15 "Signing in again")', () => {
  it('sends signed_in_again to each chat a failed write flagged them in, and leaves a flag from a failed job', async () => {
    const maya = await makeUser({ login: 'maya' });
    const repo = await makeRepo();
    const wroteNothing = await flaggedIn(repo.id, maya, 'done');
    const noJobYet = await flaggedIn(repo.id, maya, null);
    await flaggedIn(repo.id, maya, 'failed');
    const { calls, dispatch } = recordingDispatch();

    expect(await resumeAfterSignIn(maya, dispatch)).toBe(2);

    const who = { githubId: maya.githubId, login: 'maya', isBot: false, userId: maya.id };
    expect(calls).toHaveLength(2);
    expect(calls).toEqual(
      expect.arrayContaining([
        { chatId: wroteNothing.id, event: { type: 'signed_in_again', who, roles: ['author'] } },
        { chatId: noJobYet.id, event: { type: 'signed_in_again', who, roles: ['author'] } },
      ]),
    );
  });

  it('does nothing for someone who is flagged nowhere', async () => {
    const maya = await makeUser({ login: 'maya' });
    const leo = await makeUser({ login: 'leo' });
    await flaggedIn((await makeRepo()).id, leo, 'done');
    const { calls, dispatch } = recordingDispatch();

    expect(await resumeAfterSignIn(maya, dispatch)).toBe(0);
    expect(calls).toEqual([]);
  });
});
