import { advance } from './advance';
import { addMs, emit, say, system, type Ctx, type Ev } from './context';
import { cancelJobs, enqueueJob, startReview } from './jobs';
import { raisePoint } from './points';
import {
  activeJobFor, activeJobs, author, ensureParticipant, onNitpilot, participant, pointByThread, reviewers, who,
} from './state';
import type { ExternalComment, Person } from './types';

export const COMMENTS_TIMER = 'comments';
export const syncTimer = (githubId: string): string => `sync:${githubId}`;

export function onExternalComment(ctx: Ctx, e: Ev<'external_comment'>): void {
  if (ctx.chat.phase === 'closed') return;
  if (handleComment(ctx, e.comment)) scheduleComments(ctx);
}

export function onCommentDeleted(ctx: Ctx, e: Ev<'external_comment_deleted'>): void {
  const pt = ctx.chat.points.find((p) => p.githubCommentId === e.commentId);
  if (!pt || pt.status === 'resolved') return;
  pt.status = 'resolved';
  system(ctx, `P${pt.number}'s comment was deleted on GitHub`);
  advance(ctx);
}

export function onReviewSubmitted(ctx: Ctx, e: Ev<'external_review_submitted'>): void {
  const chat = ctx.chat;
  if (chat.phase === 'closed') return;
  const review = e.review;
  const byAuthor = review.author.githubId === chat.authorGithubId;

  const raisedTrusted = review.comments.map((c) => handleComment(ctx, c)).some(Boolean);
  if (!byAuthor && review.state !== 'approved' && review.body.trim() && !chat.points.some((p) => p.githubCommentId === `review:${review.id}`)) {
    ensureParticipant(chat, review.author, 'reviewer');
    raisePoint(ctx, {
      ...githubPointContent(review.body, null, null, null),
      raisedBy: who(review.author),
      origin: 'github',
      jobId: null,
      githubCommentId: `review:${review.id}`,
      githubThreadRootId: `review:${review.id}`,
      commitSha: null,
      trusted: review.trusted,
    });
  }
  if (review.state === 'approved' && !byAuthor) approve(ctx, review.author);

  // GitHub's "Add single comment" arrives as a review with state `commented` and no body:
  // treat it like a loose comment and wait for quiet. Anything else acts at once (spec §15).
  const loose = review.state === 'commented' && !review.body.trim();
  if (loose) {
    if (raisedTrusted) scheduleComments(ctx);
    return;
  }
  emit(ctx, { type: 'unschedule', key: COMMENTS_TIMER });
  advance(ctx);
}

export function onThreadResolved(ctx: Ctx, e: Ev<'thread_resolved'>): void {
  const pt = pointByThread(ctx.chat, e.threadRootId);
  if (!pt || pt.status === 'resolved') return;
  pt.status = 'resolved';
  system(ctx, `P${pt.number} resolved on GitHub`);
  advance(ctx);
}

export function onThreadUnresolved(ctx: Ctx, e: Ev<'thread_unresolved'>): void {
  const pt = pointByThread(ctx.chat, e.threadRootId);
  if (!pt || pt.status !== 'resolved' || pt.origin !== 'github') return;
  pt.status = 'open';
  system(ctx, `P${pt.number} reopened on GitHub`);
  if (pt.trusted) scheduleComments(ctx);
}

export function onHeadUpdated(ctx: Ctx, e: Ev<'head_updated'>): void {
  const chat = ctx.chat;
  // Already on this head (the webhook and a stale_head check can both report one push): nothing moved.
  if (e.after === chat.headSha) return;
  chat.headSha = e.after;
  // Our own push was announced with job.pushing; the address result handles it.
  if (e.ours || chat.phase === 'closed' || chat.isDraft) return;
  system(ctx, `New commits pushed (${e.after.slice(0, 7)})`, { before: e.before, after: e.after });

  const address = activeJobs(chat).find((j) => j.jobType === 'address');
  const a = author(chat);
  if (address && a) {
    // A human pushed while the author's agent was fixing: run that pass again on the new head.
    cancelJobs(ctx, [address], 'branch_moved');
    enqueueJob(ctx, a, 'address', null);
    return;
  }
  if (chat.phase === 'ready' || chat.phase === 'escalated') {
    for (const r of reviewers(chat)) if (r.lastReviewedSha) startReview(ctx, r);
    return;
  }
  if (chat.phase === 'addressing') {
    // The human author is working (they're not on Nitpilot): re-review once they stop pushing.
    for (const r of reviewers(chat)) {
      if (onNitpilot(r) && hasOpenAgentPoints(ctx, r.githubId)) {
        emit(ctx, { type: 'schedule', key: syncTimer(r.githubId), at: debounceAt(ctx) });
      }
    }
  }
}

