import { ChatView, type JobResult } from '@nitpilot/protocol';
import * as samples from '@nitpilot/protocol/test-samples';
import { describe, expect, it } from 'vitest';
import { makeChat, makeCliToken, makeMessage, makeParticipant, makeRepo, makeUser } from '../../test/db';
import { prisma } from '../lib/prisma';
import type { LiveClis } from './activity';
import { loadChatPage, loadChatView } from './views';

/** maya's PR, reviewed by leo, with an agent point escalated and a GitHub point answered. maya's CLI is connected. */
async function scene() {
  const repo = await makeRepo({ rulesJson: { max_rounds: 4, always_escalate: ['security', 'bug'] } });
  await prisma.repo.update({ where: { id: repo.id }, data: { rulesError: 'line 3: unknown key max_round' } });
  const [maya, leo] = [await makeUser({ login: 'maya' }), await makeUser({ login: 'leo' })];
  const chat = await makeChat(repo.id, { authorGithubId: maya.githubId, headSha: 'c'.repeat(40) });
  await prisma.prChat.update({ where: { id: chat.id }, data: { phase: 'escalated', round: 2, summaryCommentId: '555' } });
  const mayaP = await makeParticipant(chat.id, maya, 'author');
  const leoP = await makeParticipant(chat.id, leo, 'reviewer', { requested: true, attention: 'decision' });
  const lastSeen = new Date('2026-10-16T18:04:00Z');
  const leoToken = await makeCliToken(leo.id);
  await prisma.cliToken.update({ where: { id: leoToken.id }, data: { lastSeenAt: lastSeen } });
  const mayaToken = await makeCliToken(maya.id);
  const point = { chatId: chat.id, raisedByGithubId: leo.githubId, severity: 'blocker', category: 'security', body: 'Use a parameter.', trusted: true, round: 1 };
  await prisma.point.createMany({
    data: [
      { ...point, number: 1, origin: 'agent', path: 'src/orders/list.ts', line: 48, side: 'RIGHT', commitSha: 'a'.repeat(40), title: 'SQL built from input', status: 'escalated', escalationReason: 'category', snippet: { startLine: 43, lines: ['const q = 1;'] } },
      { ...point, number: 2, origin: 'github', path: 'src/old name.ts', line: 7, side: 'LEFT', commitSha: null, severity: 'minor', category: 'style', title: 'Naming', status: 'addressed', authorResolution: 'fixed', githubCommentId: '900' },
      { ...point, number: 3, origin: 'agent', path: null, line: null, side: null, title: 'Add a test', status: 'open' },
    ],
  });
  const clis: LiveClis = { connectionsFor: (userId) => (userId === maya.id ? [{ tokenId: mayaToken.id, repos: new Set([repo.fullName]), usedToday: 0 }] : []) };
  return { repo, chat, maya, leo, mayaP, leoP, mayaToken, lastSeen, clis };
}

