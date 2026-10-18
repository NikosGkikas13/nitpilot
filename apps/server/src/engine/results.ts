import type { FailureReason, JobResult, PointReply, Severity } from '@nitpilot/protocol';
import { advance } from './advance';
import { addMs, emit, say, system, type Ctx, type Ev } from './context';
import { settleDraft, startReview } from './jobs';
import { applyDecision, applyReply, raisePoint } from './points';
import { author, onNitpilot, participant, pointByNumber, reviewers, who } from './state';
import type { JobView, ParticipantState } from './types';

/** The job whose result is applied: one that just finished, or a draft being sent (drafts.ts). */
export type AppliedJob = Pick<JobView, 'id' | 'jobType' | 'headSha'>;

export function onJobCompleted(ctx: Ctx, e: Ev<'job_completed'>): void {
  const chat = ctx.chat;
  const job = chat.jobs.find((j) => j.id === e.jobId);
  // A result for a job that was cancelled, already finished, or handed out again since (a newer
  // attempt) is stale: ignore it. The fencing check of spec §9.4, done inside the chat's lock.
  if (!job || job.status !== 'running' || job.attempt !== e.attempt) return;
  job.status = 'done';
  const p = participant(chat, job.participantGithubId, job.role);

  if (job.jobType === 'publish') {
    onPublished(ctx, job, p, e.result);
    return;
  }

  if (job.applyState === 'draft') {
    emit(ctx, { type: 'complete_job', jobId: job.id, applyState: 'draft', result: e.result });
    // Add it to the waiting drafts too, so the rest of this decide() call holds this person's other work.
    chat.drafts.push({ jobId: job.id, participantGithubId: job.participantGithubId, role: job.role, jobType: job.jobType, headSha: job.headSha, result: e.result });
    if (p) {
      p.attention = 'drafts';
      if (p.userId) emit(ctx, { type: 'notify', userIds: [p.userId], kind: 'drafts', pointNumbers: [] });
      system(ctx, `${p.login}'s agent finished; its work waits as drafts`, { jobId: job.id });
    }
    // The person decides what happens to the draft; the rest of the chat carries on (spec §9.3).
    advance(ctx);
    return;
  }

  emit(ctx, { type: 'complete_job', jobId: job.id, applyState: 'applied', result: e.result });
  if (!p) return;
  if (job.jobType === 'address') applyAddress(ctx, job, p, e.result);
  else applyReview(ctx, job, p, e.result);
  advance(ctx);
}

/**
 * A publish job pushed an author's draft commit (spec §9 "Drafts"). The draft's stored replies are applied exactly as
 * an auto address pass would have been, with the commit that was just pushed.
 */
function onPublished(ctx: Ctx, job: JobView, authorP: ParticipantState | undefined, result: JobResult): void {
  emit(ctx, { type: 'complete_job', jobId: job.id, applyState: 'applied', result });
  const draft = ctx.chat.drafts.find((d) => d.jobId === job.draftOfId);
  // A publish job pushes or fails, so a result without a push shouldn't come. If one does, the draft keeps waiting.
  if (draft && authorP && result.push) {
    settleDraft(ctx, draft, 'applied');
    applyAddress(ctx, { id: draft.jobId, jobType: draft.jobType, headSha: draft.headSha }, authorP, { ...draft.result, push: result.push });
  }
  advance(ctx);
}

export function applyReview(ctx: Ctx, job: AppliedJob, reviewer: ParticipantState, result: JobResult): void {
  const chat = ctx.chat;
  say(ctx, { kind: 'job_summary', author: who(reviewer), jobId: job.id, body: result.summary, data: { jobType: job.jobType, counts: severityCounts(result) } });

  const raised = result.points.slice(0, ctx.rules.max_points_per_review).map((np) =>
    raisePoint(ctx, {
      ...np,
      raisedBy: who(reviewer),
      origin: 'agent',
      jobId: job.id,
      githubCommentId: null,
      githubThreadRootId: null,
      commitSha: job.headSha,
      trusted: true,
    }),
  );
  const decided = result.decisions.filter((d) => applyDecision(ctx, reviewer, d, job.id));
  reviewer.lastReviewedSha = job.headSha;

  // Single-player reviewer: the author isn't on Nitpilot, so answer on GitHub (spec §6.1).
  const a = author(chat);
  if (a && onNitpilot(a)) return;
  if (raised.length > 0) {
    emit(ctx, { type: 'post_review', reviewerGithubId: reviewer.githubId, pointNumbers: raised.map((p) => p.number) });
  }
  const onGithub = decided.filter((d) => pointByNumber(chat, d.point)?.githubThreadRootId);
  if (onGithub.length > 0) {
    emit(ctx, { type: 'post_thread_replies', asGithubId: reviewer.githubId, replies: onGithub.map((d) => ({ pointNumber: d.point, body: d.comment })) });
  }
}

