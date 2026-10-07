import { emit, system, type Ctx } from './context';
import { enqueueJob } from './jobs';
import { escalatePoints } from './points';
import { activeJobs, author, isActionable, onNitpilot, reviewers } from './state';

/**
 * What happens next (spec §9.3 "When reviews settle"). Safe to call at any time: while a
 * job is still active it only sets the phase.
 */
export function advance(ctx: Ctx): void {
  const chat = ctx.chat;
  if (chat.phase === 'closed' || chat.isDraft) return;

  const active = activeJobs(chat);
  if (active.some((j) => j.jobType !== 'address')) {
    chat.phase = 'reviewing';
    return;
  }
  if (active.some((j) => j.jobType === 'address')) {
    chat.phase = 'addressing';
    return;
  }

  // Nothing has been reviewed yet, so there's nothing to approve.
  const reviewedOnce = chat.points.length > 0 || reviewers(chat).some((r) => r.lastReviewedSha !== null);
  if (!reviewedOnce) {
    chat.phase = 'idle';
    return;
  }

  const actionable = chat.points.filter(isActionable);
  if (actionable.length === 0) {
    // Answered GitHub points wait for their human reviewer.
    if (chat.points.some((p) => p.status === 'addressed')) {
      chat.phase = 'reviewing';
      return;
    }
    if (chat.points.some((p) => p.status === 'escalated')) {
      enterEscalated(ctx);
      return;
    }
    enterReady(ctx);
    return;
  }

  const a = author(chat);
  if (!a || !onNitpilot(a)) {
    chat.phase = 'addressing'; // the human author's turn
    return;
  }
  if (chat.addressPasses >= ctx.rules.max_rounds) {
    const stuck = chat.points.filter((p) => p.trusted && (p.status === 'open' || p.status === 'addressed'));
    escalatePoints(ctx, stuck, 'round_limit');
    enterEscalated(ctx);
    return;
  }
  if (enqueueJob(ctx, a, 'address', null)) {
    const n = actionable.length;
    system(ctx, `${a.login}'s agent is working on ${n} point${n === 1 ? '' : 's'}`);
  }
  chat.phase = 'addressing';
}

function enterReady(ctx: Ctx): void {
  const chat = ctx.chat;
  if (chat.phase === 'ready') return;
  chat.phase = 'ready';
  system(ctx, 'Ready for approval');
  const userIds = reviewers(chat).filter((r) => r.requested && onNitpilot(r)).map((r) => r.userId!);
  if (userIds.length > 0) emit(ctx, { type: 'notify', userIds, kind: 'ready', pointNumbers: [] });
}

function enterEscalated(ctx: Ctx): void {
  if (ctx.chat.phase === 'escalated') return;
  ctx.chat.phase = 'escalated';
  // Everyone involved was already notified when each point escalated (points.ts).
  system(ctx, 'Waiting for a human decision');
}
