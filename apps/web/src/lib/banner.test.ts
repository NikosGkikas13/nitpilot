import type { ChatView, PointView, WebMe } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { chatView, point } from '../test/chat';
import { chatBanner, escalationNote } from './banner';

const me: WebMe = { id: 'u1', githubId: '1001', login: 'maya', avatarUrl: null, githubAuth: 'ok', agentOnline: true, settings: { autoReview: true, autoAddress: true, dailyJobCap: 40 }, usedToday: 0 };
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
    expect(chatBanner(view({ viewer: { role: 'author', attention: 'failed', failure: 'agent' } }), me).kind).toBe('failed_job');
    expect(chatBanner(view({ viewer: { role: 'author', attention: 'failed', failure: 'github_post' } }), me).kind).toBe('failed_post');
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
    expect(chatBanner(view({ ...ready, viewer: { role: 'reviewer', attention: 'none', failure: null } }), me)).toEqual({ kind: 'ready_reviewer', rounds: 2, resolved: 2 });
    expect(chatBanner(view({ ...ready, viewer: { role: 'author', attention: 'none', failure: null } }), me)).toEqual({ kind: 'ready_author', reviewer: 'leo', rounds: 2, resolved: 2 });
    expect(chatBanner(view({ ...ready, viewer: { role: null, attention: 'none', failure: null } }), me)).toEqual({ kind: 'none' });
  });

  it('puts an escalation before a failure, a failure before waiting, waiting before ready, and shows nothing on a closed PR', () => {
    const everything = view({
      phase: 'ready',
      points: [escalated()],
      viewer: { role: 'author', attention: 'failed', failure: 'agent' },
      activity: { kind: 'agent_waiting', who: 'maya', why: 'offline', offlineSince: null },
    });
    expect(chatBanner(everything, me).kind).toBe('escalated');
    expect(chatBanner({ ...everything, points: [] }, me).kind).toBe('failed_job');
    expect(chatBanner({ ...everything, points: [], viewer: { role: 'author', attention: 'none', failure: null } }, me).kind).toBe('waiting');
    expect(chatBanner({ ...everything, closed: true }, me).kind).toBe('none');
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