describe('loadChatView (spec §10, handoff §2)', () => {
  it('says what the reader may do: leo resolves and continues his escalated point, maya only continues it', async () => {
    const { chat, maya, leo, clis } = await scene();
    expect((await loadChatView(chat.id, leo, clis)).permissions).toEqual({ note: true, resolve: [1], continue: [1], review: false, retry: false, auto: ['reviewer'], drafts: [] });
    expect((await loadChatView(chat.id, maya, clis)).permissions).toEqual({ note: true, resolve: [], continue: [1], review: false, retry: false, auto: ['author'], drafts: [] });
    const reader = await makeUser();
    expect((await loadChatView(chat.id, reader, clis)).permissions).toEqual({ note: false, resolve: [], continue: [], review: false, retry: false, auto: [], drafts: [] });
  });

  it("offers Retry only when the person's agent failed, not when posting to GitHub did", async () => {
    const { chat, leo, leoP, clis } = await scene();
    await prisma.participant.update({ where: { id: leoP.id }, data: { attention: 'failed' } });
    // Flagged, but no job of theirs failed: a GitHub post did, and running the agent again wouldn't help.
    expect((await loadChatView(chat.id, leo, clis)).permissions.retry).toBe(false);
    await prisma.job.create({ data: { chatId: chat.id, participantId: leoP.id, userId: leo.id, type: 'review', status: 'failed', round: 1, headSha: chat.headSha } });
    expect((await loadChatView(chat.id, leo, clis)).permissions.retry).toBe(true);
  });

  it("says why the person's newest job failed, and nothing when the failure is not their agent's or the reason is unknown", async () => {
    const { chat, leo, leoP, clis } = await scene();
    const failed = (failure: string | null, createdAt: string) =>
      prisma.job.create({ data: { chatId: chat.id, participantId: leoP.id, userId: leo.id, type: 'review', status: 'failed', failure, round: 1, headSha: chat.headSha, createdAt: new Date(createdAt) } });
    // Not flagged: no reason, whatever the jobs say.
    await failed('auth', '2026-10-16T10:00:00Z');
    expect((await loadChatView(chat.id, leo, clis)).viewer.failureReason).toBeNull();
    await prisma.participant.update({ where: { id: leoP.id }, data: { attention: 'failed' } });
    // The newest failed job wins over an older one.
    await failed('quota', '2026-10-16T11:00:00Z');
    expect((await loadChatView(chat.id, leo, clis)).viewer).toMatchObject({ failure: 'agent', failureReason: 'quota' });
    // A value this version does not know is null, not a crash.
    await failed('from_the_future', '2026-10-16T12:00:00Z');
    expect((await loadChatView(chat.id, leo, clis)).viewer).toMatchObject({ failure: 'agent', failureReason: null });
  });

  it('counts the rounds people granted with Continue in the limit, and keeps the team rule as it is', async () => {
    const { chat, leo, clis } = await scene();
    await prisma.prChat.update({ where: { id: chat.id }, data: { extraRounds: 1 } });
    const view = await loadChatView(chat.id, leo, clis);
    expect(view.maxRounds).toBe(5);
    expect(view.rules.maxRounds).toBe(4);
  });

  it('shows the PR, the rules and the points, with links to their lines on GitHub', async () => {
    const { repo, chat, leo, clis } = await scene();
    const view = ChatView.parse(await loadChatView(chat.id, leo, clis));
    expect(view).toMatchObject({
      id: chat.id, repo: repo.fullName, number: chat.number, author: 'maya', headRef: chat.headRef, baseRef: 'main',
      phase: 'escalated', round: 2, maxRounds: 4, merged: false, closed: false, trusted: true,
      rules: { maxRounds: 4, alwaysEscalate: ['security', 'bug'], autoReview: true, autoAddress: true, error: 'line 3: unknown key max_round' },
      summaryUrl: `${chat.url}#issuecomment-555`,
    });
    const repoUrl = `https://github.com/${repo.fullName}`;
    expect(view.points.map((p) => [p.number, p.raisedBy.login, p.url])).toEqual([
      [1, 'leo', `${repoUrl}/blob/${'a'.repeat(40)}/src/orders/list.ts#L48`],
      // A comment on the old side of the diff links to the base commit; the space in the path is encoded.
      [2, 'leo', `${repoUrl}/blob/${'b'.repeat(40)}/src/old%20name.ts#L7`],
      [3, 'leo', null],
    ]);
    expect(view.points[0]).toMatchObject({ severity: 'blocker', status: 'escalated', escalationReason: 'category', snippet: { startLine: 43 } });
  });

  it("is the viewer's own: your role and why you're needed, or a reader's nothing", async () => {
    const { chat, leo, maya, clis } = await scene();
    expect((await loadChatView(chat.id, leo, clis)).viewer).toEqual({ role: 'reviewer', attention: 'decision', failure: null, failureReason: null });
    expect((await loadChatView(chat.id, maya, clis)).viewer).toEqual({ role: 'author', attention: 'none', failure: null, failureReason: null });
    expect((await loadChatView(chat.id, await makeUser(), clis)).viewer).toEqual({ role: null, attention: 'none', failure: null, failureReason: null });
  });

  it("shows each person's agent: online, offline since it was last seen, and working while its job runs", async () => {
    const { chat, leo, leoP, lastSeen, clis } = await scene();
    await prisma.job.create({ data: { chatId: chat.id, participantId: leoP.id, userId: leo.id, type: 're_review', status: 'running', round: 2, headSha: chat.headSha, runAfter: new Date() } });
    const { participants, activity } = await loadChatView(chat.id, leo, clis);
    expect(participants.map((p) => [p.login, p.role, p.requested, p.agent])).toEqual([
      ['maya', 'author', false, { online: true, offlineSince: null, working: false }],
      ['leo', 'reviewer', true, { online: false, offlineSince: lastSeen.toISOString(), working: true }],
    ]);
    expect(participants[0]!.avatarUrl).toMatch(/^https:\/\/avatars\.githubusercontent\.com\/u\//);
    // leo's CLI is offline and his job runs: the job was bound to a CLI that went away, which the leases will notice.
    expect(activity).toEqual({ kind: 'agent_working', who: 'leo', why: null, offlineSince: null });
  });

  it("says when an agent waits, and gives no agent to someone who isn't on Nitpilot", async () => {
    const { chat, leo, leoP, lastSeen, clis } = await scene();
    await prisma.job.create({ data: { chatId: chat.id, participantId: leoP.id, activeFor: leoP.id, userId: leo.id, type: 're_review', status: 'queued', round: 2, headSha: chat.headSha, runAfter: new Date() } });
    const outsider = { githubId: '424242', login: 'sam' };
    await makeParticipant(chat.id, outsider, 'reviewer');
    const view = await loadChatView(chat.id, leo, clis);
    expect(view.activity).toEqual({ kind: 'agent_waiting', who: 'leo', why: 'offline', offlineSince: lastSeen.toISOString() });
    expect(view.participants.find((p) => p.login === 'sam')).toMatchObject({ onNitpilot: false, agent: null, avatarUrl: 'https://avatars.githubusercontent.com/u/424242' });
  });
});

describe('loadChatView: Auto and drafts (spec §9 "Auto" and "Drafts")', () => {
  /**
   * leo's agent re-reviewed with Auto-review off: its points wait as a draft. maya's agent fixed P3 with Auto-fix off,
   * on her laptop (the one CLI she has connected), and she pressed Send: the publish job is queued for that laptop.
   */
  async function drafts() {
    const s = await scene();
    await prisma.participant.update({ where: { id: s.leoP.id }, data: { auto: false, attention: 'drafts' } });
    await prisma.participant.update({ where: { id: s.mayaP.id }, data: { auto: false, attention: 'drafts' } });
    const review: JobResult = samples.jobResult();
    const fixes: JobResult = { ...samples.jobResult(), points: [], replies: [{ point: 3, resolution: 'fixed', comment: 'Added the test.' }], draft: { sha: 'd'.repeat(40), from: s.chat.headSha, files: [{ path: 'src/orders.test.ts', adds: 12, dels: 0 }], diff: null } };
    const job = (p: { id: string }, userId: string, type: string, over: object) =>
      prisma.job.create({ data: { chatId: s.chat.id, participantId: p.id, userId, type, round: 2, headSha: s.chat.headSha, ...over } });
    const leoDraft = await job(s.leoP, s.leo.id, 're_review', { status: 'done', attempt: 1, applyState: 'draft', result: review, createdAt: new Date('2026-10-16T18:00:00Z') });
    const mayaDraft = await job(s.mayaP, s.maya.id, 'address', { status: 'done', attempt: 1, cliTokenId: s.mayaToken.id, applyState: 'draft', result: fixes, createdAt: new Date('2026-10-16T18:10:00Z') });
    await job(s.mayaP, s.maya.id, 'publish', { status: 'queued', activeFor: s.mayaP.id, draftOfId: mayaDraft.id });
    // A draft already sent and one discarded are no longer waiting.
    await job(s.leoP, s.leo.id, 'review', { status: 'done', attempt: 1, applyState: 'applied', result: review });
    await job(s.leoP, s.leo.id, 'review', { status: 'done', attempt: 1, applyState: 'discarded', result: review });
    return { ...s, review, fixes, leoDraft, mayaDraft };
  }

  it('lists the waiting drafts with their results, oldest first, the same for everyone who reads the chat', async () => {
    const { chat, leo, maya, clis, review, fixes, leoDraft, mayaDraft } = await drafts();
    const view = ChatView.parse(await loadChatView(chat.id, leo, clis));
    expect(view.drafts).toEqual([
      { jobId: leoDraft.id, owner: 'leo', role: 'reviewer', jobType: 're_review', headSha: chat.headSha, createdAt: '2026-10-16T18:00:00.000Z', result: review, sending: false },
      // maya pressed Send: the publish job is on its way to her laptop.
      { jobId: mayaDraft.id, owner: 'maya', role: 'author', jobType: 'address', headSha: chat.headSha, createdAt: '2026-10-16T18:10:00.000Z', result: fixes, sending: true },
    ]);
    for (const viewer of [maya, await makeUser()]) expect((await loadChatView(chat.id, viewer, clis)).drafts).toEqual(view.drafts);
  });

  it('offers Send and Discard only to the owner: others see the drafts without the actions', async () => {
    const { chat, leo, maya, clis, leoDraft, mayaDraft } = await drafts();
    expect((await loadChatView(chat.id, leo, clis)).permissions.drafts).toEqual([leoDraft.id]);
    expect((await loadChatView(chat.id, maya, clis)).permissions.drafts).toEqual([mayaDraft.id]);
    expect((await loadChatView(chat.id, await makeUser(), clis)).permissions.drafts).toEqual([]);
  });

  it("shows each person's Auto switch, and lets the reader switch only their own", async () => {
    const { chat, leo, clis } = await drafts();
    await prisma.participant.updateMany({ where: { chatId: chat.id, role: 'author' }, data: { auto: true } });
    const view = await loadChatView(chat.id, leo, clis);
    expect(view.participants.map((p) => [p.login, p.role, p.auto])).toEqual([['maya', 'author', true], ['leo', 'reviewer', false]]);
    expect(view.permissions.auto).toEqual(['reviewer']);
  });

  it("counts the queued publish job as maya's agent at work while the laptop with her draft is online", async () => {
    const { chat, leo, clis } = await drafts();
    const view = await loadChatView(chat.id, leo, clis);
    expect(view.activity).toEqual({ kind: 'agent_working', who: 'maya', why: null, offlineSince: null });
    expect(view.participants.find((p) => p.login === 'maya')?.agent).toMatchObject({ online: true, working: false });
  });
});

describe('loadChatPage', () => {
  it('gives the newest 200 items, oldest first, and says there are older ones', async () => {
    const { chat, leo, clis } = await scene();
    await prisma.message.createMany({ data: Array.from({ length: 250 }, (_, i) => ({ chatId: chat.id, seq: i + 1, kind: 'system', body: `item ${i + 1}` })) });
    await prisma.prChat.update({ where: { id: chat.id }, data: { lastSeq: 250 } });
    const page = await loadChatPage(chat.id, leo, clis);
    expect(page.items.map((i) => i.seq)).toEqual(Array.from({ length: 200 }, (_, i) => i + 51));
    expect(page.hasOlder).toBe(true);
    expect(page.view.lastSeq).toBe(250);
  });

  it('has nothing older when the whole timeline fits', async () => {
    const { chat, leo, clis } = await scene();
    await makeMessage(chat.id, null, 'Pull request opened by maya');
    expect(await loadChatPage(chat.id, leo, clis)).toMatchObject({ items: [{ seq: 1 }], hasOlder: false });
  });
});
