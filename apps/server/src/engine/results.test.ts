import { describe, expect, it } from 'vitest';
import {
  agentToAgent, commandsOf, jobOf, leo, maya, newPoint, participantOf, pointOf, result, run, sam,
} from './test-builders';
import type { ChatState } from './types';

/** leo's review job is running. */
function reviewing(over: Partial<ChatState> = {}): ChatState {
  return agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-r1', leo, 'reviewer', 'review')], ...over });
}

/** leo raised P1 and P2 in round 1; maya's address job is running. */
function addressing(over: Partial<ChatState> = {}): ChatState {
  return agentToAgent({
    phase: 'addressing',
    participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
    points: [pointOf(1, leo), pointOf(2, leo, { severity: 'nit' })],
    jobs: [jobOf('job-a1', maya, 'author', 'address')],
    ...over,
  });
}

/** maya answered P1 (fixed) and P2 (declined); leo's re-review is running. */
function reReviewing(over: Partial<ChatState> = {}): ChatState {
  return agentToAgent({
    phase: 'reviewing',
    round: 2,
    addressPasses: 1,
    headSha: 'head2',
    participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
    points: [
      pointOf(1, leo, { status: 'addressed', authorResolution: 'fixed' }),
      pointOf(2, leo, { status: 'addressed', authorResolution: 'declined' }),
    ],
    jobs: [jobOf('job-rr2', leo, 'reviewer', 're_review', { round: 2, headSha: 'head2' })],
    ...over,
  });
}

describe('review results (agent-to-agent)', () => {
  it("raises points and queues the author's address job", () => {
    const out = run(reviewing(), { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint(), newPoint({ severity: 'nit', title: 'Rename' })] }) });
    expect(out.chat.points.map((p) => [p.number, p.status, p.raisedBy, p.commitSha])).toEqual([
      [1, 'open', leo.githubId, 'head1'],
      [2, 'open', leo.githubId, 'head1'],
    ]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.lastReviewedSha).toBe('head1');
    expect(out.chat.phase).toBe('addressing');
    expect(commandsOf(out, 'complete_job')[0]).toMatchObject({ jobId: 'job-r1', applyState: 'applied' });
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: maya.githubId, role: 'author' }, jobType: 'address', round: 1, sinceSha: null, applyState: 'pending' },
    ]);
    expect(commandsOf(out, 'post_review')).toEqual([]);
    expect(commandsOf(out, 'upsert_summary')).toHaveLength(1);
  });

  it('escalates a security point at once, notifies both sides, and keeps working on the rest', () => {
    const out = run(reviewing(), { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint({ category: 'security' }), newPoint()] }) });
    expect(out.chat.points[0]).toMatchObject({ status: 'escalated', escalationReason: 'category' });
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-maya', 'user-leo'], kind: 'escalated', pointNumbers: [1] }]);
    expect(commandsOf(out, 'enqueue_job')[0]!.jobType).toBe('address');
    expect(out.chat.participants.every((p) => p.attention === 'decision')).toBe(true);
  });

  it('caps the points from one review at max_points_per_review', () => {
    const out = run(reviewing(), { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint(), newPoint(), newPoint()] }) }, { rules: { max_points_per_review: 2 } });
    expect(out.chat.points).toHaveLength(2);
  });

  it('goes straight to ready when the review finds nothing', () => {
    const out = run(reviewing(), { type: 'job_completed', jobId: 'job-r1', result: result() });
    expect(out.chat.phase).toBe('ready');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'ready', pointNumbers: [] }]);
  });
});

