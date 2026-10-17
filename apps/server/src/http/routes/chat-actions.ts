import { BRAND, NoteRequest, type ActionResponse, type RetryResponse } from '@nitpilot/protocol';
import { Hono, type Context } from 'hono';
import type { RepoAccess } from '../../auth/repo-access';
import { requireSameOrigin, requireUser, type UserVariables } from '../../auth/request-user';
import type { SessionUser } from '../../auth/session';
import { chatAccess } from '../../chats/access';
import type { Dispatch } from '../../chats/dispatch';
import { failureKind } from '../../chats/failed-flags';
import { can, permissionFacts, type ChatAction, type PermissionFacts } from '../../chats/permissions';
import { activeJobFor } from '../../engine/state';
import type { ChatState, DecideOutput, Person } from '../../engine/types';
import { getEnv } from '../../lib/env';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../errors';
import { askingGithub, readable } from './chats';

type Ctx = Context<{ Variables: UserVariables }>;

/**
 * The chat's writes (spec §10 "Chat writes"): notes, Resolve, Continue, Review and Retry. Each one, in order: who
 * you are (`requireUser`), that the request came from our own pages (`requireSameOrigin`), that GitHub shows you
 * the repo (`chatAccess`), that your role allows it (`can`), then one engine event under the chat's lock. An event
 * that changes nothing (someone was faster) is a 409 that says why (docs/why/races-and-conflicts.md).
 */
export function chatActionRoutes(deps: { access: RepoAccess; dispatch: Dispatch }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  /** The chat, if this person may do this in it now; otherwise the error that says why not. */
  async function allowed(c: Ctx, action: ChatAction): Promise<{ chatId: string; who: Person }> {
    const user = c.get('user');
    const chatId = c.req.param('id')!;
    readable(await askingGithub(() => chatAccess(user, chatId, deps.access)));
    const chat = await prisma.prChat.findUnique({ where: { id: chatId }, include: { participants: { include: { jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } } }, points: true } });
    if (!chat) throw new HttpError('not_found', 'No such chat.');
    const facts = permissionFacts(chat);
    if ((action.kind === 'resolve' || action.kind === 'continue') && !facts.points.some((p) => p.number === action.point)) {
      throw new HttpError('not_found', 'No such point.');
    }
    if (facts.closed) throw new HttpError('conflict', CLOSED);
    if (!can(user, facts, action)) throw new HttpError('forbidden', forbidden(action, facts));
    return { chatId, who: personOf(user) };
  }

  app.post('/api/chats/:id/notes', requireUser, requireSameOrigin, async (c) => {
    const { body } = NoteRequest.parse(await c.req.json());
    const { chatId, who } = await allowed(c, { kind: 'note' });
    const out = await deps.dispatch(chatId, { type: 'human_note', author: who, body });
    if (out.timeline.length === 0) throw new HttpError('conflict', CLOSED);
    return ok(c);
  });

  app.post('/api/chats/:id/points/:n/resolve', requireUser, requireSameOrigin, async (c) => {
    const point = pointNumber(c);
    const { chatId, who } = await allowed(c, { kind: 'resolve', point });
    const out = await deps.dispatch(chatId, { type: 'point_resolve', who, point });
    if (out.timeline.length === 0) throw new HttpError('conflict', notEscalated(out.chat, point));
    return ok(c);
  });

  app.post('/api/chats/:id/points/:n/continue', requireUser, requireSameOrigin, async (c) => {
    const point = pointNumber(c);
    const { chatId, who } = await allowed(c, { kind: 'continue', point });
    const out = await deps.dispatch(chatId, { type: 'point_continue', who, point });
    if (out.timeline.length === 0) throw new HttpError('conflict', notEscalated(out.chat, point));
    return ok(c);
  });

  // An outside contributor's PR: the requested reviewer starts the review by hand (spec §6.1).
  app.post('/api/chats/:id/review', requireUser, requireSameOrigin, async (c) => {
    const { chatId, who } = await allowed(c, { kind: 'review' });
    const out = await deps.dispatch(chatId, { type: 'manual_review', reviewer: who });
    if (!queuedFor(out, who)) {
      if (out.chat.closed) throw new HttpError('conflict', CLOSED);
      if (out.chat.isDraft) throw new HttpError('conflict', "This PR is a draft. Your agent starts once it's ready for review.");
      throw new HttpError('conflict', whyNoReview(out.chat, who));
    }
    return ok(c);
  });

  // `nitpilot retry` (spec §10), and the web app's Retry button: run my failed job on this PR again. Only your own
  // failed job (that's the role check), with Plan 1's answers. A browser is asked about read access like every other
  // write; a CLI isn't, as in Plan 1 (docs/why/chat-access-rules.md).
  app.post('/api/chats/:id/retry', requireUser, requireSameOrigin, async (c) => {
    const user = c.get('user');
    const chatId = c.req.param('id');
    if (c.get('via') === 'session') readable(await askingGithub(() => chatAccess(user, chatId, deps.access)));
    const failure = await failureKind(chatId, user.githubId);
    if (failure === null) {
      // A press that came a moment after another one: the first cleared the flag and queued the job.
      if (await hasActiveJob(chatId, user.githubId)) throw new HttpError('conflict', 'Your agent is already on it.');
      throw new HttpError('conflict', 'Nothing of yours failed on this PR.');
    }
    if (failure === 'github_post') {
      throw new HttpError(
        'conflict',
        `Your agent didn't fail on this PR: posting its review or replies to GitHub did, and running the agent again won't fix that. If \`${BRAND.cli} status\` says GitHub access expired, sign in again at ${getEnv().PUBLIC_URL}.`,
      );
    }
    const who = personOf(user);
    const out = await deps.dispatch(chatId, { type: 'retry_requested', who });
    if (out.timeline.length === 0) {
      // The engine changed nothing: still flagged means it won't run here any more; not flagged means a retry
      // that was a moment faster already cleared it.
      if (stillFailed(out.chat, who)) throw new HttpError('conflict', "Nothing to retry: the PR is closed, or you're no longer a reviewer on it.");
      throw new HttpError('conflict', 'Your agent is already on it.');
    }
    // The job is queued now, or it starts by itself once the step before it is done (the author's agent is
    // fixing, or the PR is a draft).
    const body: RetryResponse = { status: queuedFor(out, who) ? 'queued' : 'waiting' };
    return c.json(body);
  });

  return app;
}

