import type { JobStatus, Role } from '@nitpilot/protocol';
import type { ChatState, JobView, ParticipantState, Person, PointState } from './types';

const ACTIVE: readonly JobStatus[] = ['queued', 'running'];

export function author(chat: ChatState): ParticipantState | undefined {
  return chat.participants.find((p) => p.role === 'author');
}

export function reviewers(chat: ChatState): ParticipantState[] {
  return chat.participants.filter((p) => p.role === 'reviewer');
}

export function participant(chat: ChatState, githubId: string, role: Role): ParticipantState | undefined {
  return chat.participants.find((p) => p.githubId === githubId && p.role === role);
}

/** Find a participant or add them. Keeps their login and Nitpilot account up to date. */
export function ensureParticipant(chat: ChatState, person: Person, role: Role): ParticipantState {
  const existing = participant(chat, person.githubId, role);
  if (existing) {
    existing.login = person.login;
    existing.userId = person.userId;
    return existing;
  }
  const created: ParticipantState = {
    githubId: person.githubId,
    login: person.login,
    role,
    userId: person.userId,
    isBot: person.isBot,
    auto: true,
    requested: false,
    lastReviewedSha: null,
    attention: 'none',
  };
  chat.participants.push(created);
  return created;
}

/** True when this person runs Nitpilot, so their agent can do work. Bots never do. */
export function onNitpilot(p: ParticipantState): boolean {
  return p.userId !== null && !p.isBot;
}

export function activeJobs(chat: ChatState): JobView[] {
  return chat.jobs.filter((j) => ACTIVE.includes(j.status));
}

export function activeJobFor(chat: ChatState, p: ParticipantState): JobView | undefined {
  return activeJobs(chat).find((j) => j.participantGithubId === p.githubId && j.role === p.role);
}

/** A point the author's side should work on now (spec §9.3). */
export function isActionable(pt: PointState): boolean {
  return pt.status === 'open' && pt.trusted;
}

export function pointByNumber(chat: ChatState, n: number): PointState | undefined {
  return chat.points.find((p) => p.number === n);
}

/** The point a GitHub thread belongs to, found by the thread's root comment id. */
export function pointByThread(chat: ChatState, rootId: string): PointState | undefined {
  return chat.points.find((p) => p.githubThreadRootId === rootId || p.githubCommentId === rootId);
}

export function nextPointNumber(chat: ChatState): number {
  return chat.points.reduce((max, p) => Math.max(max, p.number), 0) + 1;
}

/** The author field of a timeline item. */
export function who(p: { githubId: string; login: string }): { githubId: string; login: string } {
  return { githubId: p.githubId, login: p.login };
}

/** "P1, P3" */
export function pointList(points: PointState[]): string {
  return points.map((p) => `P${p.number}`).join(', ');
}
