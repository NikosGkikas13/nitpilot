import { describe, expect, it } from 'vitest';
import {
  agentToAgent, chatState, commandsOf, draftOf, jobOf, leo, maya, participantOf, pointOf, run, sam,
} from './test-builders';
import type { ChatState, Person } from './types';

/** The same person, with their Auto defaults for new chats (`User.autoReview` / `autoAddress`). */
function withDefaults(p: Person, review: boolean, address: boolean): Person {
  return { ...p, autoDefaults: { review, address } };
}

describe('Auto defaults for new participants', () => {
  it('a reviewer whose Auto-review default is off gets a draft job on their first review', () => {
    const out = run(chatState(), { type: 'pr_opened', author: maya, reviewers: [withDefaults(leo, false, true)] });
    expect(out.chat.participants.map((p) => [p.login, p.role, p.auto])).toEqual([['maya', 'author', true], ['leo', 'reviewer', false]]);
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ jobType: 'review', applyState: 'draft' })]);
  });

  it('the author starts with their Auto-fix default, and a reviewer requested later with their Auto-review one', () => {
    const opened = run(chatState(), { type: 'pr_opened', author: withDefaults(maya, true, false), reviewers: [] }).chat;
    expect(opened.participants[0]).toMatchObject({ role: 'author', auto: false });
    const out = run(opened, { type: 'review_requested', reviewer: withDefaults(leo, false, true) });
    expect(out.chat.participants[1]).toMatchObject({ role: 'reviewer', auto: false });
    expect(commandsOf(out, 'enqueue_job')[0]!.applyState).toBe('draft');
  });

  it('starts with Auto on for someone not on Nitpilot (no defaults), as the column default', () => {
    const out = run(chatState(), { type: 'pr_opened', author: maya, reviewers: [sam] });
    expect(out.chat.participants[1]).toMatchObject({ login: 'sam', auto: true });
  });

  it('keeps the switch someone already set in this chat', () => {
    const chat = agentToAgent({ participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { auto: false })] });
    const out = run(chat, { type: 'review_requested', reviewer: withDefaults(leo, true, true) });
    expect(out.chat.participants[1]!.auto).toBe(false);
  });
});

/** leo's review is queued; maya and leo both have Auto on. */
function reviewQueued(over: Partial<ChatState> = {}): ChatState {
  return agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { status: 'queued', attempt: 0 })], ...over });
}

