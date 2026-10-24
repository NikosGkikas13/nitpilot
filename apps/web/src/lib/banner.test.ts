import { FailureReason, type ChatView, type PointView, type WebMe } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { authorDraft, chatView, point } from '../test/chat';
import { chatBanner, escalationNote, failureText } from './banner';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0, push: { vapidPublicKey: null, subscribed: false }, onboarded: true };
const view = (over: Partial<ChatView> = {}) => chatView(over);
const escalated = (over: Partial<PointView> = {}) => point({ status: 'escalated', escalationReason: 'category', category: 'security', ...over });

describe('chatBanner (handoff §2 "Banners")', () => {
  it('asks to reconnect GitHub before anything else', () => {
    expect(chatBanner(view({ points: [escalated()] }), { ...me, githubAuth: 'needs_reauth' }).kind).toBe('github_expired');
  });

  it('lists the escalated points, with why they went to a person', () => {
    const banner = chatBanner(view({ phase: 'escalated', points: [escalated(), point({ number: 2 })] }), me);
    expect(banner).toEqual({ kind: 'escalated', points: [escalated()], note: 'Security points always go to a person.' });
  });

  it('tells a failed job from a failed post in your name', () => {
    expect(chatBanner(view({ viewer: { role: 'author', attention: 'failed', failure: 'agent', failureReason: null } }), me).kind).toBe('failed_job');
    expect(chatBanner(view({ viewer: { role: 'author', attention: 'failed', failure: 'github_post', failureReason: null } }), me).kind).toBe('failed_post');
  });

  it("says why your agent can't start: the daily cap, a repo not linked, or offline", () => {
    const waiting = (why: 'offline' | 'repo_not_linked' | 'cap_reached', who = 'maya') => view({ activity: { kind: 'agent_waiting', who, why, offlineSince: why === 'offline' ? '2026-10-16T18:04:00.000Z' : null } });
    expect(chatBanner(waiting('cap_reached'), me)).toEqual({ kind: 'cap' });
    expect(chatBanner(waiting('repo_not_linked'), me)).toEqual({ kind: 'repo_not_linked', repo: 'acme/shop-api' });
    expect(chatBanner(waiting('offline'), me)).toEqual({ kind: 'waiting', offlineSince: '2026-10-16T18:04:00.000Z' });
    // Someone else's agent waiting is their banner, not yours.
    expect(chatBanner(waiting('offline', 'leo'), me)).toEqual({ kind: 'none' });
  });

  it('shows ready to the reviewer as theirs to approve, and to the author as waiting for the reviewer', () => {
    const ready = { phase: 'ready' as const, round: 2, points: [point({ status: 'resolved' }), point({ number: 2, status: 'resolved' })] };
    expect(chatBanner(view({ ...ready, viewer: { role: 'reviewer', attention: 'none', failure: null, failureReason: null } }), me)).toEqual({ kind: 'ready_reviewer', rounds: 2, resolved: 2 });
    expect(chatBanner(view({ ...ready, viewer: { role: 'author', attention: 'none', failure: null, failureReason: null } }), me)).toEqual({ kind: 'ready_author', reviewer: 'leo', rounds: 2, resolved: 2 });
    expect(chatBanner(view({ ...ready, viewer: { role: null, attention: 'none', failure: null, failureReason: null } }), me)).toEqual({ kind: 'none' });
  });

  it('puts an escalation before a failure, a failure before waiting, waiting before ready, and shows nothing on a closed PR', () => {
    const everything = view({
      phase: 'ready',
      points: [escalated()],
      viewer: { role: 'author', attention: 'failed', failure: 'agent', failureReason: null },
      activity: { kind: 'agent_waiting', who: 'maya', why: 'offline', offlineSince: null },
    });
    expect(chatBanner(everything, me).kind).toBe('escalated');
    expect(chatBanner({ ...everything, points: [] }, me).kind).toBe('failed_job');
    expect(chatBanner({ ...everything, points: [], viewer: { role: 'author', attention: 'none', failure: null, failureReason: null } }, me).kind).toBe('waiting');
    expect(chatBanner({ ...everything, closed: true }, me).kind).toBe('none');
  });
});

