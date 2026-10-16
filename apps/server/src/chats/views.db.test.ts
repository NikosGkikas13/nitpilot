import { ChatView } from '@nitpilot/protocol';
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
  await makeParticipant(chat.id, maya, 'author');
  const leoP = await makeParticipant(chat.id, leo, 'reviewer', { requested: true, attention: 'decision' });
  const lastSeen = new Date('2026-10-16T18:04:00Z');
  const leoToken = await makeCliToken(leo.id);
  await prisma.cliToken.update({ where: { id: leoToken.id }, data: { lastSeenAt: lastSeen } });
  await makeCliToken(maya.id);
  const point = { chatId: chat.id, raisedByGithubId: leo.githubId, severity: 'blocker', category: 'security', body: 'Use a parameter.', trusted: true, round: 1 };
  await prisma.point.createMany({
    data: [
      { ...point, number: 1, origin: 'agent', path: 'src/orders/list.ts', line: 48, side: 'RIGHT', commitSha: 'a'.repeat(40), title: 'SQL built from input', status: 'escalated', escalationReason: 'category', snippet: { startLine: 43, lines: ['const q = 1;'] } },
      { ...point, number: 2, origin: 'github', path: 'src/old name.ts', line: 7, side: 'LEFT', commitSha: null, severity: 'minor', category: 'style', title: 'Naming', status: 'addressed', authorResolution: 'fixed', githubCommentId: '900' },
      { ...point, number: 3, origin: 'agent', path: null, line: null, side: null, title: 'Add a test', status: 'open' },
    ],
  });
  const clis: LiveClis = { connectionsFor: (userId) => (userId === maya.id ? [{ repos: new Set([repo.fullName]) }] : []) };
  return { repo, chat, maya, leo, leoP, lastSeen, clis };
}

describe('loadChatView (spec §10, handoff §2)', () => {
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
    expect((await loadChatView(chat.id, leo, clis)).viewer).toEqual({ role: 'reviewer', attention: 'decision', failure: null });
    expect((await loadChatView(chat.id, maya, clis)).viewer).toEqual({ role: 'author', attention: 'none', failure: null });
    expect((await loadChatView(chat.id, await makeUser(), clis)).viewer).toEqual({ role: null, attention: 'none', failure: null });
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
