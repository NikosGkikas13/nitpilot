import { z } from 'zod';
import { prRefOf } from '../../chats/refs';
import { writeMarker } from '../../lib/markers';
import { prisma } from '../../lib/prisma';
import type { PlatformWrites } from '../../platform/types';
import type { TaskHandler } from '../runner';
import { asUser, chatForTask, cleanerFor, nitpilotUserId } from './shared';

const Payload = z.object({ asGithubId: z.string(), replies: z.array(z.object({ pointNumber: z.number().int(), body: z.string() })) });

/** Answer points where they were raised: in their GitHub threads, as the agent's owner (spec §6.1). */
export function repliesHandler(deps: { platform: PlatformWrites }): TaskHandler {
  return async (task) => {
    const { asGithubId, replies } = Payload.parse(task.payload);
    const chat = await chatForTask(task.chatId);
    if (!chat) return;
    const userId = await nitpilotUserId(asGithubId);
    const clean = cleanerFor(chat);
    const points = await prisma.point.findMany({ where: { chatId: chat.id, number: { in: replies.map((r) => r.pointNumber) } } });

    for (const reply of replies) {
      const rootId = points.find((p) => p.number === reply.pointNumber)?.githubThreadRootId;
      if (!rootId) continue;
      const marker = writeMarker(chat.id, task.id, reply.pointNumber);
      const reuse = task.attempts > 1 ? { reuseIfContains: marker } : undefined;
      const { id } = await asUser(() => deps.platform.replyToThread(userId, prRefOf(chat), rootId, `${clean(reply.body, 4000)}\n\n${marker}`, reuse));
      await prisma.githubWrite.createMany({ data: [{ chatId: chat.id, kind: 'reply', githubId: id }], skipDuplicates: true });
    }
  };
}
