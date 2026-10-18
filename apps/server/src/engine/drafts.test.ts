import type { JobResult } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import {
  agentToAgent, commandsOf, draftOf, jobOf, leo, maya, newPoint, participantOf, person, pointOf, result, run, sam,
} from './test-builders';
import type { ChatState, DecideOutput, DomainEvent, ExternalComment } from './types';

// Send and Discard on drafts (spec §9 "Drafts"). A draft is a finished job whose result waits for its owner.

/** leo's first review ran with his Auto-review off: two points wait as a draft. maya is on Nitpilot. */
function reviewerDraft(over: Partial<ChatState> = {}): ChatState {
  return agentToAgent({
    participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { auto: false, attention: 'drafts' })],
    drafts: [draftOf('job-r1', leo, 'reviewer', 'review', { result: result({ summary: 'Two problems.', points: [newPoint(), newPoint({ severity: 'nit', title: 'Rename' })] }) })],
    ...over,
  });
}

/** What maya's address pass made with Auto-fix off: answers to P1 and P2, and a commit that stays on her laptop. */
const draftedFixes: JobResult = result({
  summary: 'Fixed both.',
  replies: [
    { point: 1, resolution: 'fixed', comment: 'Guarded the empty case.' },
    { point: 2, resolution: 'answered', comment: 'The name is on purpose.' },
  ],
  draft: { sha: 'draft1234', from: 'head1', files: [{ path: 'src/orders/list.ts', adds: 3, dels: 1 }], diff: '@@ -1 +1 @@' },
});

/** leo raised P1 and P2; maya's address pass ran with her Auto-fix off, so its fixes wait as a draft. */
function authorDraft(over: Partial<ChatState> = {}): ChatState {
  return agentToAgent({
    phase: 'addressing',
    participants: [participantOf(maya, 'author', { auto: false, attention: 'drafts' }), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
    points: [pointOf(1, leo), pointOf(2, leo, { severity: 'nit' })],
    drafts: [draftOf('job-a1', maya, 'author', 'address', { result: draftedFixes })],
    ...over,
  });
}

/** maya pressed Send: the publish job that pushes her draft commit is queued (pass `status: 'running'` to start it). */
function publishing(status: 'queued' | 'running' = 'queued'): ChatState {
  return authorDraft({ jobs: [jobOf('job-p1', maya, 'author', 'publish', { status, attempt: status === 'running' ? 1 : 0, draftOfId: 'job-a1' })] });
}

/** A trusted reviewer's new top-level comment on GitHub. */
function trustedComment(id: string): ExternalComment {
  return { id, threadRootId: null, author: sam, trusted: true, body: 'Please also handle null.', path: null, line: null, side: null, commitSha: null };
}

const send = (who = maya, jobId = 'job-a1'): DomainEvent => ({ type: 'draft_send', who, jobId });
const discard = (who = maya, jobId = 'job-a1'): DomainEvent => ({ type: 'draft_discard', who, jobId });
const bodies = (out: DecideOutput) => out.timeline.map((i) => i.body);

describe('a job that finishes in draft mode', () => {
  it("joins the chat's waiting drafts, and the chat stays idle until the reviewer decides", () => {
    const chat = agentToAgent({ phase: 'reviewing', participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { auto: false })], jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { applyState: 'draft' })] });
    const stored = result({ points: [newPoint()] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-r1', attempt: 1, result: stored });
    expect(out.chat.drafts).toEqual([{ jobId: 'job-r1', participantGithubId: leo.githubId, role: 'reviewer', jobType: 'review', headSha: 'head1', result: stored }]);
    expect(out.chat.participants[1]!.attention).toBe('drafts');
    expect(out.chat.phase).toBe('idle');
  });

  it("leaves the author's turn waiting for her when it's an address pass", () => {
    const chat = authorDraft({ drafts: [], participants: [participantOf(maya, 'author', { auto: false }), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })], jobs: [jobOf('job-a1', maya, 'author', 'address', { applyState: 'draft' })] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-a1', attempt: 1, result: draftedFixes });
    expect(out.chat.drafts.map((d) => d.jobId)).toEqual(['job-a1']);
    expect(out.chat.phase).toBe('addressing');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });
});

