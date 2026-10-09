import type { JobType } from '@nitpilot/protocol';
import { emit, system, type Ctx } from './context';
import { activeJobFor, activeJobs, onNitpilot } from './state';
import type { JobView, ParticipantState } from './types';

/** Auto is on when the team allows it and the person has it on (personal Auto is always on in Plan 1). */
export function autoFor(ctx: Ctx, p: ParticipantState, jobType: JobType): boolean {
  const teamAllows = jobType === 'address' ? ctx.rules.auto.address : ctx.rules.auto.review;
  return teamAllows && p.auto;
}

/**
 * Queue a job for a participant. Returns false when they can't take one: they're not on
 * Nitpilot, or they already have an active job (at most one each, spec §9.4).
 */
export function enqueueJob(ctx: Ctx, p: ParticipantState, jobType: JobType, sinceSha: string | null): boolean {
  if (!onNitpilot(p) || activeJobFor(ctx.chat, p)) return false;
  const applyState = autoFor(ctx, p, jobType) ? 'pending' : 'draft';
  // Add it to the working copy too, so later rules in this same decide() call see it.
  // The id is a placeholder; the dispatcher creates the real row from the command.
  ctx.chat.jobs.push({
    id: `new:${ctx.commands.length}`,
    participantGithubId: p.githubId,
    role: p.role,
    jobType,
    status: 'queued',
    round: ctx.chat.round,
    attempt: 0,
    refundedAttempts: 0,
    headSha: ctx.chat.headSha,
    applyState,
  });
  if (p.attention === 'failed' || p.attention === 'manual_review') p.attention = 'none';
  emit(ctx, {
    type: 'enqueue_job',
    participant: { githubId: p.githubId, role: p.role },
    jobType,
    round: ctx.chat.round,
    sinceSha,
    applyState,
  });
  return true;
}

export function cancelJobs(ctx: Ctx, jobs: JobView[], reason: string): void {
  if (jobs.length === 0) return;
  for (const j of jobs) j.status = 'cancelled';
  emit(ctx, { type: 'cancel_jobs', jobIds: jobs.map((j) => j.id), reason });
}

/**
 * Start a review (or a re-review) for one reviewer, if the rules allow it right now.
 * `manual` is a person pressing "Review" on a PR from an outside contributor (spec §6.1).
 */
export function startReview(ctx: Ctx, reviewer: ParticipantState, opts: { manual?: boolean } = {}): boolean {
  const chat = ctx.chat;
  if (chat.phase === 'closed' || chat.isDraft) return false;
  if (!reviewer.requested || !onNitpilot(reviewer)) return false;
  // While the author's agent is fixing, wait: reviews start after that pass (results.ts).
  if (activeJobs(chat).some((j) => j.jobType === 'address')) return false;

  if (!chat.trusted && !opts.manual) {
    if (reviewer.attention !== 'manual_review') {
      reviewer.attention = 'manual_review';
      emit(ctx, { type: 'notify', userIds: [reviewer.userId!], kind: 'manual_review', pointNumbers: [] });
      system(ctx, `Waiting for ${reviewer.login} to start the review: the PR is from an outside contributor`);
    }
    return false;
  }

  const jobType = reviewer.lastReviewedSha ? 're_review' : 'review';
  if (!enqueueJob(ctx, reviewer, jobType, reviewer.lastReviewedSha)) return false;
  chat.phase = 'reviewing';
  system(ctx, `Round ${chat.round}: ${reviewer.login}'s agent is reviewing`, { reviewer: reviewer.login });
  return true;
}