function applyAddress(ctx: Ctx, job: AppliedJob, authorP: ParticipantState, result: JobResult): void {
  const chat = ctx.chat;
  const commit = result.push?.to ?? null;
  // Our own push: move the head now, so the re-review queued below runs on the pushed commit instead
  // of waiting for GitHub's push webhook. Only when nothing else moved the head meanwhile.
  if (result.push && chat.headSha === result.push.from) chat.headSha = result.push.to;
  say(ctx, { kind: 'job_summary', author: who(authorP), jobId: job.id, body: result.summary, data: { jobType: 'address', push: result.push } });
  if (commit) system(ctx, `${authorP.login}'s agent pushed ${commit.slice(0, 7)}`, { commit });

  const replied = result.replies.filter((r) => applyReply(ctx, authorP, r, job.id, commit));
  chat.addressPasses += 1;
  chat.round += 1;

  // A point that lives on GitHub is answered in its GitHub thread (spec §6.1).
  const onGithub = replied.filter((r) => pointByNumber(chat, r.point)?.githubThreadRootId);
  if (onGithub.length > 0) {
    emit(ctx, {
      type: 'post_thread_replies',
      asGithubId: authorP.githubId,
      replies: onGithub.map((r) => ({ pointNumber: r.point, body: replyBody(r, commit) })),
    });
  }

  // Reviewers with answered points re-review; requested reviewers who never reviewed start now.
  for (const r of reviewers(chat)) {
    const waiting = chat.points.some((p) => p.raisedBy === r.githubId && p.origin === 'agent' && p.status === 'addressed');
    if (waiting || r.lastReviewedSha === null) startReview(ctx, r);
  }
}

function replyBody(r: PointReply, commit: string | null): string {
  return r.resolution === 'fixed' && commit ? `${r.comment}\n\nFixed in ${commit.slice(0, 7)}.` : r.comment;
}

function severityCounts(result: JobResult): Partial<Record<Severity, number>> {
  const counts: Partial<Record<Severity, number>> = {};
  for (const p of result.points) counts[p.severity] = (counts[p.severity] ?? 0) + 1;
  return counts;
}

export const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 30_000;
/** The branch moved under the job: run it again on the new head right away. Not a publish job: its draft is out of date. */
const RUN_AGAIN_NOW: readonly FailureReason[] = ['branch_moved'];
/** Not the agent's fault: wait, then try again without counting an attempt. */
const WAIT_MS: Partial<Record<FailureReason, number>> = {
  // GitHub moves a PR's ref a few seconds after a push, so a job handed out on our own push can see the old head.
  stale_head: 5_000,
  quota: 15 * 60_000,
  daily_cap: 60 * 60_000,
  repo_not_linked: 10 * 60_000,
};
/** Waits too short to be worth a line in the chat. */
const QUIET_WAITS: readonly FailureReason[] = ['stale_head'];
/**
 * A publish job that fails like this won't work if tried again: the drafted fixes are out of date (spec §9 "Drafts").
 * The CLI reports `setup_failed` when the draft commit is no longer in that clone (spec §11 "Publish jobs").
 */
const DRAFT_OUT_OF_DATE: Partial<Record<FailureReason, string>> = {
  branch_moved: 'the branch moved',
  setup_failed: 'the draft commit is gone from that computer',
};

