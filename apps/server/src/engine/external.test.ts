import { describe, expect, it } from 'vitest';
import {
  T0, agentToAgent, chatState, commandsOf, jobOf, leo, maya, participantOf, pointOf, rabbit, result, run, sam,
} from './test-builders';
import type { ChatState, ExternalComment, Person } from './types';

function comment(id: string, author: Person, over: Partial<ExternalComment> = {}): ExternalComment {
  return { id, threadRootId: null, author, trusted: true, body: 'Please handle the empty list.', path: 'src/orders/list.ts', line: 48, side: 'RIGHT', commitSha: 'head1', ...over };
}

/** Single-player author: maya is on Nitpilot, nobody reviewing is. */
function soloAuthor(over: Partial<ChatState> = {}): ChatState {
  return chatState({ participants: [participantOf(maya, 'author')], ...over });
}

const at30s = new Date(T0.getTime() + 30_000);

describe('loose GitHub comments (single-player author)', () => {
  it('turn a trusted comment into a point and wait for quiet before working', () => {
    const out = run(soloAuthor(), { type: 'external_comment', comment: comment('9001', sam) });
    expect(out.chat.points[0]).toMatchObject({ number: 1, origin: 'github', githubCommentId: '9001', githubThreadRootId: '9001', raisedBy: sam.githubId, status: 'open' });
    expect(commandsOf(out, 'schedule')).toEqual([{ type: 'schedule', key: 'comments', at: at30s }]);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it("start the author's agent when the debounce timer fires", () => {
    const chat = soloAuthor({ points: [pointOf(1, sam, { origin: 'github', githubCommentId: '9001' })] });
    const out = run(chat, { type: 'timer', key: 'comments' });
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: maya.githubId, role: 'author' }, jobType: 'address', round: 1, sinceSha: null, applyState: 'pending', draftOfId: null },
    ]);
    expect(out.chat.phase).toBe('addressing');
  });

  it('ignore a comment it has already seen', () => {
    const chat = soloAuthor({ points: [pointOf(1, sam, { origin: 'github', githubCommentId: '9001' })] });
    const out = run(chat, { type: 'external_comment', comment: comment('9001', sam) });
    expect(out.chat.points).toHaveLength(1);
    expect(out.commands).toEqual([]);
  });

  it('record an untrusted comment without triggering any work', () => {
    const out = run(soloAuthor(), { type: 'external_comment', comment: comment('9002', sam, { trusted: false }) });
    expect(out.chat.points[0]!.trusted).toBe(false);
    expect(commandsOf(out, 'schedule')).toEqual([]);
  });

  it("treat the author's own top-level comment as a message, not a point", () => {
    const out = run(soloAuthor(), { type: 'external_comment', comment: comment('9003', maya) });
    expect(out.chat.points).toEqual([]);
    expect(out.timeline[0]!.kind).toBe('human');
  });
});

