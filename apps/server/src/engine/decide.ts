import { emit, type Ctx } from './context';
import {
  onHumanNote, onManualReview, onPrClosed, onPrOpened, onPrReady, onPrReopened, onPrToDraft,
  onReviewRequestRemoved, onReviewRequested,
} from './lifecycle';
import { author, onNitpilot } from './state';
import type { DecideInput, DecideOutput } from './types';

/**
 * The workflow rules, as one pure function (spec §9): (state, event) → (state, timeline, commands).
 * See docs/why/pure-engine.md.
 */
export function decide(input: DecideInput): DecideOutput {
  const ctx: Ctx = {
    chat: structuredClone(input.chat),
    rules: input.rules,
    now: input.now,
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
    // Tasks 8–10 add the remaining event types and make this switch exhaustive.
    default: break;
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
