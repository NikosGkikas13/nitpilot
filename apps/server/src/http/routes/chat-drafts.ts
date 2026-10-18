import { AutoRequest, FailureReason } from '@nitpilot/protocol';
import { Hono } from 'hono';
import type { RepoAccess } from '../../auth/repo-access';
import { requireSameOrigin, requireUser, type UserVariables } from '../../auth/request-user';
import type { Dispatch } from '../../chats/dispatch';
import { AUTO_NAME } from '../../engine/drafts';
import { DRAFT_OUT_OF_DATE } from '../../engine/results';
import type { ChatState } from '../../engine/types';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../errors';
import { CLOSED, mayAct, ok, readableChat, type Ctx } from './chat-actions';

/**
 * The Auto switch and Send / Discard on drafts (spec §10 "Chat writes", §9 "Auto" and "Drafts"). The same checks and
 * answers as the other chat writes (routes/chat-actions.ts): who you are, the Origin, read access, your role (`can`:
 * only your own switch, only your own agent's drafts), then one engine event under the chat's lock. An event that
 * changes nothing (a second press, a draft that was sent or discarded meanwhile) is a 409 that says why
 * (docs/why/races-and-conflicts.md). docs/why/drafts-and-publish-jobs.md explains drafts and publish jobs.
 */
export function chatDraftRoutes(deps: { access: RepoAccess; dispatch: Dispatch }): Hono<{ Variables: UserVariables }> {
  const app = new Hono<{ Variables: UserVariables }>();

  app.put('/api/chats/:id/auto', requireUser, requireSameOrigin, async (c) => {
    const { role, on } = AutoRequest.parse(await c.req.json());
    const chatId = await readableChat(c, deps.access);
    const who = await mayAct(c, chatId, { kind: 'auto', role });
    const out = await deps.dispatch(chatId, { type: 'auto_changed', who, role, on });
    // Nothing changed: the switch was already there (a second press), or the PR closed meanwhile.
    if (out.timeline.length === 0) throw new HttpError('conflict', out.chat.closed ? CLOSED : `${AUTO_NAME[role]} is already ${on ? 'on' : 'off'}.`);
    return ok(c);
  });

  // A reviewer's draft is applied now; an author's draft queues a publish job for the laptop that holds its commit.
  app.post('/api/chats/:id/drafts/:jobId/send', requireUser, requireSameOrigin, async (c) => {
    const { chatId, who, draftId } = await allowedOnDraft(c);
    const out = await deps.dispatch(chatId, { type: 'draft_send', who, jobId: draftId });
    if (out.timeline.length === 0) throw new HttpError('conflict', await whyNot('send', out.chat, chatId, draftId));
    return ok(c);
  });

  app.post('/api/chats/:id/drafts/:jobId/discard', requireUser, requireSameOrigin, async (c) => {
    const { chatId, who, draftId } = await allowedOnDraft(c);
    const out = await deps.dispatch(chatId, { type: 'draft_discard', who, jobId: draftId });
    if (out.timeline.length === 0) throw new HttpError('conflict', await whyNot('discard', out.chat, chatId, draftId));
    return ok(c);
  });

  /**
   * The draft in the path, if this person may Send or Discard it: read access first, then the draft (a 404 for a job
   * that isn't a finished agent job of this chat), then whose it is. Whether it still waits is the engine's to say.
   */
  async function allowedOnDraft(c: Ctx) {
    const chatId = await readableChat(c, deps.access);
    const draft = await prisma.job.findFirst({
      where: { id: c.req.param('jobId'), chatId, status: 'done', type: { not: 'publish' } },
      select: { id: true, participant: { select: { githubId: true } } },
    });
    if (!draft) throw new HttpError('not_found', 'No such draft.');
    const who = await mayAct(c, chatId, { kind: 'draft', owner: draft.participant.githubId });
    return { chatId, who, draftId: draft.id };
  }

  return app;
}

/**
 * Why Send or Discard changed nothing: the draft moved on while the request was on its way (it was sent, discarded or
 * went out of date), its publish job is on its way, or the PR closed.
 */
async function whyNot(press: 'send' | 'discard', chat: ChatState, chatId: string, draftId: string): Promise<string> {
  if (chat.closed) return CLOSED;
  const [draft, publish] = await Promise.all([
    prisma.job.findUniqueOrThrow({ where: { id: draftId }, select: { applyState: true } }),
    prisma.job.findFirst({ where: { draftOfId: draftId }, orderBy: { createdAt: 'desc' }, select: { status: true } }),
  ]);
  if (publish?.status === 'queued' || publish?.status === 'running') {
    // Discard cancels a publish job that is still queued, so a Discard that changed nothing found it running.
    return press === 'send' ? 'That draft is already being sent.' : "That draft is being sent right now, so it can't be discarded.";
  }
  if (draft.applyState === 'applied') return 'That draft was already sent.';
  if (draft.applyState === 'discarded') {
    const outOfDate = await outOfDateReason(chatId, draftId);
    return outOfDate ? `That draft is out of date: ${outOfDate}.` : 'That draft was already discarded.';
  }
  // Still waiting, and the engine held it anyway: another job of this person's is at work in this chat.
  return 'Your agent is already at work on this PR. Try again once it has finished.';
}

/**
 * Why the engine found this draft out of date, if it did: its line "The drafted fixes are out of date: …" is the one
 * system item about the draft (`data.jobId`) that carries a failure `reason`. The publish job's stored failure can't
 * say it: a retryable `setup_failed` that later failed for good leaves the draft waiting, to be discarded by hand.
 */
async function outOfDateReason(chatId: string, draftId: string): Promise<string | undefined> {
  const lines = await prisma.message.findMany({ where: { chatId, kind: 'system', data: { path: ['jobId'], equals: draftId } }, select: { data: true } });
  for (const { data } of lines) {
    const reason = FailureReason.safeParse((data as { reason?: unknown } | null)?.reason);
    // A reason that doesn't make a draft out of date (a line about something else that happened to it): keep looking.
    if (!reason.success) continue;
    const sentence = DRAFT_OUT_OF_DATE[reason.data];
    if (sentence) return sentence;
  }
  return undefined;
}
