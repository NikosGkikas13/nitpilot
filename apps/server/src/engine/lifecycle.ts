import { advance } from './advance';
import { say, system, type Ctx, type Ev } from './context';
import { cancelJobs, startReview } from './jobs';
import { activeJobFor, activeJobs, ensureParticipant, pointList, reviewers, who } from './state';

export function onPrOpened(ctx: Ctx, e: Ev<'pr_opened'>): void {
  ensureParticipant(ctx.chat, e.author, 'author');
  const requested = e.reviewers.map((person) => {
    const r = ensureParticipant(ctx.chat, person, 'reviewer');
    r.requested = true;
    return r;
  });
  system(ctx, `Pull request opened by ${e.author.login}`);
  for (const r of requested) startReview(ctx, r);
}

export function onPrReady(ctx: Ctx): void {
  ctx.chat.isDraft = false;
  system(ctx, 'Marked ready for review');
  startReviewsOrAdvance(ctx);
}

export function onPrToDraft(ctx: Ctx): void {
  ctx.chat.isDraft = true;
  cancelJobs(ctx, activeJobs(ctx.chat), 'pr_to_draft');
  ctx.chat.phase = 'idle';
  system(ctx, 'Converted to draft: agents paused');
}

export function onPrClosed(ctx: Ctx, e: Ev<'pr_closed'>): void {
  const chat = ctx.chat;
  chat.closed = true;
  chat.merged = e.merged;
  chat.phase = 'closed';
  cancelJobs(ctx, activeJobs(chat), 'pr_closed');
  system(ctx, e.merged ? 'Merged' : 'Closed without merging');
}

export function onPrReopened(ctx: Ctx): void {
  ctx.chat.closed = false;
  ctx.chat.merged = false;
  ctx.chat.phase = 'idle';
  system(ctx, 'Reopened');
  startReviewsOrAdvance(ctx);
}

/**
 * The PR now targets another branch (spec §15). The chat row already has the new base; the engine
 * records whether the author is still trusted. Nothing starts: a running job finishes on the base it
 * began with, and the next one gets the new base.
 */
export function onPrRetargeted(ctx: Ctx, e: Ev<'pr_retargeted'>): void {
  ctx.chat.trusted = e.trusted;
  system(ctx, `Now targets ${e.baseRef}`);
}

export function onReviewRequested(ctx: Ctx, e: Ev<'review_requested'>): void {
  const r = ensureParticipant(ctx.chat, e.reviewer, 'reviewer');
  r.requested = true;
  system(ctx, `Review requested from ${r.login}`);
  startReview(ctx, r);
}

export function onReviewRequestRemoved(ctx: Ctx, e: Ev<'review_request_removed'>): void {
  const chat = ctx.chat;
  const r = ensureParticipant(chat, e.reviewer, 'reviewer');
  r.requested = false;
  const job = activeJobFor(chat, r);
  if (job) cancelJobs(ctx, [job], 'reviewer_removed');
  // Their unresolved agent points are withdrawn (spec §9.2).
  const withdrawn = chat.points.filter((p) => p.raisedBy === r.githubId && p.origin === 'agent' && p.status !== 'resolved');
  for (const p of withdrawn) p.status = 'resolved';
  const suffix = withdrawn.length > 0 ? `; ${pointList(withdrawn)} withdrawn` : '';
  system(ctx, `${r.login} is no longer a reviewer${suffix}`);
  advance(ctx);
}

export function onManualReview(ctx: Ctx, e: Ev<'manual_review'>): void {
  const r = ensureParticipant(ctx.chat, e.reviewer, 'reviewer');
  r.requested = true;
  startReview(ctx, r, { manual: true });
}

export function onHumanNote(ctx: Ctx, e: Ev<'human_note'>): void {
  // Notes go into the agents' next job bundle; they don't change the workflow.
  say(ctx, { kind: 'human', author: who(e.author), body: e.body });
}

function startReviewsOrAdvance(ctx: Ctx): void {
  // map() first so every reviewer gets a chance, then check whether any review started.
  const started = reviewers(ctx.chat).map((r) => startReview(ctx, r)).some(Boolean);
  if (!started) advance(ctx);
}
