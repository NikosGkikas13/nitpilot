import type { EscalationReason, NewPoint } from '@nitpilot/protocol';
import { emit, say, system, type Ctx } from './context';
import { nextPointNumber, onNitpilot, pointList } from './state';
import type { PointState } from './types';

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
