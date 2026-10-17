import { describe, expect, it } from 'vitest';
import {
  agentToAgent, chatState, commandsOf, jobOf, leo, maya, participantOf, pointOf, run, sam,
} from './test-builders';

describe('pr_opened', () => {
  it('queues a review for a requested reviewer who uses Nitpilot', () => {
    const out = run(chatState(), { type: 'pr_opened', author: maya, reviewers: [leo] });
    expect(out.chat.phase).toBe('reviewing');
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: leo.githubId, role: 'reviewer' }, jobType: 'review', round: 1, sinceSha: null, applyState: 'pending' },
    ]);
    expect(out.chat.participants.map((p) => [p.login, p.role, p.requested])).toEqual([
      ['maya', 'author', false],
      ['leo', 'reviewer', true],
    ]);
  });

  it('changes nothing for a chat that has had its "opened" (a catch-up and a webhook met the same PR)', () => {
    const chat = agentToAgent({ participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer')] });
    const out = run(chat, { type: 'pr_opened', author: maya, reviewers: [leo] });
    expect(out.timeline).toEqual([]);
    expect(out.commands).toEqual([]);
  });

  it('stays idle when no reviewer uses Nitpilot', () => {
    const out = run(chatState(), { type: 'pr_opened', author: maya, reviewers: [sam] });
    expect(out.chat.phase).toBe('idle');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it('stays idle for a draft PR', () => {
    const out = run(chatState({ isDraft: true }), { type: 'pr_opened', author: maya, reviewers: [leo] });
    expect(out.chat.phase).toBe('idle');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it('waits for a manual review when the PR is from an outside contributor', () => {
    const out = run(chatState({ trusted: false }), { type: 'pr_opened', author: maya, reviewers: [leo] });
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('manual_review');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'manual_review', pointNumbers: [] }]);
  });

  it('queues a draft-mode review when the team turned auto-review off', () => {
    const out = run(chatState(), { type: 'pr_opened', author: maya, reviewers: [leo] }, { rules: { auto: { review: false, address: true } } });
    expect(commandsOf(out, 'enqueue_job')[0]!.applyState).toBe('draft');
  });
});

describe('manual_review', () => {
  it('starts the review the trust gate held back and clears the attention', () => {
    const chat = chatState({ trusted: false, participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { attention: 'manual_review' })] });
    const out = run(chat, { type: 'manual_review', reviewer: leo });
    expect(commandsOf(out, 'enqueue_job')).toHaveLength(1);
    expect(out.chat.participants[1]!.attention).toBe('none');
    expect(out.chat.phase).toBe('reviewing');
  });
});

describe('review_requested', () => {
  it('queues a re-review from the last reviewed commit for someone who reviewed before', () => {
    const chat = agentToAgent({ participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { requested: false, lastReviewedSha: 'head0' })] });
    const out = run(chat, { type: 'review_requested', reviewer: leo });
    expect(commandsOf(out, 'enqueue_job')[0]).toMatchObject({ jobType: 're_review', sinceSha: 'head0' });
  });

  it('does not queue a second job for a busy reviewer', () => {
    const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-1', leo, 'reviewer', 'review')] });
    const out = run(chat, { type: 'review_requested', reviewer: leo });
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it("waits while the author's agent is fixing", () => {
    const chat = agentToAgent({ phase: 'addressing', participants: [participantOf(maya, 'author')], jobs: [jobOf('job-a', maya, 'author', 'address')] });
    const out = run(chat, { type: 'review_requested', reviewer: leo });
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.requested).toBe(true);
  });
});

describe('review_request_removed', () => {
  it("cancels the reviewer's job, withdraws their points and settles", () => {
    const chat = agentToAgent({
      phase: 'reviewing',
      points: [pointOf(1, leo)],
      jobs: [jobOf('job-rr', leo, 'reviewer', 're_review')],
    });
    const out = run(chat, { type: 'review_request_removed', reviewer: leo });
    expect(commandsOf(out, 'cancel_jobs')).toEqual([{ type: 'cancel_jobs', jobIds: ['job-rr'], reason: 'reviewer_removed' }]);
    expect(out.chat.points[0]!.status).toBe('resolved');
    expect(out.chat.phase).toBe('ready');
    // leo is no longer a reviewer, so nobody is told it's ready.
    expect(commandsOf(out, 'notify')).toEqual([]);
  });
});

