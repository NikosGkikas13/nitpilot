import { samples } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { makeChat, makeRepo, makeUser, personOf } from '../../test/db';
import { Dispatcher } from '../chats/dispatch';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { FakePlatform } from '../platform/fake/fake-platform';
import { buildJobBundle } from './bundle';

const platform = new FakePlatform();

/** The chat's queued job of this type, moved to running the way the assigner does it. */
async function running(chatId: string, type: string) {
  const job = await prisma.job.findFirstOrThrow({ where: { chatId, type, status: 'queued' } });
  return prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1 } });
}

/** maya opened a PR and asked leo for a review; leo's review job is running. */
async function scene(repoOver: { rulesJson?: Prisma.InputJsonValue } = {}) {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const repo = await makeRepo(repoOver);
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId });
  const dispatcher = new Dispatcher();
  await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: personOf(maya), reviewers: [personOf(leo)] });
  return { maya, leo, repo, chat, dispatcher, review: await running(chat.id, 'review') };
}

describe('buildJobBundle', () => {
  it('describes a first review: the PR, who you are, how to fetch the code, and the team rules', async () => {
    const { repo, chat, review } = await scene({ rulesJson: { max_rounds: 2, ignore_paths: ['vendor/**'], max_points_per_review: 5 } });
    expect(await buildJobBundle(review.id, platform)).toEqual({
      jobId: review.id,
      attempt: 1,
      type: 'review',
      round: 1,
      maxRounds: 2,
      apply: 'auto',
      you: { login: 'leo', role: 'reviewer' },
      pr: {
        repoFullName: repo.fullName,
        number: chat.number,
        title: chat.title,
        body: '',
        url: chat.url,
        authorLogin: 'maya',
        baseRef: 'main',
        headRef: chat.headRef,
        baseSha: chat.baseSha,
        headSha: chat.headSha,
      },
      git: { baseCloneUrl: `https://github.com/${repo.fullName}.git`, fetchRef: `refs/pull/${chat.number}/head`, headRepoPath: repo.fullName, headBranch: chat.headRef },
      sinceSha: null,
      points: [],
      notes: [],
      rules: { ignorePaths: ['vendor/**'], alwaysEscalate: ['security'], maxPoints: 5 },
    });
  });

  it('gives a re-review the points with their threads, the human notes, and the commit to start from', async () => {
    const { maya, chat, dispatcher, review } = await scene();
    await dispatcher.dispatch(chat.id, { type: 'job_completed', jobId: review.id, attempt: 1, result: samples.jobResult() });
    const address = await running(chat.id, 'address');
    await dispatcher.dispatch(chat.id, {
      type: 'job_completed',
      jobId: address.id, attempt: 1,
      result: { summary: 'Fixed it.', points: [], decisions: [], replies: [{ point: 1, resolution: 'fixed', comment: 'Added the empty check.' }], push: { from: chat.headSha, to: 'c'.repeat(40) } },
    });
    await dispatcher.dispatch(chat.id, { type: 'human_note', author: personOf(maya), body: 'Please keep the public API stable.' });
    const reReview = await running(chat.id, 're_review');

    const bundle = await buildJobBundle(reReview.id, platform);
    expect(bundle).toMatchObject({ type: 're_review', round: 2, sinceSha: chat.headSha, you: { login: 'leo', role: 'reviewer' } });
    expect(bundle.points).toEqual([
      expect.objectContaining({
        number: 1,
        raisedBy: 'leo',
        status: 'addressed',
        authorResolution: 'fixed',
        title: '`parseOrder` crashes on empty input',
        thread: [expect.objectContaining({ author: 'maya', kind: 'point_reply', body: 'Added the empty check.' })],
      }),
    ]);
    expect(bundle.notes).toEqual([expect.objectContaining({ author: 'maya', body: 'Please keep the public API stable.' })]);
  });

  it('marks a job whose result must wait as drafts', async () => {
    const { review } = await scene();
    await prisma.job.update({ where: { id: review.id }, data: { applyState: 'draft' } });
    expect((await buildJobBundle(review.id, platform)).apply).toBe('draft');
  });

  it("fetches a fork's PR from the base repo and pushes to the fork", async () => {
    const { repo, chat, review } = await scene();
    await prisma.prChat.update({ where: { id: chat.id }, data: { headRepoFullName: 'maya/shop-api-fork' } });
    expect((await buildJobBundle(review.id, platform)).git).toEqual({
      baseCloneUrl: `https://github.com/${repo.fullName}.git`,
      fetchRef: `refs/pull/${chat.number}/head`,
      headRepoPath: 'maya/shop-api-fork',
      headBranch: chat.headRef,
    });
  });

  it('says there is nowhere to push when the fork was deleted', async () => {
    const { chat, review } = await scene();
    await prisma.prChat.update({ where: { id: chat.id }, data: { headRepoFullName: null } });
    expect((await buildJobBundle(review.id, platform)).git.headRepoPath).toBeNull();
  });
});
