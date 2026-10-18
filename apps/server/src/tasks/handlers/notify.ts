import { NotifyKind } from '@nitpilot/protocol';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { transcriptUrl } from '../../lib/urls';
import type { Notifier } from '../notifier';
import type { TaskHandler } from '../runner';

const Payload = z.object({ userIds: z.array(z.string()), kind: NotifyKind, pointNumbers: z.array(z.number().int()) });

/**
 * The words of a notification, from the design handoff's push copy (§8): a heading, and the detail under it. A push
 * shows them as its title and body; the CLI prints them on one line ("Ready for your approval: acme/shop-api#142").
 */
export function notificationText(kind: NotifyKind, pr: string, points: number[]): { title: string; body: string } {
  const list = points.map((n) => `P${n}`).join(', ');
  switch (kind) {
    case 'ready':
      return { title: 'Ready for your approval', body: pr };
    case 'escalated':
      return { title: 'Needs you', body: `${pr}: ${list} need${points.length === 1 ? 's' : ''} a human decision` };
    case 'manual_review':
      return { title: 'Review waiting', body: `${pr} is from an outside contributor` };
    case 'failed':
      return { title: 'Agent failed', body: pr };
    case 'drafts':
      return { title: 'Drafts waiting', body: pr };
  }
}

/** Tell people they're needed (spec §16): by Web Push first, then the CLI (main.ts builds the notifier). */
export function notifyHandler(deps: { notifier: Notifier }): TaskHandler {
  return async (task) => {
    const { userIds, kind, pointNumbers } = Payload.parse(task.payload);
    if (!task.chatId) return;
    const chat = await prisma.prChat.findUnique({ where: { id: task.chatId }, include: { repo: true } });
    if (!chat) return;
    await deps.notifier.notify({
      userIds,
      kind,
      chatId: chat.id,
      ...notificationText(kind, `${chat.repo.fullName}#${chat.number}`, pointNumbers),
      url: transcriptUrl(chat.repo.fullName, chat.number),
    });
  };
}
