import type { RepoAccess } from '../auth/repo-access';
import { prisma } from '../lib/prisma';

/** The chat you may read, with its repo; or why not. */
export type ChatAccess = { kind: 'read'; chat: { id: string; repoFullName: string } } | { kind: 'none' } | { kind: 'reauth' };

/**
 * Can this person read the chat (spec §16 "Who can see a chat")? Anyone whose GitHub account can read the repo,
 * asked with their own token and kept 5 minutes (auth/repo-access.ts). A chat that doesn't exist and one you
 * can't see are the same `none`, so nobody learns which chats exist (docs/why/chat-access-rules.md).
 * GitHub not answering is thrown, for the caller to say so.
 */
export async function chatAccess(user: { id: string }, chatId: string, access: RepoAccess): Promise<ChatAccess> {
  const chat = await prisma.prChat.findUnique({ where: { id: chatId }, select: { id: true, repo: { select: { fullName: true } } } });
  if (!chat) return { kind: 'none' };
  const answer = await access.check(user.id, chat.repo.fullName);
  return answer === 'read' ? { kind: 'read', chat: { id: chat.id, repoFullName: chat.repo.fullName } } : { kind: answer };
}
