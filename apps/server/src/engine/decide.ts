import { actorOf, emit, type Ctx } from './context';
import { onAutoChanged, onDraftDiscard, onDraftSend } from './drafts';
import {
  onCommentDeleted, onExternalComment, onHeadUpdated, onReviewSubmitted, onThreadResolved, onThreadUnresolved, onTimer,
} from './external';
import {
  onHumanNote, onManualReview, onPrClosed, onPrOpened, onPrReady, onPrReopened, onPrRetargeted, onPrToDraft,
  onReviewRequestRemoved, onReviewRequested,
} from './lifecycle';
import { onPointContinue, onPointResolve } from './human';
import { onJobCompleted, onJobFailed, onRetryRequested } from './results';
import { author, onNitpilot } from './state';
import type { DecideInput, DecideOutput } from './types';
import { onSignedInAgain, onWriteFailed } from './writes';

/**
 * The workflow rules, as one pure function (spec §9): (state, event) → (state, timeline, commands).
 * See docs/why/pure-engine.md.
 */
export function decide(input: DecideInput): DecideOutput {
  const ctx: Ctx = {
    chat: structuredClone(input.chat),
    rules: input.rules,
    now: input.now,
    actor: actorOf(input.event),
    timeline: [],
    commands: [],
  };
  const event = input.event;

  switch (event.type) {
    case 'pr_opened': onPrOpened(ctx, event); break;
    case 'pr_ready': onPrReady(ctx); break;
    case 'pr_to_draft': onPrToDraft(ctx); break;
    case 'pr_closed': onPrClosed(ctx, event); break;
    case 'pr_reopened': onPrReopened(ctx); break;
    case 'review_requested': onReviewRequested(ctx, event); break;
    case 'review_request_removed': onReviewRequestRemoved(ctx, event); break;
    case 'manual_review': onManualReview(ctx, event); break;
    case 'human_note': onHumanNote(ctx, event); break;
    case 'job_completed': onJobCompleted(ctx, event); break;
    case 'external_comment': onExternalComment(ctx, event); break;
    case 'external_comment_deleted': onCommentDeleted(ctx, event); break;
    case 'external_review_submitted': onReviewSubmitted(ctx, event); break;
    case 'thread_resolved': onThreadResolved(ctx, event); break;
    case 'thread_unresolved': onThreadUnresolved(ctx, event); break;
    case 'head_updated': onHeadUpdated(ctx, event); break;
    case 'timer': onTimer(ctx, event); break;
    case 'job_failed': onJobFailed(ctx, event); break;
    case 'retry_requested': onRetryRequested(ctx, event); break;
    case 'write_failed': onWriteFailed(ctx, event); break;
    case 'pr_retargeted': onPrRetargeted(ctx, event); break;
    case 'signed_in_again': onSignedInAgain(ctx, event); break;
    case 'point_resolve': onPointResolve(ctx, event); break;
    case 'point_continue': onPointContinue(ctx, event); break;
    case 'auto_changed': onAutoChanged(ctx, event); break;
    case 'draft_send': onDraftSend(ctx, event); break;
    case 'draft_discard': onDraftDiscard(ctx, event); break;
    default: {
      // If a new DomainEvent type is added without a case, this line stops compiling.
      const unhandled: never = event;
      throw new Error(`Unhandled event: ${JSON.stringify(unhandled)}`);
    }
  }

  finalize(ctx);
  return { chat: ctx.chat, timeline: ctx.timeline, commands: ctx.commands };
}

function finalize(ctx: Ctx): void {
  refreshAttention(ctx);
  if (ctx.timeline.length > 0 && hasAgentToAgentPoints(ctx)) emit(ctx, { type: 'upsert_summary' });
}

/** "Needs you" for escalations: the author and whoever raised an escalated point. */
function refreshAttention(ctx: Ctx): void {
  const chat = ctx.chat;
  const escalated = chat.points.filter((p) => p.status === 'escalated');
  const needed = new Set(escalated.length > 0 ? [chat.authorGithubId, ...escalated.map((p) => p.raisedBy)] : []);
  for (const p of chat.participants) {
    if (needed.has(p.githubId) && onNitpilot(p)) {
      if (p.attention === 'none') p.attention = 'decision';
    } else if (p.attention === 'decision') {
      p.attention = 'none';
    }
  }
}

/** The summary comment only exists in agent-to-agent mode (spec §15). */
function hasAgentToAgentPoints(ctx: Ctx): boolean {
  const a = author(ctx.chat);
  return !!a && onNitpilot(a) && ctx.chat.points.some((p) => p.origin === 'agent');
}