describe('address results', () => {
  it('marks answers, bumps the round and queues a re-review from the last reviewed commit', () => {
    const out = run(addressing(), {
      type: 'job_completed',
      jobId: 'job-a1',
      result: result({
        replies: [
          { point: 1, resolution: 'fixed', comment: 'Added the empty check.' },
          { point: 2, resolution: 'declined', comment: 'Kept for API compatibility.' },
        ],
        push: { from: 'head1aaa', to: 'head2bbb' },
      }),
    });
    expect(out.chat.points.map((p) => [p.number, p.status, p.authorResolution])).toEqual([
      [1, 'addressed', 'fixed'],
      [2, 'addressed', 'declined'],
    ]);
    expect(out.chat).toMatchObject({ round: 2, addressPasses: 1, phase: 'reviewing' });
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: leo.githubId, role: 'reviewer' }, jobType: 're_review', round: 2, sinceSha: 'head1', applyState: 'pending' },
    ]);
    expect(commandsOf(out, 'post_thread_replies')).toEqual([]);
  });

  it('answers a GitHub point in its GitHub thread', () => {
    const chat = agentToAgent({
      phase: 'addressing',
      participants: [participantOf(maya, 'author'), participantOf(sam, 'reviewer', { requested: false })],
      points: [pointOf(1, sam, { origin: 'github', githubCommentId: '9001', githubThreadRootId: '9001', jobId: null })],
      jobs: [jobOf('job-a1', maya, 'author', 'address')],
    });
    const out = run(chat, {
      type: 'job_completed',
      jobId: 'job-a1',
      result: result({ replies: [{ point: 1, resolution: 'fixed', comment: 'Added the check.' }], push: { from: 'head1aaa', to: 'c0ffee1234' } }),
    });
    expect(commandsOf(out, 'post_thread_replies')).toEqual([
      { type: 'post_thread_replies', asGithubId: maya.githubId, replies: [{ pointNumber: 1, body: 'Added the check.\n\nFixed in c0ffee1.' }] },
    ]);
    // sam isn't on Nitpilot: his GitHub point now waits for him.
    expect(out.chat.phase).toBe('reviewing');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it('ignores replies to points that are not open', () => {
    const chat = addressing({ points: [pointOf(1, leo, { status: 'escalated', escalationReason: 'category' })] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-a1', result: result({ replies: [{ point: 1, resolution: 'fixed', comment: 'x' }] }) });
    expect(out.chat.points[0]!.status).toBe('escalated');
  });
});

describe('re-review results', () => {
  it('becomes ready when every point is resolved, and tells only the reviewer', () => {
    const out = run(reReviewing(), {
      type: 'job_completed',
      jobId: 'job-rr2',
      result: result({ decisions: [{ point: 1, decision: 'resolve', comment: 'Looks right.' }, { point: 2, decision: 'resolve', comment: 'Fair.' }] }),
    });
    expect(out.chat.phase).toBe('ready');
    expect(out.chat.participants.find((p) => p.login === 'leo')!.lastReviewedSha).toBe('head2');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'ready', pointNumbers: [] }]);
  });

  it('escalates a declined point that the reviewer keeps open (a disagreement)', () => {
    const out = run(reReviewing(), {
      type: 'job_completed',
      jobId: 'job-rr2',
      result: result({ decisions: [{ point: 1, decision: 'resolve', comment: 'ok' }, { point: 2, decision: 'keep_open', comment: 'Still needed.' }] }),
    });
    expect(out.chat.points[1]).toMatchObject({ status: 'escalated', escalationReason: 'disagreement' });
    expect(out.chat.phase).toBe('escalated');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-maya', 'user-leo'], kind: 'escalated', pointNumbers: [2] }]);
  });

  it('reopens a fixed point the reviewer keeps open, and starts another address pass', () => {
    const out = run(reReviewing(), {
      type: 'job_completed',
      jobId: 'job-rr2',
      result: result({ decisions: [{ point: 1, decision: 'keep_open', comment: 'Still crashes on null.' }, { point: 2, decision: 'resolve', comment: 'ok' }] }),
    });
    expect(out.chat.points[0]!.status).toBe('open');
    expect(out.chat.phase).toBe('addressing');
    expect(commandsOf(out, 'enqueue_job')[0]).toMatchObject({ jobType: 'address', round: 2 });
  });

  it('escalates every open point when the round limit is reached', () => {
    const out = run(reReviewing({ addressPasses: 3, round: 4 }), {
      type: 'job_completed',
      jobId: 'job-rr2',
      result: result({ decisions: [{ point: 1, decision: 'keep_open', comment: 'no' }, { point: 2, decision: 'resolve', comment: 'ok' }] }),
    });
    expect(out.chat.points[0]).toMatchObject({ status: 'escalated', escalationReason: 'round_limit' });
    expect(out.chat.phase).toBe('escalated');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it("ignores decisions about another reviewer's points", () => {
    const chat = reReviewing({ points: [pointOf(1, sam, { status: 'addressed', authorResolution: 'fixed' })] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-rr2', result: result({ decisions: [{ point: 1, decision: 'resolve', comment: 'mine now' }] }) });
    expect(out.chat.points[0]!.status).toBe('addressed');
  });
});

describe('single-player reviewer (the author is not on Nitpilot)', () => {
  const offAuthor = { ...maya, userId: null };

  it('posts the points as one GitHub review and hands the turn to the human author', () => {
    const chat = reviewing({ participants: [participantOf(offAuthor, 'author'), participantOf(leo, 'reviewer')] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint()] }) });
    expect(commandsOf(out, 'post_review')).toEqual([{ type: 'post_review', reviewerGithubId: leo.githubId, pointNumbers: [1] }]);
    expect(out.chat.phase).toBe('addressing');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(commandsOf(out, 'upsert_summary')).toEqual([]);
  });

  it('answers re-review decisions in the GitHub threads of the posted points', () => {
    const chat = reReviewing({
      participants: [participantOf(offAuthor, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
      points: [pointOf(1, leo, { status: 'addressed', authorResolution: 'answered', githubCommentId: '77', githubThreadRootId: '77' })],
    });
    const out = run(chat, { type: 'job_completed', jobId: 'job-rr2', result: result({ decisions: [{ point: 1, decision: 'resolve', comment: 'Thanks, that works.' }] }) });
    expect(commandsOf(out, 'post_thread_replies')).toEqual([
      { type: 'post_thread_replies', asGithubId: leo.githubId, replies: [{ pointNumber: 1, body: 'Thanks, that works.' }] },
    ]);
    expect(out.chat.phase).toBe('ready');
  });
});

describe('drafts and stale results', () => {
  it('keeps a draft-mode result as drafts and tells its owner', () => {
    const chat = reviewing({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { applyState: 'draft' })] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint()] }) });
    expect(commandsOf(out, 'complete_job')[0]).toMatchObject({ applyState: 'draft' });
    expect(out.chat.points).toEqual([]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('drafts');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'drafts', pointNumbers: [] }]);
  });

  it('ignores a result for a job that was cancelled', () => {
    const chat = reviewing({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { status: 'cancelled' })] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint()] }) });
    expect(out.commands).toEqual([]);
    expect(out.timeline).toEqual([]);
  });
});