const CLOSED = 'This PR is closed, so its chat is read-only.';

function ok(c: Ctx): Response {
  const body: ActionResponse = { ok: true };
  return c.json(body);
}

function personOf(user: SessionUser): Person {
  return { githubId: user.githubId, login: user.login, isBot: false, userId: user.id };
}

/** `:n` in the path: plain digits, or the point doesn't exist. */
function pointNumber(c: Ctx): number {
  const raw = c.req.param('n') ?? '';
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError('not_found', 'No such point.');
  return n;
}

/** Why someone may not do this, in a sentence they can act on. */
function forbidden(action: ChatAction, facts: PermissionFacts): string {
  switch (action.kind) {
    case 'note':
      return 'Only the author and the reviewers can message the agents.';
    case 'resolve': {
      const point = facts.points.find((p) => p.number === action.point);
      if (point?.origin === 'github') return `P${action.point} came from a GitHub comment: resolve its thread on GitHub.`;
      return `Only the reviewer who raised P${action.point} can resolve it.`;
    }
    case 'continue':
      return `Only the author or the reviewer who raised P${action.point} can let the agents continue on it.`;
    case 'review':
      return 'Only a requested reviewer can start the review, and only on a PR from an outside contributor.';
    case 'retry':
      return 'Nothing of yours failed on this PR.';
  }
}

/** Why Resolve or Continue changed nothing: the point moved on while the request was on its way. */
function notEscalated(chat: ChatState, point: number): string {
  if (chat.closed) return CLOSED;
  const status = chat.points.find((p) => p.number === point)?.status;
  if (status === 'resolved') return `P${point} is already resolved.`;
  return `P${point} isn't escalated any more: the agents have it.`;
}

function queuedFor(out: DecideOutput, who: Person): boolean {
  return out.commands.some((cmd) => cmd.type === 'enqueue_job' && cmd.participant.githubId === who.githubId);
}

/** Why Review started nothing, when the PR is open and not a draft: someone was faster, or the author's agent goes first. */
function whyNoReview(chat: ChatState, who: Person): string {
  const you = chat.participants.find((p) => p.githubId === who.githubId && p.role === 'reviewer');
  if (you && activeJobFor(chat, you)) return 'Your agent is already on it.';
  if (you?.attention === 'manual_review') return "The author's agent is fixing the PR first. Press Review again once it's done.";
  return 'Your agent already reviewed the latest commit.';
}

/** This person's agent has a job in this chat that is queued or running. */
async function hasActiveJob(chatId: string, githubId: string): Promise<boolean> {
  const count = await prisma.job.count({ where: { chatId, participant: { githubId }, status: { in: ['queued', 'running'] } } });
  return count > 0;
}

function stillFailed(chat: ChatState, who: Person): boolean {
  return chat.participants.some((p) => p.githubId === who.githubId && p.attention === 'failed');
}
