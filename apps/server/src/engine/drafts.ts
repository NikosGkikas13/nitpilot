import type { Role } from '@nitpilot/protocol';
import { advance } from './advance';
import { emit, system, type Ctx, type Ev } from './context';
import { addJob, autoFor, cancelJobs, settleDraft } from './jobs';
import { applyReview } from './results';
import { activeJobFor, activeJobs, participant } from './state';
import type { DraftState, Person } from './types';

// The Auto switch and Send / Discard on drafts, from the web app (spec §9 "Auto" and "Drafts"). Like Resolve and
// Continue (human.ts), anything that doesn't apply changes nothing: no line, no command. The route turns "nothing
// changed" into a 409. What happens to a publish job's push or failure is in results.ts, with the other job results.

/** What the switch is called on each side, as on the Settings page. */
const AUTO_NAME: Record<Role, string> = { reviewer: 'Auto-review', author: 'Auto-fix' };

/**
 * A person turns their Auto switch on or off in this chat, for a role they have. A job of theirs that is still queued
 * follows the new setting; a running job keeps the mode it started with, and a draft already waiting stays one.
 */
export function onAutoChanged(ctx: Ctx, e: Ev<'auto_changed'>): void {
  const chat = ctx.chat;
  const p = participant(chat, e.who.githubId, e.role);
  if (chat.phase === 'closed' || !p || p.auto === e.on) return;
  p.auto = e.on;
  system(ctx, `${p.login} turned ${AUTO_NAME[p.role]} ${e.on ? 'on' : 'off'}`, { role: p.role, on: e.on });

  // A publish job runs no agent: it sends a draft, whatever the switch says.
  const job = activeJobFor(chat, p);
  if (job && job.status === 'queued' && job.jobType !== 'publish') {
    const applyState = autoFor(ctx, p, job.jobType) ? 'pending' : 'draft';
    if (job.applyState !== applyState) {
      job.applyState = applyState;
      emit(ctx, { type: 'set_apply_state', jobId: job.id, applyState });
    }
  }
  // Turning Auto on hands the open points back to the author's agent after a Discard.
  if (e.on) p.byHand = false;
  advance(ctx);
}

/**
 * Send: a reviewer's draft is applied exactly as a finished auto job would have been. An author's draft commit is on
 * the laptop that made it, so a publish job pushes it (spec §11 "Publish jobs"), and the draft waits until that job
 * ends (results.ts).
 */
export function onDraftSend(ctx: Ctx, e: Ev<'draft_send'>): void {
  const draft = ownDraft(ctx, e.who, e.jobId);
  const p = draft && participant(ctx.chat, draft.participantGithubId, draft.role);
  if (!draft || !p) return;

  if (draft.jobType !== 'address') {
    system(ctx, `${p.login} sent the drafted review`, { jobId: draft.jobId });
    settleDraft(ctx, draft, 'applied');
    applyReview(ctx, { id: draft.jobId, jobType: draft.jobType, headSha: draft.headSha }, p, draft.result);
    advance(ctx);
    return;
  }
  // Already being sent: a second press changes nothing.
  if (activeJobFor(ctx.chat, p)) return;
  addJob(ctx, p, { jobType: 'publish', sinceSha: null, applyState: 'pending', draftOfId: draft.jobId });
  // "is sending": the publish job is queued, and the laptop with the draft may be offline. The banner says whether it runs.
  system(ctx, `${p.login} is sending the drafted fixes`, { jobId: draft.jobId });
  advance(ctx);
}

/**
 * Discard: the draft is dropped, and the agent doesn't start the same work again by itself, so Auto off plus Discard
 * never loops. A reviewer has taken the review over: it counts as reviewed, and nothing is raised. For the author,
 * the open points are hers to do by hand until something changes (state.ts `handBackToAgent`).
 */
export function onDraftDiscard(ctx: Ctx, e: Ev<'draft_discard'>): void {
  const draft = ownDraft(ctx, e.who, e.jobId);
  const p = draft && participant(ctx.chat, draft.participantGithubId, draft.role);
  if (!draft || !p) return;

  // Discard while it's being sent: a queued publish job is cancelled; a running one may be pushing, so its result decides.
  const publish = activeJobs(ctx.chat).find((j) => j.draftOfId === draft.jobId);
  if (publish?.status === 'running') return;
  if (publish) cancelJobs(ctx, [publish], 'draft_discarded');

  settleDraft(ctx, draft, 'discarded');
  if (draft.jobType === 'address') {
    p.byHand = true;
    system(ctx, `${p.login} discarded the drafted fixes`, { jobId: draft.jobId });
  } else {
    p.lastReviewedSha = draft.headSha;
    system(ctx, `${p.login} discarded the drafted review`, { jobId: draft.jobId });
  }
  advance(ctx);
}

/** The waiting draft with this job id, if it's this person's and the PR is open: only its owner can Send or Discard it. */
function ownDraft(ctx: Ctx, who: Person, jobId: string): DraftState | undefined {
  if (ctx.chat.phase === 'closed') return undefined;
  return ctx.chat.drafts.find((d) => d.jobId === jobId && d.participantGithubId === who.githubId);
}
