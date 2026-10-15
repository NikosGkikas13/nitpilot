import { prisma } from '../lib/prisma';
import type { PlatformReads } from '../platform/types';
import type { Dispatch } from './dispatch';
import { prRefOf } from './refs';
import { isOurPush } from './route-event';

/**
 * A CLI found the PR on another head than its job (`stale_head`). Usually GitHub's pull ref is just a few
 * seconds behind, and the retry sorts it out. But a push webhook that arrived late or out of order can leave
 * the chat on an old head, and then every retry would fail the same way. So ask GitHub where the PR really
 * is, and if the chat is wrong, move it there like a push would (spec §9.4).
 */
export async function refreshHead(chatId: string, deps: { platform: PlatformReads; dispatch: Dispatch }): Promise<void> {
  const chat = await prisma.prChat.findUniqueOrThrow({ where: { id: chatId }, include: { repo: true } });
  const { headSha } = await deps.platform.getPr(prRefOf(chat));
  if (headSha === chat.headSha) return;
  await deps.dispatch(chat.id, { type: 'head_updated', before: chat.headSha, after: headSha, ours: await isOurPush(chat, headSha) });
}