describe('failureText', () => {
  it('explains a failed job in words', () => {
    expect(failureText('quota')).toBe('Your agent ran out of usage for now. Retry once your plan resets.');
    expect(failureText('auth')).toBe("Your agent isn't signed in on that computer. Sign it in, then Retry.");
    expect(failureText('stale_head')).toBe('The PR moved on while your agent was working, so nothing was pushed.');
    expect(failureText('timeout')).toBe('Your agent took too long and was stopped.');
    expect(failureText('branch_moved')).toBe('Someone pushed to the branch while your agent was working.');
    expect(Object.values(FailureReason.enum).every((r) => failureText(r).length > 0)).toBe(true);
  });
});

describe('the drafts banner', () => {
  const mine = (jobId: string, over = {}) => authorDraft({ jobId, owner: 'maya', ...over });
  it('shows a banner for your waiting drafts', () => {
    expect(chatBanner(view({ drafts: [mine('job_7')] }), me)).toEqual({ kind: 'drafts', count: 1, firstJobId: 'job_7' });
    expect(chatBanner(view({ drafts: [mine('job_7'), mine('job_8')] }), me)).toEqual({ kind: 'drafts', count: 2, firstJobId: 'job_7' });
  });
  it("targets your own first draft even when someone else's comes before it", () => {
    expect(chatBanner(view({ drafts: [mine('job_6', { owner: 'leo' }), mine('job_7'), mine('job_8')] }), me)).toEqual({ kind: 'drafts', count: 2, firstJobId: 'job_7' });
  });
  it("ignores someone else's drafts and ones already being sent", () => {
    expect(chatBanner(view({ drafts: [mine('job_7', { owner: 'leo' })] }), me)).toEqual({ kind: 'none' });
    expect(chatBanner(view({ drafts: [mine('job_7', { sending: true })] }), me)).toEqual({ kind: 'none' });
  });
  it('an escalation still beats your drafts, and your drafts beat waiting', () => {
    expect(chatBanner(view({ phase: 'escalated', points: [escalated()], drafts: [mine('job_7')] }), me).kind).toBe('escalated');
    const offline = { kind: 'agent_waiting' as const, who: 'maya', why: 'offline' as const, offlineSince: null };
    expect(chatBanner(view({ activity: offline, drafts: [mine('job_7')] }), me).kind).toBe('drafts');
  });
  it('a failure, the cap and a repo that is not linked all beat your drafts', () => {
    const waiting = (why: 'repo_not_linked' | 'cap_reached') => ({ kind: 'agent_waiting' as const, who: 'maya', why, offlineSince: null });
    expect(chatBanner(view({ viewer: { role: 'author', attention: 'failed', failure: 'agent', failureReason: null }, drafts: [mine('job_7')] }), me).kind).toBe('failed_job');
    expect(chatBanner(view({ activity: waiting('cap_reached'), drafts: [mine('job_7')] }), me).kind).toBe('cap');
    expect(chatBanner(view({ activity: waiting('repo_not_linked'), drafts: [mine('job_7')] }), me).kind).toBe('repo_not_linked');
  });
});

describe('escalationNote', () => {
  it('names the categories, a disagreement, or the round limit', () => {
    expect(escalationNote([escalated(), escalated({ number: 2, category: 'bug' })], 3)).toBe('Security and bug points always go to a person.');
    expect(escalationNote([escalated({ escalationReason: 'disagreement' })], 3)).toBe("The agents don't agree.");
    expect(escalationNote([escalated({ escalationReason: 'round_limit' })], 3)).toBe('The agents used all 3 rounds.');
    expect(escalationNote([escalated(), escalated({ number: 2, escalationReason: 'disagreement' })], 3)).toBe('These points need a person.');
  });
});
