import type { JobType, TeamRules } from '@nitpilot/protocol';
import { emit, system, type Ctx } from './context';
import { activeJobFor, activeJobs, isAuthorJob, onNitpilot, participant, waitingDraftFor } from './state';
import type { Command, DraftState, JobView, ParticipantState } from './types';

/**
 * Auto is on when the team allows it and the person has it on (spec §9 "Auto"). A team rule that forbids an auto
 * mode (`auto.review` / `auto.address: false` in .nitpilot.yml) wins over the switch. So does the trust gate on the
 * reviewer's side: on a PR from an outside contributor, a review always waits as a draft, so a person sees what the
 * agent made of that code before anything is posted in their name (spec §6.1, §14).
 */
export function autoFor(ctx: Ctx, p: ParticipantState, jobType: JobType): boolean {
  if (jobType === 'address') return ctx.rules.auto.address && p.auto;
  return startsOnItsOwn(ctx.chat.trusted, ctx.rules) && ctx.rules.auto.review && p.auto;
}

/**
 * Reviews start on their own when the PR's author is trusted (spec §6.1), or when the team trusts every author
 * (`trust_all_authors`, the public playground). `chat.trusted` stays the author's real trust either way: points and
 * comments from an outside contributor are still for information only.
 */
export function startsOnItsOwn(chatTrusted: boolean, rules: TeamRules): boolean {
  return chatTrusted || rules.trust_all_authors;
}

/**
 * A review of an outside contributor's PR that only `trust_all_authors` lets run: the CLI takes it only with the fake
 * agent (spec §14 "Trust all authors"). Author-side jobs run on the PR author's own computer, so trust doesn't apply.
 */
export function fakeAgentOnly(jobType: JobType, chatTrusted: boolean, rules: TeamRules): boolean {
  return (jobType === 'review' || jobType === 're_review') && !chatTrusted && rules.trust_all_authors;
}

/**
 * Queue an agent job for a participant. Returns false when they can't take one: they're not on
 * Nitpilot, or they already have an active job (at most one each, spec §9.4).
 */
export function enqueueJob(ctx: Ctx, p: ParticipantState, jobType: JobType, sinceSha: string | null): boolean {
  if (!onNitpilot(p) || activeJobFor(ctx.chat, p)) return false;
  const applyState = autoFor(ctx, p, jobType) ? 'pending' : 'draft';
  addJob(ctx, p, { jobType, sinceSha, applyState, draftOfId: null });
  if (p.attention === 'failed' || p.attention === 'manual_review') p.attention = 'none';
  return true;
}

type NewJob = Pick<Extract<Command, { type: 'enqueue_job' }>, 'jobType' | 'sinceSha' | 'applyState' | 'draftOfId'>;

/** Queue a job, with no checks: the caller made them. */
export function addJob(ctx: Ctx, p: ParticipantState, job: NewJob): void {
  // Add it to the working copy too, so later rules in this same decide() call see it.
  // The id is a placeholder; the dispatcher creates the real row from the command.
  ctx.chat.jobs.push({
    id: `new:${ctx.commands.length}`,
    participantGithubId: p.githubId,
    role: p.role,
    jobType: job.jobType,
    status: 'queued',
    round: ctx.chat.round,
    attempt: 0,
    refundedAttempts: 0,
    headSha: ctx.chat.headSha,
    applyState: job.applyState,
    draftOfId: job.draftOfId,
  });
  emit(ctx, { type: 'enqueue_job', participant: { githubId: p.githubId, role: p.role }, round: ctx.chat.round, ...job });
}

export function cancelJobs(ctx: Ctx, jobs: JobView[], reason: string): void {
  if (jobs.length === 0) return;
  for (const j of jobs) j.status = 'cancelled';
  emit(ctx, { type: 'cancel_jobs', jobIds: jobs.map((j) => j.id), reason });
}

/** A draft was sent (`applied`) or discarded: it stops waiting, and its owner has nothing left to decide about it. */
export function settleDraft(ctx: Ctx, draft: DraftState, applyState: 'applied' | 'discarded'): void {
  ctx.chat.drafts = ctx.chat.drafts.filter((d) => d.jobId !== draft.jobId);
  emit(ctx, { type: 'set_apply_state', jobId: draft.jobId, applyState });
  const owner = participant(ctx.chat, draft.participantGithubId, draft.role);
  if (owner?.attention === 'drafts') owner.attention = 'none';
}

/**
 * Start a review (or a re-review) for one reviewer, if the rules allow it right now.
 * `manual` is a person pressing "Review" on a PR from an outside contributor (spec §6.1).
 */
export function startReview(ctx: Ctx, reviewer: ParticipantState, opts: { manual?: boolean } = {}): boolean {
  const chat = ctx.chat;
  if (chat.phase === 'closed' || chat.isDraft) return false;
  if (!reviewer.requested || !onNitpilot(reviewer)) return false;
  // Their agent's last review waits as a draft: they Send or Discard it first (spec §9 "Drafts").
  if (waitingDraftFor(chat, reviewer)) return false;
  // While the author's agent is fixing (or her drafted fixes are being pushed), wait: reviews start after that pass (results.ts).
  if (activeJobs(chat).some(isAuthorJob)) return false;

  if (!startsOnItsOwn(chat.trusted, ctx.rules) && !opts.manual) {
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
  // "will": the job is queued, and its CLI may be offline. The banner says whether it runs.
  system(ctx, `Round ${chat.round}: ${reviewer.login}'s agent will review`, { reviewer: reviewer.login });
  return true;
}
