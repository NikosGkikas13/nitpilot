import { advance } from './advance';
import { system, type Ctx, type Ev } from './context';
import { author, onNitpilot, pointByNumber, roundLimit } from './state';

// What people decide in the web app about an escalated point (spec §9.2). Anything that doesn't apply changes
// nothing: no line, no command. The route turns "nothing changed" into a 409 (http/routes/chat-actions.ts).

/** Resolve: only the reviewer who raised the point, and only an agent's point (a GitHub point is resolved on GitHub). */
export function onPointResolve(ctx: Ctx, e: Ev<'point_resolve'>): void {
  const chat = ctx.chat;
  const pt = pointByNumber(chat, e.point);
  if (chat.phase === 'closed' || !pt || pt.status !== 'escalated') return;
  if (pt.origin !== 'agent' || pt.raisedBy !== e.who.githubId) return;
  pt.status = 'resolved';
  pt.escalationReason = null;
  system(ctx, `${e.who.login} resolved P${pt.number}`, { point: pt.number });
  advance(ctx);
}

/**
 * Continue: the author or the reviewer who raised the point hands it back to the agents. At the round limit that
 * also grants one more address pass, when the author's agent is the one who would run it. A reopened point stays
 * open even in an always-escalate category: that check runs only when a point is raised (points.ts).
 */
export function onPointContinue(ctx: Ctx, e: Ev<'point_continue'>): void {
  const chat = ctx.chat;
  const pt = pointByNumber(chat, e.point);
  if (chat.phase === 'closed' || !pt || pt.status !== 'escalated') return;
  if (e.who.githubId !== chat.authorGithubId && e.who.githubId !== pt.raisedBy) return;
  const a = author(chat);
  const extraRound = !!a && onNitpilot(a) && chat.addressPasses >= roundLimit(ctx);
  if (extraRound) chat.extraRounds += 1;
  pt.status = 'open';
  pt.escalationReason = null;
  system(ctx, `${e.who.login} let the agents continue on P${pt.number}${extraRound ? ' · one more round' : ''}`, { point: pt.number, extraRound });
  advance(ctx);
}