export function onTimer(ctx: Ctx, e: Ev<'timer'>): void {
  const chat = ctx.chat;
  // A timer that fires after the PR closed (or went back to draft) does nothing.
  if (chat.phase === 'closed' || chat.isDraft) return;
  if (e.key === COMMENTS_TIMER) {
    advance(ctx);
    return;
  }
  if (e.key.startsWith('sync:')) {
    const r = participant(chat, e.key.slice('sync:'.length), 'reviewer');
    if (r && hasOpenAgentPoints(ctx, r.githubId)) startReview(ctx, r);
  }
}

/** Returns true when a new trusted, top-level point was raised (so the caller can debounce). */
function handleComment(ctx: Ctx, c: ExternalComment): boolean {
  const chat = ctx.chat;
  // Already seen: a redelivery, or the same comment through another event.
  if (chat.points.some((p) => p.githubCommentId === c.id)) return false;
  if (c.threadRootId) {
    handleReply(ctx, c);
    return false;
  }
  if (c.author.githubId === chat.authorGithubId) {
    say(ctx, { kind: 'human', author: who(c.author), body: c.body });
    return false;
  }
  ensureParticipant(chat, c.author, 'reviewer');
  raisePoint(ctx, {
    ...githubPointContent(c.body, c.path, c.line, c.side),
    raisedBy: who(c.author),
    origin: 'github',
    jobId: null,
    githubCommentId: c.id,
    githubThreadRootId: c.id,
    commitSha: c.commitSha,
    trusted: c.trusted,
  });
  return c.trusted;
}

function handleReply(ctx: Ctx, c: ExternalComment): void {
  const chat = ctx.chat;
  say(ctx, { kind: 'human', author: who(c.author), body: c.body, data: { threadRootId: c.threadRootId } });
  const pt = pointByThread(chat, c.threadRootId!);
  if (!pt) return;

  // The reviewer pushes back on an answered GitHub point: it's open again (spec §9.2).
  if (pt.origin === 'github' && pt.status === 'addressed' && c.author.githubId === pt.raisedBy) {
    pt.status = 'open';
    scheduleComments(ctx);
    return;
  }
  // The human author answered our reviewer agent's comment: re-review after a quiet period (spec §15).
  if (pt.origin === 'agent' && pt.status === 'open' && c.author.githubId === chat.authorGithubId) {
    pt.status = 'addressed';
    pt.authorResolution = 'answered';
    const r = participant(chat, pt.raisedBy, 'reviewer');
    if (r && onNitpilot(r)) emit(ctx, { type: 'schedule', key: syncTimer(r.githubId), at: debounceAt(ctx) });
  }
}

/** A reviewer approved on GitHub: their points are resolved and agent rounds stop for them (spec §6.3). */
function approve(ctx: Ctx, person: Person): void {
  const chat = ctx.chat;
  const r = ensureParticipant(chat, person, 'reviewer');
  r.requested = false;
  const job = activeJobFor(chat, r);
  if (job) cancelJobs(ctx, [job], 'approved');
  const remaining = chat.points.filter((p) => p.raisedBy === r.githubId && p.status !== 'resolved');
  for (const p of remaining) p.status = 'resolved';
  system(ctx, `${r.login} approved on GitHub`, { resolved: remaining.map((p) => p.number) });
}

function hasOpenAgentPoints(ctx: Ctx, reviewerGithubId: string): boolean {
  return ctx.chat.points.some((p) => p.raisedBy === reviewerGithubId && p.origin === 'agent' && (p.status === 'open' || p.status === 'addressed'));
}

function scheduleComments(ctx: Ctx): void {
  emit(ctx, { type: 'schedule', key: COMMENTS_TIMER, at: debounceAt(ctx) });
}

function debounceAt(ctx: Ctx): Date {
  return addMs(ctx.now, ctx.rules.debounce_seconds * 1000);
}

/** GitHub comments have no severity or category; they come in as minor / other. */
function githubPointContent(body: string, path: string | null, line: number | null, side: ExternalComment['side']) {
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '(empty comment)';
  return {
    path,
    line,
    side,
    severity: 'minor' as const,
    category: 'other' as const,
    title: firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine,
    body: body.trim() ? body.slice(0, 4000) : '(empty comment)',
    snippet: null,
  };
}
