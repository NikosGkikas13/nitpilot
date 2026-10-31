import type { ChatView, FailureReason, PointView, WebMe } from '@nitpilot/protocol';

/** The one banner under the chat's header (handoff §2 "Banners", §10 "Edge states"). */
export type Banner =
  | { kind: 'github_expired' }
  | { kind: 'escalated'; points: PointView[]; note: string }
  | { kind: 'failed_job' }
  | { kind: 'failed_post' }
  | { kind: 'cap' }
  | { kind: 'drafts'; count: number; firstJobId: string }
  | { kind: 'repo_not_linked'; repo: string }
  | { kind: 'waiting'; offlineSince: string | null }
  | { kind: 'ready_reviewer'; rounds: number; resolved: number }
  | { kind: 'ready_author'; reviewer: string | null; rounds: number; resolved: number }
  | { kind: 'none' };

/**
 * Which banner a chat shows the person reading it, most urgent first: a GitHub sign-in that expired (nothing can
 * be done as you until it's renewed), an escalation, your failed job or post, why your agent can't start,
 * your waiting drafts, then ready. A closed PR shows none.
 */
export function chatBanner(view: ChatView, me: WebMe): Banner {
  if (view.closed) return { kind: 'none' };
  if (me.githubAuth === 'needs_reauth') return { kind: 'github_expired' };
  const escalated = view.points.filter((p) => p.status === 'escalated');
  if (escalated.length > 0) return { kind: 'escalated', points: escalated, note: escalationNote(escalated, view.maxRounds) };
  if (view.viewer.attention === 'failed') return { kind: view.viewer.failure === 'github_post' ? 'failed_post' : 'failed_job' };
  const a = view.activity;
  if (a.kind === 'agent_waiting' && a.who === me.login) {
    if (a.why === 'cap_reached') return { kind: 'cap' };
    if (a.why === 'repo_not_linked') return { kind: 'repo_not_linked', repo: view.repo };
  }
  // Work your agent finished with Auto off waits for you: say so before "waiting", which would be about the agent.
  const drafts = myWaitingDrafts(view, me);
  if (drafts[0]) return { kind: 'drafts', count: drafts.length, firstJobId: drafts[0].jobId };
  if (a.kind === 'agent_waiting' && a.who === me.login) return { kind: 'waiting', offlineSince: a.offlineSince };
  if (view.phase === 'ready' && view.viewer.role !== null) {
    const rounds = view.round;
    const resolved = view.points.filter((p) => p.status === 'resolved').length;
    if (view.viewer.role === 'reviewer') return { kind: 'ready_reviewer', rounds, resolved };
    const reviewers = view.participants.filter((p) => p.role === 'reviewer');
    const reviewer = (reviewers.find((p) => p.requested) ?? reviewers[0])?.login ?? null;
    return { kind: 'ready_author', reviewer, rounds, resolved };
  }
  return { kind: 'none' };
}

/** The drafts that are yours to Send or Discard: your agent's, and not already on their way out. */
export function myWaitingDrafts(view: ChatView, me: WebMe) {
  return view.drafts.filter((d) => d.owner === me.login && !d.sending);
}

/** The id the first draft card carries, so the drafts banner can scroll to it. */
export const draftCardId = (jobId: string) => `draft-${jobId}`;

/** Why a job failed, in one plain sentence for the failed banner. */
export function failureText(reason: FailureReason): string {
  switch (reason) {
    case 'auth':
      return "Your agent isn't signed in on that computer. Sign it in, then Retry.";
    case 'quota':
      return 'Your agent ran out of usage for now. Retry once your plan resets.';
    case 'max_turns':
      return 'Your agent used up all its steps before it finished.';
    case 'crash':
      return 'Your agent stopped unexpectedly.';
    case 'timeout':
      return 'Your agent took too long and was stopped.';
    case 'no_result':
      return 'Your agent finished without giving an answer.';
    case 'stale_head':
      return 'The PR moved on while your agent was working, so nothing was pushed.';
    case 'branch_moved':
      return 'Someone pushed to the branch while your agent was working.';
    case 'setup_failed':
      return "Your agent couldn't set up its working copy of the repo.";
    case 'git_error':
      return 'Git failed while your agent was working on the repo.';
    case 'daily_cap':
      return 'Your agent has used all its runs for today.';
    case 'repo_not_linked':
      return "This repo isn't linked on that computer yet.";
    case 'unsupported_mode':
      return "Your agent can't do this kind of work yet.";
  }
}

/** Why the points went to a person, in one line: "Security points always go to a person." */
export function escalationNote(points: PointView[], maxRounds: number): string {
  const reasons = new Set(points.map((p) => p.escalationReason));
  if (reasons.size === 1 && reasons.has('category')) {
    const categories = [...new Set(points.map((p) => p.category))];
    const named = categories.map((c, i) => (i === 0 ? c[0]!.toUpperCase() + c.slice(1) : c)).join(' and ');
    return `${named} points always go to a person.`;
  }
  if (reasons.size === 1 && reasons.has('disagreement')) return "The agents don't agree.";
  if (reasons.size === 1 && reasons.has('round_limit')) return `The agents used all ${maxRounds} rounds.`;
  return 'These points need a person.';
}

/** "maya's and leo's agents reviewing this PR": the people here with an agent on Nitpilot, the author first. */
export function visitorTitle(view: ChatView): string {
  const logins = [...new Set(view.participants.filter((p) => p.onNitpilot && !p.isBot).toSorted((a, b) => (a.role === 'author' ? -1 : b.role === 'author' ? 1 : 0)).map((p) => `${p.login}'s`))];
  if (logins.length === 0) return 'AI agents reviewing this PR';
  const names = logins.length === 1 ? logins[0] : `${logins.slice(0, -1).join(', ')} and ${logins.at(-1)}`;
  return `${names} ${logins.length === 1 ? 'agent' : 'agents'} reviewing this PR`;
}
