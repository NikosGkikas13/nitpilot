import { NotifyKind } from '@nitpilot/protocol';
import { z } from 'zod';
import { can, permissionFacts } from '../../chats/permissions';
import { prisma } from '../../lib/prisma';
import { transcriptUrl } from '../../lib/urls';
import type { DecisionAction, Notification, Notifier } from '../notifier';
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
    const notification: Notification = {
      userIds,
      kind,
      chatId: chat.id,
      ...notificationText(kind, `${chat.repo.fullName}#${chat.number}`, pointNumbers),
      url: transcriptUrl(chat.repo.fullName, chat.number),
    };
    if (kind !== 'escalated' || pointNumbers.length !== 1) {
      await deps.notifier.notify(notification);
      return;
    }
    // One point: each person's push offers the buttons they may tap, so people are grouped by those buttons.
    const point = pointNumbers[0]!;
    const buttons = await decisionButtons(chat.id, userIds, point);
    const groups = new Map<string, { actions: DecisionAction[]; userIds: string[] }>();
    for (const id of userIds) {
      const actions = buttons.get(id) ?? [];
      const key = actions.join(',');
      const group = groups.get(key) ?? { actions, userIds: [] };
      group.userIds.push(id);
      groups.set(key, group);
    }
    for (const { actions, userIds: ids } of groups.values()) {
      await deps.notifier.notify({ ...notification, userIds: ids, ...(actions.length > 0 ? { decision: { point, actions } } : {}) });
    }
  };
}

const DECISIONS: readonly DecisionAction[] = ['resolve', 'continue'];

/**
 * Which of Resolve and Continue each person may use on this point, by the chat's own rules (chats/permissions.ts), so a
 * button on the push never leads to a 403: the agent's owner who raised it gets both, the PR's author only Continue.
 */
async function decisionButtons(chatId: string, userIds: string[], point: number): Promise<Map<string, DecisionAction[]>> {
  const chat = await prisma.prChat.findUniqueOrThrow({
    where: { id: chatId },
    include: { participants: { include: { jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } } }, points: true },
  });
  const facts = permissionFacts({ ...chat, waitingDrafts: [] });
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, githubId: true } });
  return new Map(users.map((u) => [u.id, DECISIONS.filter((kind) => can(u, facts, { kind, point }))]));
}
