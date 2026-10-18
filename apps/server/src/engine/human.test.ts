import { describe, expect, it } from 'vitest';
import {
  agentToAgent, chatState, commandsOf, jobOf, leo, maya, participantOf, person, pointOf, result, run,
} from './test-builders';
import type { ChatState } from './types';

const nina = person('nina'); // a second reviewer, on Nitpilot

/**
 * maya's PR, reviewed by leo and nina, with P1 from leo's agent escalated. Both reviewers have reviewed the current
 * head. maya and leo are flagged "needs a decision" while a point is escalated, as the engine leaves them.
 */
function escalated(over: Partial<ChatState> = {}): ChatState {
  const points = over.points ?? [pointOf(1, leo, { status: 'escalated', escalationReason: 'category', category: 'security', severity: 'blocker' })];
  const attention = points.some((p) => p.status === 'escalated') ? 'decision' : 'none';
  return agentToAgent({
    phase: 'escalated',
    participants: [
      participantOf(maya, 'author', { attention }),
      participantOf(leo, 'reviewer', { lastReviewedSha: 'head1', attention }),
      participantOf(nina, 'reviewer', { lastReviewedSha: 'head1' }),
    ],
    ...over,
    points,
  });
}

describe('point_resolve', () => {
  it('resolves an escalated point for the reviewer who raised it, and the chat is ready when nothing else is open', () => {
    const out = run(escalated(), { type: 'point_resolve', who: leo, point: 1 });
    expect(out.chat.points[0]).toMatchObject({ status: 'resolved', escalationReason: null });
    expect(out.timeline.map((i) => i.body)).toEqual(['leo resolved P1', 'Ready for approval']);
    expect(out.timeline[0]).toMatchObject({ kind: 'system', pointNumber: null, data: { point: 1 } });
    expect(out.chat.phase).toBe('ready');
    // leo pressed Resolve and is looking at the Ready banner: only nina is told.
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-nina'], kind: 'ready', pointNumbers: [] }]);
    // Nobody needs to decide anything any more.
    expect(out.chat.participants.map((p) => p.attention)).toEqual(['none', 'none', 'none']);
  });

  it('stays escalated while another point still needs a person', () => {
    const chat = escalated();
    chat.points.push(pointOf(2, leo, { status: 'escalated', escalationReason: 'disagreement' }));
    const out = run(chat, { type: 'point_resolve', who: leo, point: 1 });
    expect(out.timeline.map((i) => i.body)).toEqual(['leo resolved P1']);
    expect(out.chat.phase).toBe('escalated');
  });

  it.each([
    ['the author', maya, escalated()],
    ['another reviewer', nina, escalated()],
    ['the raiser, on an open point', leo, escalated({ points: [pointOf(1, leo)] })],
    ['the raiser, on a resolved point', leo, escalated({ points: [pointOf(1, leo, { status: 'resolved' })] })],
    ['the raiser, on a GitHub point (resolved on GitHub)', leo, escalated({ points: [pointOf(1, leo, { origin: 'github', status: 'escalated', escalationReason: 'round_limit' })] })],
    ['the raiser, on a point that does not exist', leo, escalated({ points: [] })],
  ])('changes nothing when asked by %s', (_who, who, chat) => {
    const out = run(chat, { type: 'point_resolve', who, point: 1 });
    expect(out.timeline).toEqual([]);
    expect(out.commands).toEqual([]);
    expect(out.chat).toEqual(chat);
  });

  it('changes nothing on a closed PR', () => {
    const chat = escalated({ phase: 'closed', closed: true });
    const out = run(chat, { type: 'point_resolve', who: leo, point: 1 });
    expect(out.timeline).toEqual([]);
    expect(out.commands).toEqual([]);
    expect(out.chat).toEqual(chat);
  });
});

