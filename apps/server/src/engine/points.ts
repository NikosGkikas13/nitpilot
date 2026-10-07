import type { EscalationReason, NewPoint, PointDecision, PointReply } from '@nitpilot/protocol';
import { emit, say, system, type Ctx } from './context';
import { nextPointNumber, onNitpilot, pointByNumber, pointList, who } from './state';
import type { ParticipantState, PointState } from './types';

const REASON_TEXT: Record<EscalationReason, string> = {
  category: 'this category always goes to a person',
  disagreement: 'the agents disagree',
  round_limit: 'the round limit was reached',
};

/** What it takes to raise a point: the agent's (or comment's) content plus where it came from. */
export type RaisedPoint = NewPoint &
  Pick<PointState, 'origin' | 'jobId' | 'githubCommentId' | 'githubThreadRootId' | 'commitSha' | 'trusted'> & {
    raisedBy: { githubId: string; login: string };
  };

export function raisePoint(ctx: Ctx, input: RaisedPoint): PointState {
  const { raisedBy, ...fields } = input;
  const pt: PointState = {
    ...fields,
    raisedBy: raisedBy.githubId,
    number: nextPointNumber(ctx.chat),
    status: 'open',
    authorResolution: null,
    escalationReason: null,
    round: ctx.chat.round,
  };
  ctx.chat.points.push(pt);
  say(ctx, {
    kind: 'point_raised',
    author: raisedBy,
    pointNumber: pt.number,
    jobId: pt.jobId,
    body: pt.title,
    data: { severity: pt.severity, category: pt.category, path: pt.path, line: pt.line },
  });
  // Some categories (security by default) always go to a person, and agents never touch them.
  if (ctx.rules.always_escalate.includes(pt.category)) escalatePoints(ctx, [pt], 'category');
  return pt;
}

/** Hand points to humans. Both sides are told right away (spec §9.3). */
export function escalatePoints(ctx: Ctx, points: PointState[], reason: EscalationReason): void {
  if (points.length === 0) return;
  for (const pt of points) {
    pt.status = 'escalated';
    pt.escalationReason = reason;
  }
  const verb = points.length === 1 ? 'needs' : 'need';
  system(ctx, `${pointList(points)} ${verb} a human decision: ${REASON_TEXT[reason]}`, {
    points: points.map((p) => p.number),
    reason,
  });
  const people = new Set([ctx.chat.authorGithubId, ...points.map((p) => p.raisedBy)]);
  const userIds = ctx.chat.participants.filter((p) => people.has(p.githubId) && onNitpilot(p)).map((p) => p.userId!);
  if (userIds.length > 0) {
    emit(ctx, { type: 'notify', userIds: [...new Set(userIds)], kind: 'escalated', pointNumbers: points.map((p) => p.number) });
  }
}

/**
 * A reviewer agent's verdict on one of its own points (spec §9.2). Returns false when the
 * decision doesn't apply (someone else's point, or one that is escalated or resolved).
 */
export function applyDecision(ctx: Ctx, reviewer: ParticipantState, d: PointDecision, jobId: string): boolean {
  const pt = pointByNumber(ctx.chat, d.point);
  if (!pt || pt.raisedBy !== reviewer.githubId || pt.origin !== 'agent') return false;
  if (pt.status === 'escalated' || pt.status === 'resolved') return false;

  say(ctx, { kind: 'point_decision', author: who(reviewer), pointNumber: pt.number, jobId, body: d.comment, data: { decision: d.decision } });
  if (d.decision === 'resolve') {
    pt.status = 'resolved';
  } else if (pt.status === 'addressed' && pt.authorResolution === 'declined') {
    escalatePoints(ctx, [pt], 'disagreement'); // fires immediately (spec §9.2)
  } else {
    pt.status = 'open';
  }
  return true;
}

/** The author agent's answer to an open point. Returns false when the point isn't open. */
export function applyReply(ctx: Ctx, authorP: ParticipantState, r: PointReply, jobId: string, commit: string | null): boolean {
  const pt = pointByNumber(ctx.chat, r.point);
  if (!pt || pt.status !== 'open' || !pt.trusted) return false;
  pt.status = 'addressed';
  pt.authorResolution = r.resolution;
  say(ctx, { kind: 'point_reply', author: who(authorP), pointNumber: pt.number, jobId, body: r.comment, data: { resolution: r.resolution, commit } });
  return true;
}