describe('closing, reopening and drafts', () => {
  it('cancels active jobs when the PR closes', () => {
    const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-1', leo, 'reviewer', 'review')] });
    const out = run(chat, { type: 'pr_closed', merged: true });
    expect(out.chat).toMatchObject({ phase: 'closed', closed: true, merged: true });
    expect(commandsOf(out, 'cancel_jobs')).toEqual([{ type: 'cancel_jobs', jobIds: ['job-1'], reason: 'pr_closed' }]);
  });

  it('restarts with a re-review when reopened', () => {
    const chat = agentToAgent({
      phase: 'closed',
      closed: true,
      participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
    });
    const out = run(chat, { type: 'pr_reopened' });
    expect(out.chat.closed).toBe(false);
    expect(commandsOf(out, 'enqueue_job')[0]).toMatchObject({ jobType: 're_review', sinceSha: 'head1' });
  });

  it('pauses on draft and starts again when ready', () => {
    const reviewing = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-1', leo, 'reviewer', 'review')] });
    const drafted = run(reviewing, { type: 'pr_to_draft' });
    expect(drafted.chat.phase).toBe('idle');
    expect(commandsOf(drafted, 'cancel_jobs')).toHaveLength(1);

    const ready = run(drafted.chat, { type: 'pr_ready' });
    expect(ready.chat.phase).toBe('reviewing');
    expect(commandsOf(ready, 'enqueue_job')).toHaveLength(1);
  });
});

describe('human_note', () => {
  it('adds a human message and changes nothing else', () => {
    const chat = agentToAgent({ phase: 'reviewing' });
    const out = run(chat, { type: 'human_note', author: maya, body: 'Keep the public API stable.' });
    expect(out.timeline).toEqual([{ kind: 'human', author: { githubId: maya.githubId, login: 'maya' }, pointNumber: null, jobId: null, body: 'Keep the public API stable.', data: null }]);
    expect(out.chat).toEqual(chat);
  });

  it('adds nothing on a closed PR: its chat is read-only', () => {
    const out = run(agentToAgent({ phase: 'closed', closed: true }), { type: 'human_note', author: maya, body: 'Too late?' });
    expect(out.timeline).toEqual([]);
  });
});

describe('decide()', () => {
  it('never changes its input', () => {
    const chat = agentToAgent({ points: [pointOf(1, leo)] });
    const before = structuredClone(chat);
    run(chat, { type: 'pr_closed', merged: false });
    expect(chat).toEqual(before);
  });

  it('asks for a summary update in agent-to-agent mode once agent points exist', () => {
    const out = run(agentToAgent({ points: [pointOf(1, leo)] }), { type: 'human_note', author: maya, body: 'hi' });
    expect(commandsOf(out, 'upsert_summary')).toHaveLength(1);
  });

  it('never asks for a summary when the author is not on Nitpilot', () => {
    const chat = agentToAgent({ participants: [participantOf({ ...maya, userId: null }, 'author'), participantOf(leo, 'reviewer')], points: [pointOf(1, leo)] });
    const out = run(chat, { type: 'human_note', author: leo, body: 'hi' });
    expect(commandsOf(out, 'upsert_summary')).toEqual([]);
  });
});

describe('pr_retargeted', () => {
  it('says which branch the PR now targets', () => {
    const out = run(chatState(), { type: 'pr_retargeted', baseRef: 'release', trusted: true });
    expect(out.timeline).toEqual([expect.objectContaining({ kind: 'system', body: 'Now targets release' })]);
  });

  it('checks again whether the author is trusted', () => {
    expect(run(chatState({ trusted: true }), { type: 'pr_retargeted', baseRef: 'release', trusted: false }).chat.trusted).toBe(false);
    expect(run(chatState({ trusted: false }), { type: 'pr_retargeted', baseRef: 'main', trusted: true }).chat.trusted).toBe(true);
  });
});
