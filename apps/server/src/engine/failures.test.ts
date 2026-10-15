import { describe, expect, it } from 'vitest';
import { T0, agentToAgent, chatState, commandsOf, jobOf, leo, maya, participantOf, pointOf, run, sam } from './test-builders';
import type { FailureReason } from '@nitpilot/protocol';
import type { ChatState } from './types';

function failing(attempt: number, reason: FailureReason, retryable: boolean) {
  const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { attempt })] });
  return run(chat, { type: 'job_failed', jobId: 'job-r1', attempt, reason, retryable });
}

const after = (ms: number) => new Date(T0.getTime() + ms);

describe('job_failed', () => {
  it.each([
    [1, 30_000],
    [2, 60_000],
  ])('retries a retryable failure on attempt %i after %i ms', (attempt, delay) => {
    const out = failing(attempt, 'crash', true);
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: after(delay), refundAttempt: false, reason: 'crash' }]);
    expect(out.chat.jobs[0]!.status).toBe('queued');
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('none');
  });

  it('gives up after the third attempt and tells the owner', () => {
    const out = failing(3, 'crash', true);
    expect(commandsOf(out, 'fail_job')).toEqual([{ type: 'fail_job', jobId: 'job-r1', reason: 'crash' }]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('failed');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'failed', pointNumbers: [] }]);
  });

  it("doesn't count refunded attempts toward the limit, nor in the backoff", () => {
    // Handed out three times, but one of those runs ended in a way that wasn't the agent's fault.
    const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { attempt: 3, refundedAttempts: 1 })] });
    const out = run(chat, { type: 'job_failed', jobId: 'job-r1', attempt: 3, reason: 'crash', retryable: true });
    // Two attempts counted: retried (not failed), and it waits as after the second one (60 s).
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: after(60_000), refundAttempt: false, reason: 'crash' }]);
    expect(commandsOf(out, 'fail_job')).toEqual([]);
  });

  it('gives up at once on a failure that is not retryable', () => {
    const out = failing(1, 'auth', false);
    expect(commandsOf(out, 'fail_job')).toHaveLength(1);
  });

  it.each([
    ['quota', 15 * 60_000],
    ['daily_cap', 60 * 60_000],
    ['repo_not_linked', 10 * 60_000],
  ] as const)('waits after %s without counting an attempt', (reason, delay) => {
    const out = failing(3, reason, true);
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: after(delay), refundAttempt: true, reason }]);
  });

  it('runs again right away after branch_moved', () => {
    const out = failing(2, 'branch_moved', false);
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: T0, refundAttempt: true, reason: 'branch_moved' }]);
  });

  // Seen live (acceptance run, 7.2): right after our own push, GitHub's PR ref lagged the announced head by 2.3 s,
  // so a re-review handed out at once fetched the old head. Running again at once would spin while GitHub lags.
  it('waits a few seconds after stale_head, without counting an attempt', () => {
    const out = failing(2, 'stale_head', false);
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: after(5_000), refundAttempt: true, reason: 'stale_head' }]);
    expect(out.timeline).toEqual([]); // too short a wait to tell anyone about
  });

  it('ignores a failure from a job that is no longer running', () => {
    const chat = agentToAgent({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { status: 'cancelled' })] });
    const out = run(chat, { type: 'job_failed', jobId: 'job-r1', attempt: 1, reason: 'crash', retryable: true });
    expect(out.commands).toEqual([]);
  });

  it('ignores a failure from an earlier attempt', () => {
    const chat = agentToAgent({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { attempt: 2 })] });
    const out = run(chat, { type: 'job_failed', jobId: 'job-r1', attempt: 1, reason: 'crash', retryable: true });
    expect(out.commands).toEqual([]);
  });
});

describe('write_failed (a GitHub write in someone\'s name was given up on)', () => {
  /** sam (not on Nitpilot) authored the PR; leo's agent reviewed it, so leo's review goes to GitHub. */
  const singlePlayerReviewer = () => chatState({ phase: 'addressing', authorGithubId: sam.githubId, participants: [participantOf(sam, 'author'), participantOf(leo, 'reviewer')] });

  it('says so in the timeline, flags the person and notifies them', () => {
    const out = run(singlePlayerReviewer(), { type: 'write_failed', write: 'review', asGithubId: leo.githubId, pointNumbers: [1, 2], reason: 'github_error' });
    expect(out.timeline).toEqual([
      expect.objectContaining({ kind: 'system', body: "Couldn't post leo's review (P1, P2) on GitHub: GitHub kept failing" }),
    ]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('failed');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'failed', pointNumbers: [1, 2] }]);
  });

  it('asks the person to sign in again when their GitHub sign-in expired', () => {
    const soloAuthor = chatState({ participants: [participantOf(maya, 'author')] });
    const out = run(soloAuthor, { type: 'write_failed', write: 'replies', asGithubId: maya.githubId, pointNumbers: [3], reason: 'needs_reauth' });
    expect(out.timeline[0]!.body).toBe("Couldn't post maya's replies (P3) on GitHub: maya needs to sign in to Nitpilot again");
    expect(out.chat.participants[0]!.attention).toBe('failed');
  });
});

