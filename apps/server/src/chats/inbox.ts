import type { Attention, InboxRow, InboxStatus, Phase, Role } from '@nitpilot/protocol';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { loadActivities, type LiveClis } from './activity';
import { inboxStatus } from './inbox-status';
import { rulesFromJson } from './rules';

/** How long a closed or merged PR stays in the inbox. */
export const CLOSED_KEEP_MS = 14 * 86_400_000;

/** The most rows the inbox lists. */
export const MAX_ROWS = 200;

/** How long the "last activity" line may be. */
const LAST_ACTIVITY_CHARS = 120;

/** The person whose inbox it is. */
export type InboxViewer = { id: string; githubId: string; login: string };

/** Each of the viewer's participant rows comes with its chat, the chat's people and its active jobs. */
const WITH_CHAT = {
  chat: {
    include: {
      repo: true,
      participants: { orderBy: { createdAt: 'asc' } },
      jobs: { where: { status: { in: ['queued', 'running'] } }, select: { participant: { select: { githubId: true } } } },
    },
  },
} satisfies Prisma.ParticipantInclude;

type Mine = Prisma.ParticipantGetPayload<{ include: typeof WITH_CHAT }>;
type Chat = Mine['chat'];

/** Open chats, and those closed in the last 14 days: the chats an inbox lists. */
function inInbox(now: Date): Prisma.PrChatWhereInput {
  const closedSince = new Date(now.getTime() - CLOSED_KEEP_MS);
  return { OR: [{ closedAt: null }, { closedAt: { gte: closedSince } }] };
}

/**
 * Your inbox (spec §16): one row per chat and role you have in it, open chats and those closed in the last
 * 14 days, newest first. Every fact for every row is read with a fixed number of queries, however many
 * chats there are (docs/why/n-plus-one-queries.md).
 */
export async function loadInboxRows(user: InboxViewer, clis: LiveClis, now = new Date()): Promise<InboxRow[]> {
  const mine = await prisma.participant.findMany({
    where: { githubId: user.githubId, chat: inInbox(now) },
    include: WITH_CHAT,
    orderBy: [{ chat: { updatedAt: 'desc' } }, { role: 'asc' }],
    take: MAX_ROWS,
  });
  return buildRows(user, mine, clis, now);
}

/** The rows one chat has in one person's inbox (one per role), for live updates (Task 9's `inbox.upsert`). */
export async function loadInboxRow(chatId: string, userId: string, clis: LiveClis, now = new Date()): Promise<InboxRow[]> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return [];
  const mine = await prisma.participant.findMany({ where: { chatId, githubId: user.githubId, chat: inInbox(now) }, include: WITH_CHAT, orderBy: { role: 'asc' } });
  return buildRows(user, mine, clis, now);
}

async function buildRows(user: InboxViewer, mine: Mine[], clis: LiveClis, now: Date): Promise<InboxRow[]> {
  if (mine.length === 0) return [];
  const chats = [...new Map(mine.map((p) => [p.chat.id, p.chat])).values()];
  const others = mine.map((p) => otherSide(p, user.githubId));
  const [activities, avatars, lastItems, unread] = await Promise.all([
    loadActivities(chats.map((c) => c.id), clis, now),
    avatarsOf(others.flatMap((o) => (o ? [o.githubId] : []))),
    lastItemsOf(chats),
    unreadCounts(user, chats),
  ]);

  return mine.map((p, i): InboxRow => {
    const chat = p.chat;
    const role = p.role as Role;
    const other = others[i];
    const status = inboxStatus({
      phase: chat.phase as Phase,
      merged: chat.merged,
      activity: activities.get(chat.id) ?? { kind: 'none' },
      attention: p.attention as Attention,
      role,
      you: user.login,
    });
    return {
      chatId: chat.id,
      repo: chat.repo.fullName,
      number: chat.number,
      title: chat.title,
      url: chat.url,
      role,
      other: other
        ? { login: other.login, avatarUrl: avatars.get(other.githubId) ?? githubAvatar(other.githubId), agentActive: chat.jobs.some((j) => j.participant.githubId === other.githubId) }
        : null,
      status,
      round: chat.round,
      maxRounds: rulesFromJson(chat.repo.rulesJson).max_rounds,
      lastActivity: oneLine(lastItems.get(chat.id) ?? ''),
      updatedAt: chat.updatedAt.toISOString(),
      unread: unread.get(chat.id) ?? 0,
      needsYou: needsYou(status),
    };
  });
}

