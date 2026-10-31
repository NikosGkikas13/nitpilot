import type { RepoAccess } from '../auth/repo-access';
import type { Repo } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { rulesFromJson } from './rules';

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
export async function chatAccessByPath(user: { id: string }, path: ChatPath, access: RepoAccess): Promise<ChatAccess> {
  const parsed = parseChatPath(path);
  if (!parsed) return { kind: 'none' };
  const { fullName, number } = parsed;
  const answer = await access.check(user.id, fullName);
  if (answer !== 'read') return { kind: answer };
  const chat = await prisma.prChat.findFirst({ where: { number, repo: { fullName } }, select: { id: true } });
  return chat ? { kind: 'read', chat: { id: chat.id, repoFullName: fullName } } : { kind: 'none' };
}

export type ChatPath = { owner: string; repo: string; number: string };

/** The repo and PR number in a chat's address, or null when they can't be a real GitHub repo and PR. */
function parseChatPath(path: ChatPath): { fullName: string; number: number } | null {
  // Plain digits only: Number() would also take "1e2", "0x2a" or " 42".
  const number = /^\d+$/.test(path.number) ? Number(path.number) : NaN;
  if (!isGithubName(path.owner) || !isGithubName(path.repo) || !Number.isSafeInteger(number) || number <= 0) return null;
  return { fullName: `${path.owner}/${path.repo}`, number };
}

/**
 * Can someone who isn't signed in read this chat (spec §16 "Who can see a chat")? Only when its repo is public both
 * as we stored it and as GitHub says now (`isPublic`, so a missed `privatized` webhook can't leave a private repo's
 * chats open), and its `.nitpilot.yml` hasn't set `public_chats: false`. Every no is the same `none`. What they
 * then see is trimmed (loadPublicChatPage).
 */
export async function publicChatAccessByPath(path: ChatPath, isPublic: (repo: Repo) => Promise<boolean>): Promise<{ kind: 'read'; chat: { id: string; repoFullName: string } } | { kind: 'none' }> {
  const parsed = parseChatPath(path);
  if (!parsed) return { kind: 'none' };
  const chat = await prisma.prChat.findFirst({ where: { number: parsed.number, repo: { fullName: parsed.fullName } }, select: { id: true, repo: true } });
  if (!chat || chat.repo.private || !rulesFromJson(chat.repo.rulesJson).public_chats) return { kind: 'none' };
  if (!(await isPublic(chat.repo))) return { kind: 'none' };
  return { kind: 'read', chat: { id: chat.id, repoFullName: chat.repo.fullName } };
}

/** The stored GitHub sign-in is usable: present and not marked expired (what `getUserToken` checks first). */
async function githubSignInOk(userId: string): Promise<boolean> {
  const auth = await prisma.githubAuth.findUnique({ where: { userId }, select: { status: true } });
  return auth?.status === 'ok';
}
