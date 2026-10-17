import { emit, system, type Ctx } from './context';
import { enqueueJob, startReview } from './jobs';
import { escalatePoints } from './points';
import { activeJobs, author, isActionable, onNitpilot, reviewers, roundLimit } from './state';
import type { ChatState, ParticipantState } from './types';

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

  // Nothing has been reviewed yet, so there's nothing to approve. Untrusted points don't count:
  // anyone on GitHub can leave one (spec §6.1).
  const reviewedOnce = chat.points.some((p) => p.trusted) || reviewers(chat).some((r) => r.lastReviewedSha !== null);
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
    const behind = reviewersBehind(chat);
    if (behind.length > 0) {
      // Catch them up first: a re-review since the commit they last saw, or, on an outside
      // contributor's PR, a request to start it by hand. A failed job or waiting drafts is left
      // for a person to decide.
      const waitsForPerson = (r: ParticipantState) => r.attention === 'failed' || r.attention === 'drafts';
      const started = behind.filter((r) => !waitsForPerson(r)).map((r) => startReview(ctx, r)).some(Boolean);
      if (!started) chat.phase = 'idle';
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
  if (chat.addressPasses >= roundLimit(ctx)) {
    const stuck = chat.points.filter((p) => p.trusted && (p.status === 'open' || p.status === 'addressed'));
    escalatePoints(ctx, stuck, 'round_limit');
    enterEscalated(ctx);
    return;
  }
  // A pass that failed for good waits for the author to ask again (`nitpilot retry`): a person decides (spec §9.4).
  if (a.attention === 'failed') {
    chat.phase = 'addressing';
    return;
  }
  if (enqueueJob(ctx, a, 'address', null)) {
    // "will": the job is queued, and its CLI may be offline. The banner says whether it runs.
    const n = actionable.length;
    system(ctx, `${a.login}'s agent will work on ${n} point${n === 1 ? '' : 's'}`);
  }
  chat.phase = 'addressing';
}

/**
 * Requested reviewers on Nitpilot who haven't reviewed the commit that's there now, or who still
 * have to start a review by hand. The PR isn't ready for approval until they have.
 */
function reviewersBehind(chat: ChatState): ParticipantState[] {
  return reviewers(chat).filter((r) => r.requested && onNitpilot(r) && (r.lastReviewedSha !== chat.headSha || r.attention === 'manual_review'));
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