/** Who a row shows: for your PR, the first requested reviewer (else the first reviewer); for a review, the author. */
function otherSide(p: Mine, yourGithubId: string): { githubId: string; login: string } | null {
  const others = p.chat.participants.filter((q) => q.githubId !== yourGithubId);
  if (p.role === 'author') return others.find((q) => q.role === 'reviewer' && q.requested) ?? others.find((q) => q.role === 'reviewer') ?? null;
  return others.find((q) => q.role === 'author') ?? null;
}

/** The tab badge counts these (handoff "State management"). A ready chat is only ever a reviewer's `ready`. */
function needsYou(status: InboxStatus): boolean {
  return status.kind === 'needs_you' || status.kind === 'escalated' || status.kind === 'ready';
}

/** Profile pictures of the people who are on Nitpilot, by GitHub id. */
async function avatarsOf(githubIds: string[]): Promise<Map<string, string>> {
  if (githubIds.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { githubId: { in: [...new Set(githubIds)] } }, select: { githubId: true, avatarUrl: true } });
  return new Map(users.flatMap((u) => (u.avatarUrl ? [[u.githubId, u.avatarUrl] as const] : [])));
}

/** GitHub's public profile picture for anyone, on Nitpilot or not. */
function githubAvatar(githubId: string): string {
  return `https://avatars.githubusercontent.com/u/${githubId}`;
}

/** The body of each chat's newest timeline item: the one whose seq is the chat's `lastSeq`. */
async function lastItemsOf(chats: Chat[]): Promise<Map<string, string>> {
  const newest = chats.filter((c) => c.lastSeq > 0).map((c) => ({ chatId: c.id, seq: c.lastSeq }));
  if (newest.length === 0) return new Map();
  const items = await prisma.message.findMany({ where: { OR: newest }, select: { chatId: true, body: true } });
  return new Map(items.map((m) => [m.chatId, m.body]));
}

/**
 * How many timeline items in each chat someone else wrote after the last one `user` read (spec §8 `ChatRead`).
 * System items have no author and count. No `ChatRead` row means nothing was read yet.
 */
export async function unreadCounts(user: InboxViewer, chats: Pick<Chat, 'id' | 'lastSeq'>[]): Promise<Map<string, number>> {
  if (chats.length === 0) return new Map();
  const reads = await prisma.chatRead.findMany({ where: { userId: user.id, chatId: { in: chats.map((c) => c.id) } } });
  const lastRead = (chatId: string) => reads.find((r) => r.chatId === chatId)?.lastReadSeq ?? 0;
  const behind = chats.filter((c) => c.lastSeq > lastRead(c.id));
  if (behind.length === 0) return new Map();
  const counts = await prisma.message.groupBy({
    by: ['chatId'],
    where: {
      AND: [
        { OR: behind.map((c) => ({ chatId: c.id, seq: { gt: lastRead(c.id) } })) },
        { OR: [{ authorGithubId: null }, { authorGithubId: { not: user.githubId } }] },
      ],
    },
    _count: { _all: true },
  });
  return new Map(counts.map((c) => [c.chatId, c._count._all]));
}

/** One line of at most 120 characters, with … when it was cut. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > LAST_ACTIVITY_CHARS ? `${flat.slice(0, LAST_ACTIVITY_CHARS - 1)}…` : flat;
}
