import { NeedsReauthError } from '../../auth/user-tokens';
import { prisma } from '../../lib/prisma';
import { sanitizeForGithub } from '@nitpilot/protocol';
import { PermanentTaskError } from '../runner';

/** The chat a task belongs to, with what writes need. Null if it was deleted meanwhile. */
export async function chatForTask(chatId: string | null) {
  if (!chatId) return null;
  return prisma.prChat.findUnique({ where: { id: chatId }, include: { repo: true, participants: true } });
}

/** Clean agent text, letting through mentions of the people in this PR only. */
export function cleanerFor(chat: { participants: { login: string }[] }) {
  const logins = chat.participants.map((p) => p.login);
  return (text: string, maxLength: number) => sanitizeForGithub(text, { allowedMentions: logins, maxLength });
}

/** The Nitpilot account of a GitHub user, or a permanent failure: we only post as people who use Nitpilot. */
export async function nitpilotUserId(githubId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { githubId } });
  if (!user) throw new PermanentTaskError(`GitHub user ${githubId} does not use Nitpilot`);
  return user.id;
}

/** Writes in a user's name stop when their GitHub sign-in expired (spec §15); retrying can't help. */
export async function asUser<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof NeedsReauthError) throw new PermanentTaskError(`${err.message}; writes in their name are paused until they sign in again`, { cause: err });
    throw err;
  }
}
