import { describe, expect, it } from 'vitest';
import {
  agentToAgent, chatState, commandsOf, jobOf, leo, maya, participantOf, person, pointOf, result, run, sam,
} from './test-builders';
import type { ChatState, DecideOutput, DomainEvent } from './types';

// "Ready for approval" tells a maintainer to go approve. It must only happen once every requested
// reviewer on Nitpilot has reviewed the commit that's there now (spec §9.3, §6.1).

const outsider = person('outsider', { userId: null }); // an outside contributor, not on Nitpilot
const stranger = person('stranger', { userId: null }); // any GitHub user, untrusted

/** outsider's PR. leo (on Nitpilot) is requested and waits to press "Review" by hand; sam is requested too. */
function outsidePr(over: Partial<ChatState> = {}): ChatState {
  return chatState({
    trusted: false,
    authorGithubId: outsider.githubId,
    participants: [participantOf(outsider, 'author'), participantOf(leo, 'reviewer', { attention: 'manual_review' }), participantOf(sam, 'reviewer')],
    ...over,
  });
}

const strangersPoint = pointOf(1, stranger, { origin: 'github', jobId: null, githubCommentId: 'c1', githubThreadRootId: 'c1', trusted: false });

const notifiedReady = (out: DecideOutput) => commandsOf(out, 'notify').filter((n) => n.kind === 'ready');

describe('untrusted activity never makes a chat ready', () => {
  it.each<[string, DomainEvent]>([
    ['a stranger submits a review', { type: 'external_review_submitted', review: { id: 'r9', author: stranger, trusted: false, state: 'changes_requested', body: 'This is wrong.', comments: [] } }],
    ["the stranger's thread is resolved", { type: 'thread_resolved', threadRootId: 'c1' }],
    ["the stranger's comment is deleted", { type: 'external_comment_deleted', commentId: 'c1' }],
    ['another reviewer is removed', { type: 'review_request_removed', reviewer: sam }],
  ])('%s', (_label, event) => {
    const out = run(outsidePr({ points: [strangersPoint] }), event);
    expect(out.chat.phase).toBe('idle');
    expect(notifiedReady(out)).toEqual([]);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it("a trusted reviewer's resolved point doesn't make it ready while leo still has to review by hand", () => {
    const samsPoint = pointOf(1, sam, { origin: 'github', jobId: null, githubCommentId: 'c2', githubThreadRootId: 'c2' });
    const out = run(outsidePr({ points: [samsPoint] }), { type: 'thread_resolved', threadRootId: 'c2' });
    expect(out.chat.phase).toBe('idle');
    expect(notifiedReady(out)).toEqual([]);
  });

  it('a reviewer whose job failed keeps it from being ready, and no new job starts on its own', () => {
    const chat = agentToAgent({
      participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { attention: 'failed' }), participantOf(sam, 'reviewer')],
      points: [pointOf(1, sam, { origin: 'github', jobId: null, githubCommentId: 'c3', githubThreadRootId: 'c3' })],
    });
    const out = run(chat, { type: 'thread_resolved', threadRootId: 'c3' });
    expect(out.chat.phase).toBe('idle');
    expect(notifiedReady(out)).toEqual([]);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });
});

describe('a human push while a review is running', () => {
  it('re-reviews the new head instead of becoming ready', () => {
    const reviewing = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-review-1', leo, 'reviewer', 'review')] });
    const pushed = run(reviewing, { type: 'head_updated', before: 'head1', after: 'head2', ours: false });
    const out = run(pushed.chat, { type: 'job_completed', jobId: 'job-review-1', result: result() });

    expect(out.chat.phase).toBe('reviewing');
    expect(notifiedReady(out)).toEqual([]);
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: leo.githubId, role: 'reviewer' }, jobType: 're_review', round: 1, sinceSha: 'head1', applyState: 'pending' },
    ]);
  });

  it("on an outside contributor's PR, asks for a manual review of the new head instead", () => {
    const reviewing = outsidePr({
      phase: 'reviewing',
      participants: [participantOf(outsider, 'author'), participantOf(leo, 'reviewer')],
      jobs: [jobOf('job-review-1', leo, 'reviewer', 'review')],
    });
    const pushed = run(reviewing, { type: 'head_updated', before: 'head1', after: 'head2', ours: false });
    const out = run(pushed.chat, { type: 'job_completed', jobId: 'job-review-1', result: result() });

    expect(out.chat.phase).toBe('idle');
    expect(notifiedReady(out)).toEqual([]);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: [leo.userId], kind: 'manual_review', pointNumbers: [] }]);
  });
});
