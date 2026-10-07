import { DEFAULT_RULES, type JobResult, type JobType, type NewPoint, type Role, type TeamRules } from '@nitpilot/protocol';
import type { ChatState, JobView, ParticipantState, Person, PointState } from './types';

// Builders for engine tests. Each returns a fresh object; pass overrides for what a test cares about.

export const T0 = new Date('2026-10-07T18:00:00.000Z');

export function person(login: string, over: Partial<Person> = {}): Person {
  return { githubId: `gh-${login}`, login, isBot: false, userId: `user-${login}`, ...over };
}

/** The cast. */
export const maya = person('maya');                                              // author, on Nitpilot
export const leo = person('leo');                                                // reviewer, on Nitpilot
export const sam = person('sam', { userId: null });                              // human reviewer, not on Nitpilot
export const rabbit = person('coderabbitai[bot]', { isBot: true, userId: null }); // trusted review bot

export function participantOf(p: Person, role: Role, over: Partial<ParticipantState> = {}): ParticipantState {
  return {
    githubId: p.githubId,
    login: p.login,
    role,
    userId: p.userId,
    isBot: p.isBot,
    auto: true,
    requested: role === 'reviewer',
    lastReviewedSha: null,
    attention: 'none',
    ...over,
  };
}

export function chatState(over: Partial<ChatState> = {}): ChatState {
  return {
    phase: 'idle',
    round: 1,
    addressPasses: 0,
    headSha: 'head1',
    isDraft: false,
    trusted: true,
    merged: false,
    closed: false,
    authorGithubId: maya.githubId,
    participants: [],
    points: [],
    jobs: [],
    ...over,
  };
}

/** maya opened the PR and requested leo; both use Nitpilot. */
export function agentToAgent(over: Partial<ChatState> = {}): ChatState {
  return chatState({ participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer')], ...over });
}

export function pointOf(number: number, raisedBy: Person, over: Partial<PointState> = {}): PointState {
  return {
    number,
    raisedBy: raisedBy.githubId,
    origin: 'agent',
    jobId: 'job-review-1',
    githubCommentId: null,
    githubThreadRootId: null,
    path: 'src/orders/list.ts',
    line: 48,
    side: 'RIGHT',
    commitSha: 'head1',
    severity: 'major',
    category: 'bug',
    title: `Point ${number}`,
    body: 'Explanation.',
    snippet: null,
    status: 'open',
    authorResolution: null,
    escalationReason: null,
    trusted: true,
    round: 1,
    ...over,
  };
}

export function jobOf(id: string, p: Person, role: Role, jobType: JobType, over: Partial<JobView> = {}): JobView {
  return {
    id,
    participantGithubId: p.githubId,
    role,
    jobType,
    status: 'running',
    round: 1,
    attempt: 1,
    headSha: 'head1',
    applyState: 'pending',
    ...over,
  };
}

export function newPoint(over: Partial<NewPoint> = {}): NewPoint {
  return {
    path: 'src/orders/list.ts',
    line: 48,
    side: 'RIGHT',
    severity: 'major',
    category: 'bug',
    title: '`parseOrder` crashes on empty input',
    body: 'When `items` is empty, `items[0].id` throws.',
    snippet: null,
    ...over,
  };
}

export function result(over: Partial<JobResult> = {}): JobResult {
  return { summary: 'Done.', points: [], decisions: [], replies: [], push: null, ...over };
}

export function rulesWith(over: Partial<TeamRules> = {}): TeamRules {
  return { ...DEFAULT_RULES, ...over };
}
