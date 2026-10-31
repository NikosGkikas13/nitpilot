import type { Repo } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { publicChatAccessByPath, type ChatPath } from './access';

/** What a shared chat link's preview card says (Slack, X, LinkedIn, iMessage). Plain text: the page escapes it. */
export type ChatPreview = { title: string; description: string; path: string };

const PHASE_WORDS: Record<string, string> = {
  idle: 'waiting for a review',
  reviewing: 'agents reviewing',
  addressing: "author's agent fixing",
  ready: 'ready to approve',
  escalated: 'needs a human decision',
  closed: 'closed',
};

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The card for a chat a signed-out visitor may read, or null. Exactly the no-sign-in route's check
 * (publicChatAccessByPath with the same cached `isPublic`), so a card never shows a chat that route wouldn't.
 */
export async function chatPreview(path: ChatPath, isPublic: (repo: Repo) => Promise<boolean>): Promise<ChatPreview | null> {
  const access = await publicChatAccessByPath(path, isPublic);
  if (access.kind === 'none') return null;
  const chat = await prisma.prChat.findUniqueOrThrow({
    where: { id: access.chat.id },
    select: { number: true, title: true, phase: true, round: true, merged: true, _count: { select: { points: true } } },
  });
  const status = chat.merged ? 'merged' : (PHASE_WORDS[chat.phase] ?? chat.phase);
  return {
    title: `${chat.title} · ${access.chat.repoFullName}#${chat.number}`,
    description: [count(chat._count.points, 'point'), count(chat.round, 'round'), status].join(' · '),
    path: `/c/${access.chat.repoFullName}/${chat.number}`,
  };
}