/** leo raised P1; maya's address job is queued as a draft, because her Auto-fix is off. */
function addressQueuedAsDraft(over: Partial<ChatState> = {}): ChatState {
  return agentToAgent({
    phase: 'addressing',
    participants: [participantOf(maya, 'author', { auto: false }), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
    points: [pointOf(1, leo)],
    jobs: [jobOf('job-a1', maya, 'author', 'address', { status: 'queued', attempt: 0, applyState: 'draft' })],
    ...over,
  });
}

describe('auto_changed', () => {
  it('turning Auto-review off makes the queued review a draft, with a line', () => {
    const out = run(reviewQueued(), { type: 'auto_changed', who: leo, role: 'reviewer', on: false });
    expect(out.chat.participants[1]!.auto).toBe(false);
    expect(out.commands).toEqual([{ type: 'set_apply_state', jobId: 'job-r1', applyState: 'draft' }]);
    expect(out.chat.jobs[0]!.applyState).toBe('draft');
    expect(out.timeline).toEqual([expect.objectContaining({ kind: 'system', body: 'leo turned Auto-review off', data: { role: 'reviewer', on: false } })]);
  });

  it('turning Auto-fix back on makes the queued address job apply its result', () => {
    const out = run(addressQueuedAsDraft(), { type: 'auto_changed', who: maya, role: 'author', on: true });
    expect(out.chat.participants[0]!.auto).toBe(true);
    expect(commandsOf(out, 'set_apply_state')).toEqual([{ type: 'set_apply_state', jobId: 'job-a1', applyState: 'pending' }]);
    expect(out.timeline.map((i) => i.body)).toEqual(['maya turned Auto-fix on']);
  });

  it('leaves a running job alone: it keeps the mode it started with', () => {
    const chat = reviewQueued({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review')] });
    const out = run(chat, { type: 'auto_changed', who: leo, role: 'reviewer', on: false });
    expect(out.chat.participants[1]!.auto).toBe(false);
    expect(commandsOf(out, 'set_apply_state')).toEqual([]);
    expect(out.chat.jobs[0]!.applyState).toBe('pending');
  });

  it('leaves a draft that already waits as a draft, and starts nothing else', () => {
    const chat = agentToAgent({
      participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { auto: false, attention: 'drafts' })],
      drafts: [draftOf('job-r1', leo, 'reviewer', 'review')],
    });
    const out = run(chat, { type: 'auto_changed', who: leo, role: 'reviewer', on: true });
    expect(out.chat.participants[1]).toMatchObject({ auto: true, attention: 'drafts' });
    expect(out.chat.drafts).toEqual(chat.drafts);
    expect(out.commands).toEqual([]);
  });

  it("doesn't touch a queued publish job: it sends a draft, it doesn't run an agent", () => {
    const chat = agentToAgent({
      phase: 'addressing',
      participants: [participantOf(maya, 'author', { auto: false, attention: 'drafts' }), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
      points: [pointOf(1, leo)],
      drafts: [draftOf('job-a1', maya, 'author', 'address')],
      jobs: [jobOf('job-p1', maya, 'author', 'publish', { status: 'queued', attempt: 0, draftOfId: 'job-a1' })],
    });
    const out = run(chat, { type: 'auto_changed', who: maya, role: 'author', on: true });
    expect(out.chat.participants[0]!.auto).toBe(true);
    expect(commandsOf(out, 'set_apply_state')).toEqual([]);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it('a team rule that forbids auto-fix wins over the switch: it turns on, and the queued job stays a draft', () => {
    const out = run(addressQueuedAsDraft(), { type: 'auto_changed', who: maya, role: 'author', on: true }, { rules: { auto: { review: true, address: false } } });
    expect(out.chat.participants[0]!.auto).toBe(true);
    expect(commandsOf(out, 'set_apply_state')).toEqual([]);
    expect(out.chat.jobs[0]!.applyState).toBe('draft');
  });

  it("turning Auto-fix on hands the open points back to the author's agent after a Discard", () => {
    const chat = agentToAgent({
      phase: 'addressing',
      participants: [participantOf(maya, 'author', { auto: false, byHand: true }), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
      points: [pointOf(1, leo)],
    });
    const out = run(chat, { type: 'auto_changed', who: maya, role: 'author', on: true });
    expect(out.chat.participants[0]).toMatchObject({ auto: true, byHand: false });
    expect(commandsOf(out, 'enqueue_job')).toEqual([expect.objectContaining({ participant: { githubId: maya.githubId, role: 'author' }, jobType: 'address', applyState: 'pending' })]);
    expect(out.timeline.map((i) => i.body)).toEqual(['maya turned Auto-fix on', "maya's agent will work on 1 point"]);
  });

  it.each([
    ["leo, for the author's switch (he isn't the author)", { who: leo, role: 'author' as const, on: false }, reviewQueued()],
    ["maya, for a reviewer's switch (she isn't one)", { who: maya, role: 'reviewer' as const, on: false }, reviewQueued()],
    ['leo, for the setting he already has', { who: leo, role: 'reviewer' as const, on: true }, reviewQueued()],
    ['leo, on a closed PR', { who: leo, role: 'reviewer' as const, on: false }, reviewQueued({ phase: 'closed', closed: true })],
  ])('changes nothing when asked by %s', (_who, change, chat) => {
    const out = run(chat, { type: 'auto_changed', ...change });
    expect(out.timeline).toEqual([]);
    expect(out.commands).toEqual([]);
    expect(out.chat).toEqual(chat);
  });
});
