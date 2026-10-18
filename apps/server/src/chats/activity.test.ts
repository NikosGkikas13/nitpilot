import { describe, expect, it } from 'vitest';
import { deriveActivity, type ActiveJob, type ActivityFacts, type Presence } from './activity';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const LAST_SEEN = new Date('2026-10-15T09:30:00.000Z');
const REPO = 'octo/sandbox';

const job = (over: Partial<ActiveJob> = {}): ActiveJob => ({ login: 'leo', userId: 'user-leo', status: 'queued', runAfter: NOW, failure: null, onlyTokenId: null, ...over });
const online = (...linked: string[][]): Presence => ({ connected: linked.map((repos) => new Set(repos)), lastSeenAt: NOW });
const offline = (lastSeenAt: Date | null): Presence => ({ connected: [], lastSeenAt });

/** `presence` is keyed by user id, or by `<user id>/<token id>` for one device of theirs. */
function facts(over: Partial<ActivityFacts> = {}, presence: Record<string, Presence> = {}): ActivityFacts {
  return {
    phase: 'reviewing',
    repoFullName: REPO,
    author: 'maya',
    reviewerToAnswer: null,
    jobs: [],
    presence: (userId, onlyTokenId) => presence[onlyTokenId ? `${userId}/${onlyTokenId}` : userId] ?? offline(null),
    now: NOW,
    ...over,
  };
}

describe('deriveActivity (spec §9.1)', () => {
  it("is agent_working while a job runs", () => {
    expect(deriveActivity(facts({ jobs: [job({ status: 'running' })] }))).toEqual({ kind: 'agent_working', who: 'leo' });
  });

  it('is agent_working for a queued job a CLI can take now', () => {
    expect(deriveActivity(facts({ jobs: [job()] }, { 'user-leo': online([REPO]) }))).toEqual({ kind: 'agent_working', who: 'leo' });
  });

  it("waits with offlineSince when none of the person's CLIs is connected", () => {
    expect(deriveActivity(facts({ jobs: [job()] }, { 'user-leo': offline(LAST_SEEN) }))).toEqual({ kind: 'agent_waiting', who: 'leo', why: 'offline', offlineSince: LAST_SEEN });
  });

  it('waits with offlineSince null when their CLI never connected', () => {
    expect(deriveActivity(facts({ jobs: [job()] }))).toEqual({ kind: 'agent_waiting', who: 'leo', why: 'offline', offlineSince: null });
  });

  it("waits with repo_not_linked when their connected CLIs don't have the repo", () => {
    expect(deriveActivity(facts({ jobs: [job()] }, { 'user-leo': online(['octo/other'], []) }))).toEqual({ kind: 'agent_waiting', who: 'leo', why: 'repo_not_linked' });
  });

  it('waits with cap_reached after the daily cap or the agent quota turned the job down', () => {
    const later = new Date(NOW.getTime() + 60 * 60_000);
    for (const failure of ['daily_cap', 'quota'] as const) {
      expect(deriveActivity(facts({ jobs: [job({ failure, runAfter: later })] }, { 'user-leo': online([REPO]) }))).toEqual({ kind: 'agent_waiting', who: 'leo', why: 'cap_reached' });
    }
    // Once the wait is over, it's up for grabs again.
    expect(deriveActivity(facts({ jobs: [job({ failure: 'daily_cap', runAfter: NOW })] }, { 'user-leo': online([REPO]) }))).toEqual({ kind: 'agent_working', who: 'leo' });
  });

  it('shows the agent that waits when another is working', () => {
    const jobs = [job({ status: 'running' }), job({ login: 'sam', userId: 'user-sam' })];
    expect(deriveActivity(facts({ jobs }, { 'user-sam': offline(LAST_SEEN) }))).toEqual({ kind: 'agent_waiting', who: 'sam', why: 'offline', offlineSince: LAST_SEEN });
  });

  it("waits offline for a publish job while the laptop with the draft is away, even though another of maya's CLIs is online (Review Focus 4)", () => {
    const publish = job({ login: 'maya', userId: 'user-maya', onlyTokenId: 'token-laptop' });
    const presence = { 'user-maya': online([REPO]), 'user-maya/token-laptop': offline(LAST_SEEN) };
    expect(deriveActivity(facts({ jobs: [publish] }, presence))).toEqual({ kind: 'agent_waiting', who: 'maya', why: 'offline', offlineSince: LAST_SEEN });
    // Once that laptop is back, with the repo linked, the draft is being sent.
    expect(deriveActivity(facts({ jobs: [publish] }, { ...presence, 'user-maya/token-laptop': online([REPO]) }))).toEqual({ kind: 'agent_working', who: 'maya' });
  });

  it('names the running agent before a queued one that could start too', () => {
    const jobs = [job({ login: 'sam', userId: 'user-sam' }), job({ status: 'running' })];
    expect(deriveActivity(facts({ jobs }, { 'user-sam': online([REPO]) }))).toEqual({ kind: 'agent_working', who: 'leo' });
  });

  it("is human_turn for the author while addressing with no agent at work, and for a reviewer whose answered point waits", () => {
    expect(deriveActivity(facts({ phase: 'addressing' }))).toEqual({ kind: 'human_turn', who: 'maya' });
    expect(deriveActivity(facts({ phase: 'reviewing', reviewerToAnswer: 'sam' }))).toEqual({ kind: 'human_turn', who: 'sam' });
  });

  it('is none otherwise', () => {
    for (const phase of ['idle', 'ready', 'escalated', 'closed'] as const) expect(deriveActivity(facts({ phase }))).toEqual({ kind: 'none' });
    expect(deriveActivity(facts({ phase: 'reviewing' }))).toEqual({ kind: 'none' });
  });
});