describe('retry_requested', () => {
  /** leo's review failed for good. */
  const reviewFailed = (over: Partial<ChatState> = {}) =>
    agentToAgent({ participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { attention: 'failed' })], ...over });

  it("queues the reviewer's review again and clears the flag", () => {
    const out = run(reviewFailed(), { type: 'retry_requested', who: leo });
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: leo.githubId, role: 'reviewer' }, jobType: 'review', round: 1, sinceSha: null, applyState: 'pending' },
    ]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('none');
    expect(out.chat.phase).toBe('reviewing');
  });

  it("queues the author's address pass again", () => {
    const chat = agentToAgent({
      phase: 'addressing',
      participants: [participantOf(maya, 'author', { attention: 'failed' }), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
      points: [pointOf(1, leo)],
    });
    const out = run(chat, { type: 'retry_requested', who: maya });
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ participant: { githubId: maya.githubId, role: 'author' }, jobType: 'address' })]);
  });

  it("starts the review on an outside contributor's PR too: asking again counts as starting it by hand", () => {
    const out = run(reviewFailed({ trusted: false }), { type: 'retry_requested', who: leo });
    expect(commandsOf(out, 'enqueue_job')).toHaveLength(1);
    expect(commandsOf(out, 'notify')).toEqual([]);
  });

  it("clears the flag but queues nothing yet while the author's agent is fixing: the review starts after that pass", () => {
    const chat = reviewFailed({ phase: 'addressing', jobs: [jobOf('job-a1', maya, 'author', 'address', { status: 'queued' })] });
    const out = run(chat, { type: 'retry_requested', who: leo });
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('none');
  });

  it('does nothing for a reviewer whose review request was removed: the flag stays', () => {
    const chat = agentToAgent({ participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { attention: 'failed', requested: false })] });
    const out = run(chat, { type: 'retry_requested', who: leo });
    expect(out.commands).toEqual([]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('failed');
  });

  it('does nothing for someone with nothing failed, or on a closed PR', () => {
    expect(run(reviewFailed(), { type: 'retry_requested', who: maya }).commands).toEqual([]);
    expect(run(reviewFailed({ phase: 'closed', closed: true }), { type: 'retry_requested', who: leo }).commands).toEqual([]);
  });
});

describe('an author whose address pass failed for good', () => {
  it("waits for a retry: a new comment on the PR doesn't restart the pass", () => {
    const chat = agentToAgent({
      phase: 'addressing',
      participants: [participantOf(maya, 'author', { attention: 'failed' }), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
      points: [pointOf(1, leo)],
    });
    // sam comments; a quiet period later the comments timer fires and the engine decides what's next.
    const comment = { id: '9001', threadRootId: null, author: sam, trusted: true, body: 'Please handle the empty list.', path: 'src/orders/list.ts', line: 48, side: 'RIGHT' as const, commitSha: 'head1' };
    const commented = run(chat, { type: 'external_comment', comment });
    const out = run(commented.chat, { type: 'timer', key: 'comments' });
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(out.chat.participants.find((p) => p.login === 'maya')!.attention).toBe('failed');
    expect(out.chat.phase).toBe('addressing');
  });
});

describe('signed_in_again (a person whose GitHub write failed signed in again)', () => {
  /** maya's replies never reached GitHub, so she's flagged; leo's P1 is still open. */
  const repliesFailed = () =>
    agentToAgent({
      phase: 'addressing',
      participants: [participantOf(maya, 'author', { attention: 'failed' }), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
      points: [pointOf(1, leo)],
    });

  it('clears the flag and lets the chat carry on', () => {
    const out = run(repliesFailed(), { type: 'signed_in_again', who: maya, roles: ['author'] });
    expect(out.chat.participants.find((p) => p.login === 'maya')!.attention).toBe('none');
    expect(out.timeline[0]).toEqual(expect.objectContaining({ kind: 'system', body: 'maya signed in again' }));
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: maya.githubId, role: 'author' }, jobType: 'address', round: 1, sinceSha: null, applyState: 'pending' },
    ]);
  });

  it('leaves a role the event does not name: that flag is a failed job, which `nitpilot retry` handles', () => {
    const out = run(repliesFailed(), { type: 'signed_in_again', who: maya, roles: ['reviewer'] });
    expect(out.chat.participants.find((p) => p.login === 'maya')!.attention).toBe('failed');
    expect(out.timeline).toEqual([]);
    expect(out.commands).toEqual([]);
  });
});