describe('point_continue', () => {
  it("hands the point back to the agents below the round limit: open again, and the author's agent gets an address job", () => {
    const out = run(escalated(), { type: 'point_continue', who: maya, point: 1 });
    expect(out.chat.points[0]).toMatchObject({ status: 'open', escalationReason: null });
    expect(out.chat.extraRounds).toBe(0);
    expect(out.timeline.map((i) => i.body)).toEqual(['maya let the agents continue on P1', "maya's agent will work on 1 point"]);
    expect(out.timeline[0]).toMatchObject({ kind: 'system', pointNumber: null, data: { point: 1, extraRound: false } });
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: maya.githubId, role: 'author' }, jobType: 'address', round: 1, sinceSha: null, applyState: 'pending', draftOfId: null },
    ]);
    expect(out.chat.phase).toBe('addressing');
    expect(out.chat.participants.map((p) => p.attention)).toEqual(['none', 'none', 'none']);
  });

  it('works for the reviewer who raised it too', () => {
    const out = run(escalated(), { type: 'point_continue', who: leo, point: 1 });
    expect(out.chat.points[0]!.status).toBe('open');
    expect(out.timeline[0]!.body).toBe('leo let the agents continue on P1');
  });

  it('at the round limit grants one more round, and queues the address job instead of escalating again', () => {
    const chat = escalated({ addressPasses: 3, round: 4, points: [pointOf(1, leo, { status: 'escalated', escalationReason: 'round_limit' })] });
    const out = run(chat, { type: 'point_continue', who: maya, point: 1 });
    expect(out.chat.extraRounds).toBe(1);
    expect(out.chat.points[0]!.status).toBe('open');
    expect(out.timeline.map((i) => i.body)).toEqual(['maya let the agents continue on P1 · one more round', "maya's agent will work on 1 point"]);
    expect(out.timeline[0]!.data).toMatchObject({ extraRound: true });
    expect(commandsOf(out, 'enqueue_job')).toHaveLength(1);
  });

  it('grants no round when the author is not on Nitpilot: it is their own turn, and no agent pass counts', () => {
    const chat = escalated({ addressPasses: 3, participants: [participantOf(person('sam', { userId: null }), 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })] });
    const out = run({ ...chat, authorGithubId: 'gh-sam' }, { type: 'point_continue', who: leo, point: 1 });
    expect(out.chat.extraRounds).toBe(0);
    expect(out.chat.phase).toBe('addressing');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it('hands a GitHub point back too (only Resolve is limited to agent points)', () => {
    const chat = escalated({ points: [pointOf(1, leo, { origin: 'github', status: 'escalated', escalationReason: 'round_limit' })] });
    for (const who of [leo, maya]) {
      const out = run(chat, { type: 'point_continue', who, point: 1 });
      expect(out.chat.points[0]).toMatchObject({ status: 'open', escalationReason: null });
      expect(out.timeline[0]!.body).toBe(`${who.login} let the agents continue on P1`);
    }
  });

  it("grants the extra round even when the author's last pass failed: no job is queued now, the retry uses the round", () => {
    const chat = escalated({ addressPasses: 3, points: [pointOf(1, leo, { status: 'escalated', escalationReason: 'round_limit' })] });
    chat.participants[0]!.attention = 'failed';
    const out = run(chat, { type: 'point_continue', who: maya, point: 1 });
    expect(out.chat.extraRounds).toBe(1);
    expect(out.chat.points[0]!.status).toBe('open');
    expect(out.timeline[0]!.body.endsWith(' · one more round')).toBe(true);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it("queues a draft when the author's Auto is off", () => {
    const chat = escalated();
    chat.participants[0]!.auto = false;
    const out = run(chat, { type: 'point_continue', who: maya, point: 1 });
    expect(commandsOf(out, 'enqueue_job')[0]!.applyState).toBe('draft');
  });

  it('is not undone by the next address pass: a continued security point is answered, then re-reviewed', () => {
    const continued = run(escalated(), { type: 'point_continue', who: maya, point: 1 }).chat;
    continued.jobs = [jobOf('job-a', maya, 'author', 'address')];
    const out = run(continued, { type: 'job_completed', jobId: 'job-a', attempt: 1, result: result({ replies: [{ point: 1, resolution: 'fixed', comment: 'Checked now.' }] }) });
    expect(out.chat.points[0]).toMatchObject({ status: 'addressed', escalationReason: null });
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ participant: { githubId: leo.githubId, role: 'reviewer' }, jobType: 're_review' })]);
  });

  it('escalates again when the agents still disagree, and a second Continue grants a round only at the limit', () => {
    const disagree = (over: Partial<ChatState>) => escalated({ points: [pointOf(1, leo, { status: 'escalated', escalationReason: 'disagreement', authorResolution: 'declined' })], ...over });
    // Below the limit: no extra round.
    let chat = run(disagree({ addressPasses: 1 }), { type: 'point_continue', who: maya, point: 1 }).chat;
    expect(chat.extraRounds).toBe(0);
    // maya's agent declines again, and leo's agent keeps the point open: the same disagreement.
    chat.jobs = [jobOf('job-a', maya, 'author', 'address')];
    chat = run(chat, { type: 'job_completed', jobId: 'job-a', attempt: 1, result: result({ replies: [{ point: 1, resolution: 'declined', comment: 'Still no.' }] }) }).chat;
    chat.jobs = [jobOf('job-r', leo, 'reviewer', 're_review')];
    chat = run(chat, { type: 'job_completed', jobId: 'job-r', attempt: 1, result: result({ decisions: [{ point: 1, decision: 'keep_open', comment: 'It matters.' }] }) }).chat;
    expect(chat.points[0]).toMatchObject({ status: 'escalated', escalationReason: 'disagreement' });
    expect(chat.addressPasses).toBe(2);
    // Continue again: still below the limit of 3, so still no extra round.
    expect(run(chat, { type: 'point_continue', who: maya, point: 1 }).chat.extraRounds).toBe(0);
    // At the limit, the next Continue grants one.
    expect(run({ ...chat, addressPasses: 3 }, { type: 'point_continue', who: maya, point: 1 }).chat.extraRounds).toBe(1);
  });

  it('lets the next address pass run on an extra round, and escalates at the new limit', () => {
    const chat = agentToAgent({ phase: 'reviewing', addressPasses: 3, extraRounds: 1, points: [pointOf(1, leo)] });
    const out = run(chat, { type: 'timer', key: 'comments' });
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ jobType: 'address' })]);
    const over = run({ ...chat, addressPasses: 4 }, { type: 'timer', key: 'comments' });
    expect(over.chat.points[0]).toMatchObject({ status: 'escalated', escalationReason: 'round_limit' });
  });

  it.each([
    ['another reviewer', nina, escalated()],
    ['the author, on an open point', maya, escalated({ points: [pointOf(1, leo)] })],
    ['the author, on a resolved point', maya, escalated({ points: [pointOf(1, leo, { status: 'resolved' })] })],
    ['the author, on a closed PR', maya, escalated({ phase: 'closed', closed: true })],
  ])('changes nothing when asked by %s', (_who, who, chat) => {
    const out = run(chat, { type: 'point_continue', who, point: 1 });
    expect(out.timeline).toEqual([]);
    expect(out.commands).toEqual([]);
    expect(out.chat).toEqual(chat);
  });
});

describe('the lines an agent gets when work is queued', () => {
  // Its CLI may be offline: the line says the work was handed over, and the banner says whether it runs.
  it('say the agent will review or work, not that it is doing so', () => {
    const opened = run(chatState(), { type: 'pr_opened', author: maya, reviewers: [leo] });
    expect(opened.timeline.map((i) => i.body)).toContain("Round 1: leo's agent will review");
  });
});