describe('a waiting draft holds that person\'s other work', () => {
  it('the author gets no second address job when a new trusted comment arrives', () => {
    const commented = run(authorDraft(), { type: 'external_comment', comment: trustedComment('c-1') });
    expect(commented.chat.points.map((p) => p.number)).toEqual([1, 2, 3]);
    const timer = run(commented.chat, { type: 'timer', key: 'comments' });
    expect(commandsOf(commented, 'enqueue_job')).toEqual([]);
    expect(commandsOf(timer, 'enqueue_job')).toEqual([]);
    expect(timer.chat.phase).toBe('addressing');
  });

  it('a reviewer gets no new review when asked again on GitHub', () => {
    const out = run(reviewerDraft(), { type: 'review_requested', reviewer: leo });
    expect(bodies(out)).toEqual(['Review requested from leo']);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(out.chat.participants[1]!.attention).toBe('drafts');
  });
});

describe('Send on a reviewer draft', () => {
  it('puts its points in the chat (agent-to-agent), then queues the author\'s address job', () => {
    const out = run(reviewerDraft(), send(leo, 'job-r1'));
    expect(commandsOf(out, 'set_apply_state')).toEqual([{ type: 'set_apply_state', jobId: 'job-r1', applyState: 'applied' }]);
    expect(out.chat.points.map((p) => [p.number, p.status, p.raisedBy, p.jobId, p.commitSha])).toEqual([
      [1, 'open', leo.githubId, 'job-r1', 'head1'],
      [2, 'open', leo.githubId, 'job-r1', 'head1'],
    ]);
    expect(bodies(out)).toEqual(['leo sent the drafted review', 'Two problems.', '`parseOrder` crashes on empty input', 'Rename', "maya's agent will work on 2 points"]);
    expect(out.chat.participants[1]).toMatchObject({ attention: 'none', lastReviewedSha: 'head1' });
    expect(out.chat.drafts).toEqual([]);
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ participant: { githubId: maya.githubId, role: 'author' }, jobType: 'address' })]);
    expect(commandsOf(out, 'post_review')).toEqual([]);
    expect(out.chat.phase).toBe('addressing');
  });

  it('posts them as one GitHub review when the author is not on Nitpilot (single-player)', () => {
    const tom = person('tom', { userId: null });
    const chat = reviewerDraft({ authorGithubId: tom.githubId, participants: [participantOf(tom, 'author'), participantOf(leo, 'reviewer', { auto: false, attention: 'drafts' })] });
    const out = run(chat, send(leo, 'job-r1'));
    expect(commandsOf(out, 'post_review')).toEqual([{ type: 'post_review', reviewerGithubId: leo.githubId, pointNumbers: [1, 2] }]);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(out.chat.phase).toBe('addressing'); // the human author's turn
  });
});