describe('submitted reviews', () => {
  it('act at once for changes_requested and cancel the debounce', () => {
    const out = run(soloAuthor(), {
      type: 'external_review_submitted',
      review: { id: 'r1', author: sam, trusted: true, state: 'changes_requested', body: '', comments: [comment('9001', sam), comment('9002', sam)] },
    });
    expect(out.chat.points).toHaveLength(2);
    expect(commandsOf(out, 'unschedule')).toEqual([{ type: 'unschedule', key: 'comments' }]);
    expect(commandsOf(out, 'enqueue_job')[0]!.jobType).toBe('address');
  });

  it('treat a single loose comment (commented, empty body) like a loose comment', () => {
    const out = run(soloAuthor(), {
      type: 'external_review_submitted',
      review: { id: 'r2', author: sam, trusted: true, state: 'commented', body: '', comments: [comment('9001', sam)] },
    });
    expect(commandsOf(out, 'schedule')).toHaveLength(1);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it('do not duplicate comments that arrived before the review event', () => {
    const chat = soloAuthor({ points: [pointOf(1, sam, { origin: 'github', githubCommentId: '9001' })] });
    const out = run(chat, {
      type: 'external_review_submitted',
      review: { id: 'r1', author: sam, trusted: true, state: 'changes_requested', body: '', comments: [comment('9001', sam)] },
    });
    expect(out.chat.points).toHaveLength(1);
  });

  it('turn a non-empty review body into a point', () => {
    const out = run(soloAuthor(), {
      type: 'external_review_submitted',
      review: { id: 'r3', author: sam, trusted: true, state: 'changes_requested', body: 'Needs tests overall.', comments: [] },
    });
    expect(out.chat.points[0]).toMatchObject({ githubCommentId: 'review:r3', path: null, title: 'Needs tests overall.' });
  });

  it("stop agent rounds for a reviewer who approves, resolving their points", () => {
    const chat = agentToAgent({ phase: 'reviewing', points: [pointOf(1, leo, { status: 'addressed', authorResolution: 'fixed' })], jobs: [jobOf('job-rr', leo, 'reviewer', 're_review')] });
    const out = run(chat, { type: 'external_review_submitted', review: { id: 'r4', author: leo, trusted: true, state: 'approved', body: '', comments: [] } });
    expect(commandsOf(out, 'cancel_jobs')).toEqual([{ type: 'cancel_jobs', jobIds: ['job-rr'], reason: 'approved' }]);
    expect(out.chat.points[0]!.status).toBe('resolved');
    expect(out.chat.participants.find((p) => p.login === 'leo')!.requested).toBe(false);
    expect(out.chat.phase).toBe('ready');
  });
});

describe('threads', () => {
  const answered = () => soloAuthor({
    phase: 'reviewing',
    participants: [participantOf(maya, 'author'), participantOf(sam, 'reviewer', { requested: false })],
    points: [pointOf(1, sam, { origin: 'github', githubCommentId: '9001', githubThreadRootId: '9001', status: 'addressed', authorResolution: 'fixed' })],
  });

  it('resolve a GitHub point when its thread is resolved, then settle', () => {
    const out = run(answered(), { type: 'thread_resolved', threadRootId: '9001' });
    expect(out.chat.points[0]!.status).toBe('resolved');
    expect(out.chat.phase).toBe('ready');
  });

  it('reopen an answered GitHub point when its reviewer replies', () => {
    const out = run(answered(), { type: 'external_comment', comment: comment('9010', sam, { threadRootId: '9001', body: 'Still broken for null.' }) });
    expect(out.chat.points[0]!.status).toBe('open');
    expect(commandsOf(out, 'schedule')).toHaveLength(1);
  });

  it('resolve a GitHub point whose comment was deleted', () => {
    const out = run(answered(), { type: 'external_comment_deleted', commentId: '9001' });
    expect(out.chat.points[0]!.status).toBe('resolved');
  });

  it('reopen a resolved GitHub point when its thread is unresolved', () => {
    const chat = answered();
    chat.points[0]!.status = 'resolved';
    const out = run(chat, { type: 'thread_unresolved', threadRootId: '9001' });
    expect(out.chat.points[0]!.status).toBe('open');
  });
});

describe('single-player reviewer (author not on Nitpilot)', () => {
  const offAuthor = { ...maya, userId: null };
  const humanTurn = () => agentToAgent({
    phase: 'addressing',
    participants: [participantOf(offAuthor, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
    points: [pointOf(1, leo, { githubCommentId: '77', githubThreadRootId: '77' })],
  });

  it("marks our agent's point answered when the author replies, and re-reviews after a quiet period", () => {
    const out = run(humanTurn(), { type: 'external_comment', comment: comment('78', offAuthor, { threadRootId: '77', body: 'It is guarded upstream.' }) });
    expect(out.chat.points[0]).toMatchObject({ status: 'addressed', authorResolution: 'answered' });
    expect(commandsOf(out, 'schedule')).toEqual([{ type: 'schedule', key: `sync:${leo.githubId}`, at: at30s }]);

    const fired = run(out.chat, { type: 'timer', key: `sync:${leo.githubId}` });
    expect(commandsOf(fired, 'enqueue_job')[0]).toMatchObject({ jobType: 're_review', sinceSha: 'head1' });
  });

  it("schedules a re-review when the human author pushes", () => {
    const out = run(humanTurn(), { type: 'head_updated', before: 'head1', after: 'head2', ours: false });
    expect(out.chat.headSha).toBe('head2');
    expect(commandsOf(out, 'schedule')).toEqual([{ type: 'schedule', key: `sync:${leo.githubId}`, at: at30s }]);
  });
});

describe('pushes', () => {
  it('only records the new head for our own push', () => {
    const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-rr', leo, 'reviewer', 're_review')] });
    const out = run(chat, { type: 'head_updated', before: 'head1', after: 'head2', ours: true });
    expect(out.chat.headSha).toBe('head2');
    expect(out.commands).toEqual([]);
  });

  it("restarts the address pass when a human pushes during it", () => {
    const chat = agentToAgent({ phase: 'addressing', points: [pointOf(1, leo)], jobs: [jobOf('job-a1', maya, 'author', 'address')] });
    const out = run(chat, { type: 'head_updated', before: 'head1', after: 'head2', ours: false });
    expect(commandsOf(out, 'cancel_jobs')).toEqual([{ type: 'cancel_jobs', jobIds: ['job-a1'], reason: 'branch_moved' }]);
    expect(commandsOf(out, 'enqueue_job')[0]).toMatchObject({ jobType: 'address' });
  });

  it('ignores news of the head the chat already has: nothing moved, so nothing restarts', () => {
    const chat = agentToAgent({ phase: 'addressing', points: [pointOf(1, leo)], jobs: [jobOf('job-a1', maya, 'author', 'address')] });
    const out = run(chat, { type: 'head_updated', before: 'head0', after: 'head1', ours: false });
    expect(out.chat.headSha).toBe('head1');
    expect(out.commands).toEqual([]);
    expect(out.timeline).toEqual([]);
  });

  it('re-reviews from the last reviewed commit when a human pushes to a ready PR', () => {
    const chat = agentToAgent({ phase: 'ready', participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })] });
    const out = run(chat, { type: 'head_updated', before: 'head1', after: 'head2', ours: false });
    expect(out.chat.phase).toBe('reviewing');
    expect(commandsOf(out, 'enqueue_job')[0]).toMatchObject({ jobType: 're_review', sinceSha: 'head1' });
  });
});

describe('timers', () => {
  it('do nothing once the PR is closed', () => {
    const chat = soloAuthor({ phase: 'closed', closed: true, points: [pointOf(1, sam, { origin: 'github' })] });
    const out = run(chat, { type: 'timer', key: 'comments' });
    expect(out.commands).toEqual([]);
    expect(out.chat.phase).toBe('closed');
  });

  it('stop bot ping-pong at the round limit', () => {
    // coderabbit keeps commenting; maya's agent already did max_rounds passes.
    const chat = soloAuthor({ addressPasses: 3, round: 4 });
    const commented = run(chat, { type: 'external_comment', comment: comment('9100', rabbit) });
    const fired = run(commented.chat, { type: 'timer', key: 'comments' });
    expect(fired.chat.points[0]).toMatchObject({ status: 'escalated', escalationReason: 'round_limit' });
    expect(fired.chat.phase).toBe('escalated');
    expect(commandsOf(fired, 'enqueue_job')).toEqual([]);
  });
});

describe('results after external activity', () => {
  it('a job result still settles normally after a GitHub point was raised mid-review', () => {
    const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-r1', leo, 'reviewer', 'review')] });
    const commented = run(chat, { type: 'external_comment', comment: comment('9001', sam) });
    const done = run(commented.chat, { type: 'job_completed', jobId: 'job-r1', attempt: 1, result: result() });
    // sam's GitHub point is actionable, so maya's agent works on it.
    expect(commandsOf(done, 'enqueue_job')[0]).toMatchObject({ jobType: 'address' });
  });
});
