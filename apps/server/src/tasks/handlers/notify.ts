import { NotifyKind } from '@nitpilot/protocol';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { transcriptUrl } from '../../lib/urls';
import type { Notifier } from '../notifier';
import type { TaskHandler } from '../runner';

const Payload = z.object({ userIds: z.array(z.string()), kind: NotifyKind, pointNumbers: z.array(z.number().int()) });

/** Copy from the design handoff's push notifications. */
export function notificationTitle(kind: NotifyKind, pr: string, points: number[]): string {
  const list = points.map((n) => `P${n}`).join(', ');
  switch (kind) {
    case 'ready':
      return `Ready for your approval: ${pr}`;
    case 'escalated':
      return `Needs you: ${pr}: ${list} need${points.length === 1 ? 's' : ''} a human decision`;
    case 'manual_review':
      return `Review waiting: ${pr} is from an outside contributor`;
    case 'failed':
      return `Agent failed: ${pr}`;
    case 'drafts':
      return `Drafts waiting: ${pr}`;
  }
}

/** Tell people they're needed (spec §16). */
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
      title: notificationTitle(kind, `${chat.repo.fullName}#${chat.number}`, pointNumbers),
      url: transcriptUrl(chat.repo.fullName, chat.number),
    });
  };
}