describe('Send on an author draft', () => {
  it('queues a publish job for the draft; the draft keeps waiting until that job ends', () => {
    const out = run(authorDraft(), send());
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: maya.githubId, role: 'author' }, jobType: 'publish', round: 1, sinceSha: null, applyState: 'pending', draftOfId: 'job-a1' },
    ]);
    expect(commandsOf(out, 'set_apply_state')).toEqual([]);
    expect(bodies(out)).toEqual(['maya is sending the drafted fixes']);
    expect(out.timeline[0]!.data).toEqual({ jobId: 'job-a1' });
    expect(out.chat.participants[0]!.attention).toBe('drafts');
    expect(out.chat.drafts.map((d) => d.jobId)).toEqual(['job-a1']);
    expect(out.chat.phase).toBe('addressing');
  });

  it('applies a draft with no commit at once (the agent only answered or declined): nothing to push, so no publish job', () => {
    const answered = result({ summary: 'Answered both.', replies: [{ point: 1, resolution: 'answered', comment: 'It is guarded upstream.' }, { point: 2, resolution: 'declined', comment: 'The name is on purpose.' }], push: null, draft: null });
    const out = run(authorDraft({ drafts: [draftOf('job-a1', maya, 'author', 'address', { result: answered })] }), send());
    expect(commandsOf(out, 'enqueue_job').filter((c) => c.jobType === 'publish')).toEqual([]);
    expect(commandsOf(out, 'set_apply_state')).toEqual([{ type: 'set_apply_state', jobId: 'job-a1', applyState: 'applied' }]);
    // As an auto address pass that changed no file: the summary and the replies, with no commit.
    expect(bodies(out)[0]).toBe('maya sent the drafted replies');
    expect(out.timeline[1]).toMatchObject({ kind: 'job_summary', jobId: 'job-a1', body: 'Answered both.', data: { jobType: 'address', push: null } });
    expect(out.timeline.filter((i) => i.kind === 'point_reply').map((i) => i.data)).toEqual([
      { resolution: 'answered', commit: null },
      { resolution: 'declined', commit: null },
    ]);
    expect(out.chat).toMatchObject({ headSha: 'head1', addressPasses: 1, round: 2, drafts: [] });
    expect(out.chat.participants[0]!.attention).toBe('none');
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ participant: { githubId: leo.githubId, role: 'reviewer' }, jobType: 're_review' })]);
  });

  it('when the publish job pushes, applies the stored replies with the pushed commit and starts the re-review', () => {
    const push = { from: 'head1', to: 'abc1234def' };
    const out = run(publishing('running'), { type: 'job_completed', jobId: 'job-p1', attempt: 1, result: result({ summary: 'Pushed.', push }) });
    expect(commandsOf(out, 'complete_job')).toEqual([{ type: 'complete_job', jobId: 'job-p1', applyState: 'applied', result: result({ summary: 'Pushed.', push }) }]);
    expect(commandsOf(out, 'set_apply_state')).toEqual([{ type: 'set_apply_state', jobId: 'job-a1', applyState: 'applied' }]);
    // The stored summary and replies, as the draft job's own items; the commit is the one just pushed.
    expect(out.timeline[0]).toMatchObject({ kind: 'job_summary', jobId: 'job-a1', body: 'Fixed both.', data: { jobType: 'address', push } });
    expect(bodies(out)).toContain("maya's agent pushed abc1234");
    expect(out.timeline.filter((i) => i.kind === 'point_reply').map((i) => i.data)).toEqual([
      { resolution: 'fixed', commit: 'abc1234def' },
      { resolution: 'answered', commit: 'abc1234def' },
    ]);
    expect(out.chat.points.map((p) => [p.status, p.authorResolution])).toEqual([['addressed', 'fixed'], ['addressed', 'answered']]);
    expect(out.chat).toMatchObject({ headSha: 'abc1234def', addressPasses: 1, round: 2, drafts: [] });
    expect(out.chat.participants[0]!.attention).toBe('none');
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ participant: { githubId: leo.githubId, role: 'reviewer' }, jobType: 're_review', sinceSha: 'head1' })]);
    expect(out.chat.phase).toBe('reviewing');
  });

  it.each([
    ['branch_moved', true, 'The drafted fixes are out of date: the branch moved'],
    ['branch_moved', false, 'The drafted fixes are out of date: the branch moved'],
    // The CLI's draft ref is missing or moved (spec §11): it won't work again.
    ['setup_failed', false, 'The drafted fixes are out of date: the draft commit is gone from that computer'],
  ] as const)('%s (retryable: %s): the draft is out of date, and the chat carries on with a new address pass', (reason, retryable, line) => {
    const out = run(publishing('running'), { type: 'job_failed', jobId: 'job-p1', attempt: 1, reason, retryable });
    expect(commandsOf(out, 'retry_job')).toEqual([]);
    expect(commandsOf(out, 'fail_job')).toEqual([{ type: 'fail_job', jobId: 'job-p1', reason }]);
    expect(commandsOf(out, 'set_apply_state')).toEqual([{ type: 'set_apply_state', jobId: 'job-a1', applyState: 'discarded' }]);
    expect(bodies(out)).toEqual([line, "maya's agent will work on 2 points"]);
    expect(out.timeline[0]!.data).toEqual({ jobId: 'job-a1', reason });
    expect(out.chat.drafts).toEqual([]);
    expect(out.chat.participants[0]).toMatchObject({ attention: 'none', byHand: false });
    // Auto-fix is still off, so the new pass makes a new draft.
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ jobType: 'address', applyState: 'draft', draftOfId: null })]);
  });

  it('retries a setup_failed that may work next time (the server could not build the bundle), and the draft keeps waiting', () => {
    const out = run(publishing('running'), { type: 'job_failed', jobId: 'job-p1', attempt: 1, reason: 'setup_failed', retryable: true });
    expect(commandsOf(out, 'retry_job')).toEqual([expect.objectContaining({ jobId: 'job-p1', refundAttempt: false, reason: 'setup_failed' })]);
    expect(commandsOf(out, 'fail_job')).toEqual([]);
    expect(commandsOf(out, 'set_apply_state')).toEqual([]);
    expect(bodies(out)).toEqual([]);
    expect(out.chat.drafts.map((d) => d.jobId)).toEqual(['job-a1']);
    expect(out.chat.participants[0]!.attention).toBe('drafts');
  });

  it('follows the usual retries for any other failure', () => {
    const out = run(publishing('running'), { type: 'job_failed', jobId: 'job-p1', attempt: 1, reason: 'timeout', retryable: true });
    expect(commandsOf(out, 'retry_job')).toEqual([expect.objectContaining({ jobId: 'job-p1', refundAttempt: false, reason: 'timeout' })]);
    expect(out.chat.drafts.map((d) => d.jobId)).toEqual(['job-a1']);
  });

  it('leaves the draft waiting for Send or Discard when the publish job fails for good', () => {
    const chat = publishing('running');
    chat.jobs[0]!.attempt = 3;
    const out = run(chat, { type: 'job_failed', jobId: 'job-p1', attempt: 3, reason: 'git_error', retryable: true });
    expect(commandsOf(out, 'fail_job')).toEqual([{ type: 'fail_job', jobId: 'job-p1', reason: 'git_error' }]);
    expect(bodies(out)).toEqual(["Couldn't send maya's drafted fixes (git error)"]);
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-maya'], kind: 'failed', pointNumbers: [] }]);
    expect(commandsOf(out, 'set_apply_state')).toEqual([]);
    expect(out.chat.participants[0]!.attention).toBe('drafts');
    // So Send works again.
    expect(commandsOf(run(out.chat, send()), 'enqueue_job')).toEqual([expect.objectContaining({ jobType: 'publish', draftOfId: 'job-a1' })]);
  });
});

