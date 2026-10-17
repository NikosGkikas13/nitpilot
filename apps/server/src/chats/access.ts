import type { RepoAccess } from '../auth/repo-access';
import { prisma } from '../lib/prisma';

/** The chat you may read, with its repo; or why not. */
export type ChatAccess = { kind: 'read'; chat: { id: string; repoFullName: string } } | { kind: 'none' } | { kind: 'reauth' };

/** GitHub owner and repo names: letters, digits, `-`, `_` and `.`. They go into a GitHub API path, so nothing else is let through. */
export const isGithubName = (s: string) => /^[A-Za-z0-9_.-]+$/.test(s) && s !== '.' && s !== '..';

/**
 * Can this person read the chat (spec §16 "Who can see a chat")? Anyone whose GitHub account can read the repo,
 * asked with their own token and kept 5 minutes (auth/repo-access.ts). A chat that doesn't exist and one you
 * can't see are the same `none`, so nobody learns which chats exist (docs/why/chat-access-rules.md).
 * GitHub not answering is thrown, for the caller to say so.
 */
export async function chatAccess(user: { id: string }, chatId: string, access: RepoAccess): Promise<ChatAccess> {
  const chat = await prisma.prChat.findUnique({ where: { id: chatId }, select: { id: true, repo: { select: { fullName: true } } } });
  // No chat to ask GitHub about: an expired sign-in still hears "sign in again", as it would for one that exists.
  if (!chat) return (await githubSignInOk(user.id)) ? { kind: 'none' } : { kind: 'reauth' };
  const answer = await access.check(user.id, chat.repo.fullName);
  return answer === 'read' ? { kind: 'read', chat: { id: chat.id, repoFullName: chat.repo.fullName } } : { kind: answer };
}

/**
 * The same, for the chat screen's address, `/c/:owner/:repo/:number`. GitHub is asked about the repo before the
 * chat is looked up: someone whose GitHub sign-in expired is asked to sign in again, whether or not that chat
 * exists.
 */
export async function chatAccessByPath(user: { id: string }, path: { owner: string; repo: string; number: string }, access: RepoAccess): Promise<ChatAccess> {
  // Plain digits only: Number() would also take "1e2", "0x2a" or " 42".
  const number = /^\d+$/.test(path.number) ? Number(path.number) : NaN;
  if (!isGithubName(path.owner) || !isGithubName(path.repo) || !Number.isSafeInteger(number) || number <= 0) return { kind: 'none' };
  const fullName = `${path.owner}/${path.repo}`;
  const answer = await access.check(user.id, fullName);
  if (answer !== 'read') return { kind: answer };
  const chat = await prisma.prChat.findFirst({ where: { number, repo: { fullName } }, select: { id: true } });
  return chat ? { kind: 'read', chat: { id: chat.id, repoFullName: fullName } } : { kind: 'none' };
}

/** The stored GitHub sign-in is usable: present and not marked expired (what `getUserToken` checks first). */
async function githubSignInOk(userId: string): Promise<boolean> {
  const auth = await prisma.githubAuth.findUnique({ where: { userId }, select: { status: true } });
  return auth?.status === 'ok';
}
