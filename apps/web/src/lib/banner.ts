import type { ChatView, PointView, WebMe } from '@nitpilot/protocol';

/** The one banner under the chat's header (handoff §2 "Banners", §10 "Edge states"). */
export type Banner =
  | { kind: 'github_expired' }
  | { kind: 'escalated'; points: PointView[]; note: string }
  | { kind: 'failed_job' }
  | { kind: 'failed_post' }
  | { kind: 'cap' }
  | { kind: 'repo_not_linked'; repo: string }
  | { kind: 'waiting'; offlineSince: string | null }
  | { kind: 'ready_reviewer'; rounds: number; resolved: number }
  | { kind: 'ready_author'; reviewer: string | null; rounds: number; resolved: number }
  | { kind: 'none' };

/**
 * Which banner a chat shows the person reading it, most urgent first: a GitHub sign-in that expired (nothing can
 * be done as you until it's renewed), an escalation, your failed job or post, why your agent can't start, then
 * ready. A closed PR shows none.
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
    return { kind: 'waiting', offlineSince: a.offlineSince };
  }
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