describe('Discard', () => {
  it("on a reviewer draft counts as having reviewed that commit: nothing is raised, and the chat is ready", () => {
    const out = run(reviewerDraft(), discard(leo, 'job-r1'));
    expect(commandsOf(out, 'set_apply_state')).toEqual([{ type: 'set_apply_state', jobId: 'job-r1', applyState: 'discarded' }]);
    expect(out.chat.points).toEqual([]);
    expect(out.chat.participants[1]).toMatchObject({ attention: 'none', lastReviewedSha: 'head1' });
    expect(out.chat.drafts).toEqual([]);
    expect(bodies(out)).toEqual(['leo discarded the drafted review', 'Ready for approval']);
    expect(out.chat.phase).toBe('ready');
    // leo is the only requested reviewer, and his own Discard made it ready: nobody needs telling.
    expect(commandsOf(out, 'notify')).toEqual([]);
  });

  it('on an author draft makes the open points her turn by hand: no address job starts', () => {
    const out = run(authorDraft(), discard());
    expect(commandsOf(out, 'set_apply_state')).toEqual([{ type: 'set_apply_state', jobId: 'job-a1', applyState: 'discarded' }]);
    expect(out.chat.participants[0]).toMatchObject({ attention: 'none', byHand: true });
    expect(out.chat.drafts).toEqual([]);
    expect(bodies(out)).toEqual(['maya discarded the drafted fixes']);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(out.chat.phase).toBe('addressing');
  });

  it('cancels the publish job when it is still queued', () => {
    const out = run(publishing('queued'), discard());
    expect(commandsOf(out, 'cancel_jobs')).toEqual([{ type: 'cancel_jobs', jobIds: ['job-p1'], reason: 'draft_discarded' }]);
    expect(commandsOf(out, 'set_apply_state')).toEqual([{ type: 'set_apply_state', jobId: 'job-a1', applyState: 'discarded' }]);
    expect(out.chat.participants[0]).toMatchObject({ attention: 'none', byHand: true });
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });
});

describe("a reviewer's waiting draft when they leave the review", () => {
  it('is discarded when they are removed from the PR: nothing is raised, and their attention is cleared', () => {
    const out = run(reviewerDraft(), { type: 'review_request_removed', reviewer: leo });
    expect(commandsOf(out, 'set_apply_state')).toEqual([{ type: 'set_apply_state', jobId: 'job-r1', applyState: 'discarded' }]);
    expect(out.chat.drafts).toEqual([]);
    expect(out.chat.points).toEqual([]);
    expect(out.chat.participants[1]).toMatchObject({ requested: false, attention: 'none' });
    expect(bodies(out)).toEqual(['leo is no longer a reviewer']);
  });

  it('keeps waiting when they approve on GitHub', () => {
    const out = run(reviewerDraft(), { type: 'external_review_submitted', review: { id: 'rv-1', author: leo, trusted: true, state: 'approved', body: '', comments: [] } });
    expect(commandsOf(out, 'set_apply_state')).toEqual([]);
    expect(out.chat.drafts.map((d) => d.jobId)).toEqual(['job-r1']);
    expect(out.chat.participants[1]).toMatchObject({ requested: false, attention: 'drafts' });
  });
});

