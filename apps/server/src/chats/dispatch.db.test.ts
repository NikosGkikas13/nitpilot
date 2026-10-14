import * as samples from '@nitpilot/protocol/test-samples';
import { describe, expect, it } from 'vitest';
import { ghId, makeChat, makeRepo, makeUser } from '../../test/db';
import type { Person } from '../engine/types';
import { prisma } from '../lib/prisma';
import { Dispatcher, type DispatchEffects } from './dispatch';

async function scene() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const chat = await makeChat((await makeRepo()).id, { authorGithubId: maya.githubId });
  const person = (u: { id: string; githubId: string; login: string }): Person => ({ githubId: u.githubId, login: u.login, isBot: false, userId: u.id });
  const dispatcher = new Dispatcher();
  const effects: DispatchEffects[] = [];
  dispatcher.onCommit((_chatId, e) => effects.push(e));
  await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: person(maya), reviewers: [person(leo)] });
  return { maya, leo, chat, person, dispatcher, effects };
}

describe('Dispatcher', () => {
  it('saves participants, the review job and the timeline in one go', async () => {
    const { chat, leo, effects } = await scene();
    const saved = await prisma.prChat.findUniqueOrThrow({ where: { id: chat.id }, include: { participants: true, jobs: true, messages: { orderBy: { seq: 'asc' } } } });
    expect(saved.phase).toBe('reviewing');
    expect(saved.participants.map((p) => [p.login, p.role, p.requested])).toEqual(expect.arrayContaining([['maya', 'author', false], ['leo', 'reviewer', true]]));
    expect(saved.jobs).toEqual([expect.objectContaining({ type: 'review', status: 'queued', userId: leo.id, headSha: chat.headSha })]);
    expect(saved.jobs[0]!.activeFor).toBe(saved.jobs[0]!.participantId);
    expect(saved.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(saved.lastSeq).toBe(2);
    expect(effects[0]).toMatchObject({ jobsChanged: true });
  });

  it('serializes events for one chat so timeline numbers never collide', async () => {
    const { chat, maya, person, dispatcher } = await scene();
    await Promise.all(Array.from({ length: 5 }, (_, i) => dispatcher.dispatch(chat.id, { type: 'human_note', author: person(maya), body: `note ${i}` })));
    const seqs = (await prisma.message.findMany({ where: { chatId: chat.id }, orderBy: { seq: 'asc' } })).map((m) => m.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('runs events for one chat one at a time, so concurrent comments get distinct point numbers', async () => {
    const { chat, dispatcher } = await scene();
    const sam: Person = { githubId: ghId(), login: 'sam', isBot: false, userId: null };
    const comment = () => ({ id: ghId(), threadRootId: null, author: sam, trusted: true, body: 'x', path: null, line: null, side: null, commitSha: null });
    await Promise.all(Array.from({ length: 5 }, () => dispatcher.dispatch(chat.id, { type: 'external_comment', comment: comment() })));
    const numbers = (await prisma.point.findMany({ where: { chatId: chat.id }, orderBy: { number: 'asc' } })).map((p) => p.number);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it('applies a review result: points, a finished job and the next job', async () => {
    const { chat, maya, dispatcher } = await scene();
    const job = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id } });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1 } });

    await dispatcher.dispatch(chat.id, { type: 'job_completed', jobId: job.id, attempt: 1, result: samples.jobResult() });

    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'done', activeFor: null, applyState: 'applied' });
    expect(await prisma.point.findMany({ where: { chatId: chat.id } })).toEqual([expect.objectContaining({ number: 1, status: 'open', origin: 'agent', severity: 'major' })]);
    expect(await prisma.job.findFirst({ where: { chatId: chat.id, status: 'queued' } })).toMatchObject({ type: 'address', userId: maya.id });
    expect(await prisma.task.findUnique({ where: { dedupeKey: `summary:${chat.id}` } })).toMatchObject({ kind: 'summary', status: 'pending' });
  });

  it('keeps why a job waits to run again, for the "waiting" status (a CLI at its daily cap, say)', async () => {
    const { chat, dispatcher } = await scene();
    const job = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id } });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1 } });
    await dispatcher.dispatch(chat.id, { type: 'job_failed', jobId: job.id, attempt: 1, reason: 'daily_cap', retryable: true });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'queued', failure: 'daily_cap', refundedAttempts: 1 });
  });

  it('reports cancelled running jobs to listeners, for the CLI hub', async () => {
    const { chat, dispatcher, effects } = await scene();
    const job = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id } });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1 } });
    await dispatcher.dispatch(chat.id, { type: 'pr_closed', merged: false });
    expect(effects.at(-1)!.cancelledJobs).toEqual([{ id: job.id, attempt: 1, cliTokenId: null, reason: 'pr_closed' }]);
    expect((await prisma.prChat.findUniqueOrThrow({ where: { id: chat.id } })).closedAt).not.toBeNull();
  });

  it('debounces timers: scheduling the same key twice keeps one task at the later time', async () => {
    const repo = await makeRepo();
    const author = await makeUser();
    const chat = await makeChat(repo.id, { authorGithubId: author.githubId });
    const dispatcher = new Dispatcher();
    const sam: Person = { githubId: ghId(), login: 'sam', isBot: false, userId: null };
    const comment = (id: string) => ({ id, threadRootId: null, author: sam, trusted: true, body: 'x', path: null, line: null, side: null, commitSha: null });
    await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: { githubId: author.githubId, login: author.login, isBot: false, userId: author.id }, reviewers: [] });
    await dispatcher.dispatch(chat.id, { type: 'external_comment', comment: comment(ghId()) });
    const first = await prisma.task.findUniqueOrThrow({ where: { dedupeKey: `timer:${chat.id}:comments` } });
    await dispatcher.dispatch(chat.id, { type: 'external_comment', comment: comment(ghId()) });
    const second = await prisma.task.findUniqueOrThrow({ where: { dedupeKey: `timer:${chat.id}:comments` } });
    expect(second.id).toBe(first.id);
    expect(second.runAt.getTime()).toBeGreaterThanOrEqual(first.runAt.getTime());
  });

  it('queues a job for someone who joined Nitpilot after the chat started', async () => {
    const repo = await makeRepo();
    const author = await makeUser();
    const chat = await makeChat(repo.id, { authorGithubId: author.githubId });
    const latecomerGithubId = ghId();
    const dispatcher = new Dispatcher();
    const authorP: Person = { githubId: author.githubId, login: author.login, isBot: false, userId: author.id };
    await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: authorP, reviewers: [{ githubId: latecomerGithubId, login: 'kim', isBot: false, userId: null }] });
    expect(await prisma.job.count({ where: { chatId: chat.id } })).toBe(0);

    const kim = await makeUser({ githubId: latecomerGithubId, login: 'kim' });
    await dispatcher.dispatch(chat.id, { type: 'review_requested', reviewer: { githubId: latecomerGithubId, login: 'kim', isBot: false, userId: kim.id } });
    expect(await prisma.job.findFirstOrThrow({ where: { chatId: chat.id } })).toMatchObject({ userId: kim.id, type: 'review' });
  });
});