export function onJobFailed(ctx: Ctx, e: Ev<'job_failed'>): void {
  const chat = ctx.chat;
  const job = chat.jobs.find((j) => j.id === e.jobId);
  // Same fencing as onJobCompleted: only the current attempt can fail.
  if (!job || job.status !== 'running' || job.attempt !== e.attempt) return;
  const p = participant(chat, job.participantGithubId, job.role);
  const name = p ? `${p.login}'s agent` : 'An agent';

  const outOfDate = job.jobType === 'publish' ? DRAFT_OUT_OF_DATE[e.reason] : undefined;
  if (outOfDate) {
    job.status = 'failed';
    emit(ctx, { type: 'fail_job', jobId: job.id, reason: e.reason });
    const draft = chat.drafts.find((d) => d.jobId === job.draftOfId);
    if (draft) {
      settleDraft(ctx, draft, 'discarded');
      system(ctx, `The drafted fixes are out of date: ${outOfDate}`, { jobId: draft.jobId, reason: e.reason });
    }
    // The chat carries on from where it is: a new address pass, or a new draft with Auto off.
    advance(ctx);
    return;
  }
  if (RUN_AGAIN_NOW.includes(e.reason)) {
    requeue(ctx, job, ctx.now, true, e.reason);
    return;
  }
  const wait = WAIT_MS[e.reason];
  if (wait !== undefined) {
    requeue(ctx, job, addMs(ctx.now, wait), true, e.reason);
    if (!QUIET_WAITS.includes(e.reason)) system(ctx, `${name} is waiting (${e.reason.replaceAll('_', ' ')}) and will try again later`, { reason: e.reason });
    return;
  }
  // Only the attempts that were the agent's problem count toward the limit and the backoff.
  const counted = job.attempt - job.refundedAttempts;
  if (e.retryable && counted < MAX_ATTEMPTS) {
    requeue(ctx, job, addMs(ctx.now, RETRY_BASE_MS * 2 ** (counted - 1)), false, e.reason);
    return;
  }

  job.status = 'failed';
  emit(ctx, { type: 'fail_job', jobId: job.id, reason: e.reason });
  if (job.jobType === 'publish') {
    // The draft still waits, so its owner can Send it again or Discard it: their attention stays on the draft.
    system(ctx, `Couldn't send ${p ? `${p.login}'s` : 'the'} drafted fixes (${e.reason.replaceAll('_', ' ')})`, { reason: e.reason, jobId: job.id });
    if (p?.userId) emit(ctx, { type: 'notify', userIds: [p.userId], kind: 'failed', pointNumbers: [] });
    return;
  }
  system(ctx, `${name} couldn't finish (${e.reason.replaceAll('_', ' ')})`, { reason: e.reason, jobId: job.id });
  if (p) {
    p.attention = 'failed';
    if (p.userId) emit(ctx, { type: 'notify', userIds: [p.userId], kind: 'failed', pointNumbers: [] });
  }
  // No advance() here: a person decides what happens next (`nitpilot retry`; Plan 2's Retry button).
}

/**
 * A person asks to run their failed job again (`nitpilot retry`; Plan 2's Retry button). Only someone
 * flagged `failed` can (a reviewer only while still requested). The job starts over as a new job, with a fresh count of attempts.
 */
export function onRetryRequested(ctx: Ctx, e: Ev<'retry_requested'>): void {
  const chat = ctx.chat;
  if (chat.phase === 'closed') return;
  const failed = chat.participants.filter((p) => p.githubId === e.who.githubId && p.attention === 'failed' && (p.role === 'author' || p.requested));
  if (failed.length === 0) return;
  system(ctx, `${e.who.login} asked their agent to try again`);
  for (const p of failed) {
    p.attention = 'none';
    // The person asked for it, so on an outside contributor's PR this counts as starting the review by hand.
    if (p.role === 'reviewer') startReview(ctx, p, { manual: true });
  }
  // The author's address pass (or anything else now due) is queued the usual way.
  advance(ctx);
}

function requeue(ctx: Ctx, job: JobView, runAfter: Date, refundAttempt: boolean, reason: FailureReason): void {
  job.status = 'queued';
  emit(ctx, { type: 'retry_job', jobId: job.id, runAfter, refundAttempt, reason });
}