describe('Auto off + Discard never loops', () => {
  const discarded = () => run(authorDraft(), discard()).chat;

  it('starts no address job on the next unrelated events', () => {
    let chat = discarded();
    const outsider = person('stranger', { userId: null });
    const untrusted: ExternalComment = { ...trustedComment('c-9'), author: outsider, trusted: false };
    const events: DomainEvent[] = [{ type: 'timer', key: 'comments' }, { type: 'external_comment', comment: untrusted }, { type: 'timer', key: 'comments' }];
    for (const event of events) {
      const out = run(chat, event);
      expect(commandsOf(out, 'enqueue_job')).toEqual([]);
      chat = out.chat;
    }
    expect(chat.participants[0]!.byHand).toBe(true);
  });

  it('a new trusted comment hands the points back to her agent', () => {
    const commented = run(discarded(), { type: 'external_comment', comment: trustedComment('c-1') });
    expect(commented.chat.participants[0]!.byHand).toBe(false);
    const timer = run(commented.chat, { type: 'timer', key: 'comments' });
    expect(commandsOf(timer, 'enqueue_job')).toEqual([expect.objectContaining({ jobType: 'address', applyState: 'draft' })]);
  });

  it('so does Continue on an escalated point', () => {
    const chat = discarded();
    chat.points[0] = { ...chat.points[0]!, status: 'escalated', escalationReason: 'disagreement' };
    const out = run(chat, { type: 'point_continue', who: maya, point: 1 });
    expect(out.chat.participants[0]!.byHand).toBe(false);
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ jobType: 'address' })]);
  });

  it('so does turning Auto-fix on', () => {
    const out = run(discarded(), { type: 'auto_changed', who: maya, role: 'author', on: true });
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ jobType: 'address', applyState: 'pending' })]);
  });

  it("so does a push that isn't ours: leo's agent re-reviews it once the pushes stop, as for a human author", () => {
    const out = run(discarded(), { type: 'head_updated', before: 'head1', after: 'head2', ours: false });
    expect(out.chat.participants[0]!.byHand).toBe(false);
    expect(commandsOf(out, 'schedule')).toEqual([expect.objectContaining({ key: `sync:${leo.githubId}` })]);
  });
});

describe('Send and Discard that no longer apply change nothing (Review Focus 3)', () => {
  const afterReviewerSend = () => run(reviewerDraft(), send(leo, 'job-r1')).chat;
  const afterDiscard = () => run(authorDraft(), discard()).chat;
  const afterPublish = () => run(publishing('running'), { type: 'job_completed', jobId: 'job-p1', attempt: 1, result: result({ push: { from: 'head1', to: 'abc1234def' } }) }).chat;

  it.each([
    ['a second Send while the publish job is queued', () => publishing('queued'), send()],
    ['a second Send while the publish job is running', () => publishing('running'), send()],
    ['a second Send of a reviewer draft', afterReviewerSend, send(leo, 'job-r1')],
    ['Send after Discard', afterDiscard, send()],
    ['Discard after Discard', afterDiscard, discard()],
    ['Discard after the publish job pushed', afterPublish, discard()],
    ['Discard while the publish job is running: the push may be under way', () => publishing('running'), discard()],
    ["Send on someone else's draft", () => reviewerDraft(), send(maya, 'job-r1')],
    ["Discard on someone else's draft", () => authorDraft(), discard(leo)],
    ['Send on a job that is no draft', () => authorDraft(), send(maya, 'job-x')],
    ['Send on a closed PR', () => authorDraft({ phase: 'closed', closed: true }), send()],
    ['Discard on a closed PR', () => reviewerDraft({ phase: 'closed', closed: true }), discard(leo, 'job-r1')],
  ])('%s', (_case, chatBefore, event) => {
    const chat = chatBefore();
    const out = run(chat, event);
    expect(out.timeline).toEqual([]);
    expect(out.commands).toEqual([]);
    expect(out.chat).toEqual(chat);
  });
});
