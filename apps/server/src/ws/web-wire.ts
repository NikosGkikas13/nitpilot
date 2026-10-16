import type { InboxRow, JobType, TimelineItem } from '@nitpilot/protocol';
import type { RepoAccess } from '../auth/repo-access';
import { loadWebMe } from '../auth/users';
import type { Dispatcher } from '../chats/dispatch';
import { loadInboxRow } from '../chats/inbox';
import type { SeqRange } from '../chats/save';
import { loadItemsAfter } from '../chats/timeline';
import { loadChatView } from '../chats/views';
import { KeyedLock } from '../lib/key-lock';
import { prisma } from '../lib/prisma';
import { TtlCache } from '../lib/ttl-cache';
import type { CliHub } from './cli-hub';
import type { WebHub } from './web-hub';

/** Commits close together make one `chat.state`: it goes this long after the first of them. Every item still goes. */
export const STATE_DEBOUNCE_MS = 100;

/** What a progress line needs to know about a job: its chat, whose it is, and what kind of work. */
type JobInfo = { chatId: string; userId: string; login: string; action: 'reviewing' | 'fixing' };

export type WebWiring = {
  webHub: WebHub;
  dispatcher: Dispatcher;
  cliHub: CliHub;
  access: RepoAccess;
  debounceMs?: number;
  /** Reads a chat's items after a seq (chats/timeline.ts). Tests pass one that fails. */
  loadItems?: (chatId: string, afterSeq: number) => Promise<TimelineItem[]>;
};

/**
 * Connect `/ws/web` to the rest of the server (spec §10 "Web ↔ server"). After each commit, the chat's followers get
 * its new items and their own view of it, and its participants their inbox rows. When a CLI comes or goes, its owner
 * gets `me.update`, and the chats where their agent has work or shows its presence are sent again. A CLI's progress
 * lines go to the chat's followers. A failure is logged and never reaches the dispatcher; if a chat's new items
 * can't be read, its open tabs are told to resume. main.ts and the tests call this, so the tests run what production runs.
 */
export function wireWebHub({ webHub, dispatcher, cliHub, access, debounceMs = STATE_DEBOUNCE_MS, loadItems = loadItemsAfter }: WebWiring): { stop(): void } {
  // Everything about one chat goes out in order: its items before the state that follows them.
  const perChat = new KeyedLock();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const jobs = new TtlCache<JobInfo>(60 * 60_000, 10_000);

  /** Run `work` for this chat after what's already queued for it. Never throws: publishing must not break a commit. */
  function inOrder(chatId: string, what: string, work: () => Promise<void>): void {
    perChat.run(chatId, work).catch((err) => console.error(`[web-wire] ${what} for chat ${chatId} failed:`, err));
  }

  /** Send the chat's state soon, once for all the commits in the next `debounceMs`. */
  function stateSoon(chatId: string): void {
    if (timers.has(chatId)) return;
    timers.set(
      chatId,
      setTimeout(() => {
        timers.delete(chatId);
        inOrder(chatId, 'state', () => publishState(chatId));
      }, debounceMs),
    );
  }

  /**
   * Send the items a commit added. If they can't be read, the tabs following the chat are told to resume (each asks
   * again from its newest seq and the database fills the gap): sending the next commit's items instead would
   * make them skip these.
   */
  async function publishItems(chatId: string, range: SeqRange): Promise<void> {
    if (webHub.subscribers(chatId).length === 0) return;
    let items: TimelineItem[];
    try {
      items = (await loadItems(chatId, range.fromSeq - 1)).filter((item) => item.seq <= range.toSeq);
    } catch (err) {
      console.error(`[web-wire] could not read the new items of chat ${chatId}; asking its open tabs to resume:`, err);
      webHub.dropChat(chatId);
      return;
    }
    webHub.publishItems(chatId, items);
  }

  /** Each follower's own view (your role and attention are yours), then each participant's inbox rows. */
  async function publishState(chatId: string): Promise<void> {
    for (const viewer of webHub.subscribers(chatId)) {
      const view = await loadChatView(chatId, viewer, cliHub);
      webHub.sendToChatViewer(chatId, viewer.id, { v: 1, t: 'chat.state', d: { chatId, view } });
    }
    for (const userId of await participantsOnNitpilot(chatId)) {
      if (!webHub.connected(userId)) continue;
      const rows = await readableRows(userId, await loadInboxRow(chatId, userId, cliHub));
      if (rows) webHub.sendToUser(userId, { v: 1, t: 'inbox.upsert', d: { chatId, rows } });
    }
  }

  /**
   * A row shows the PR's title and newest message, so it goes only to someone who can still read the repo, the
   * same check the inbox makes (http/routes/inbox.ts). Null when GitHub didn't answer: nothing is sent this time.
   */
  async function readableRows(userId: string, rows: InboxRow[]): Promise<InboxRow[] | null> {
    if (rows.length === 0) return rows;
    try {
      return (await access.check(userId, rows[0]!.repo)) === 'read' ? rows : [];
    } catch (err) {
      console.error('[web-wire] could not check repo access for an inbox row:', err);
      return null;
    }
  }

  async function jobInfo(jobId: string): Promise<JobInfo | null> {
    const kept = jobs.get(jobId);
    if (kept) return kept;
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { chatId: true, userId: true, type: true, participant: { select: { login: true } } } });
    if (!job) return null;
    const info: JobInfo = { chatId: job.chatId, userId: job.userId, login: job.participant.login, action: (job.type as JobType) === 'address' ? 'fixing' : 'reviewing' };
    jobs.set(jobId, info);
    return info;
  }

  dispatcher.onCommit((chatId, effects) => {
    const range = effects.timeline;
    if (range) inOrder(chatId, 'items', () => publishItems(chatId, range));
    stateSoon(chatId);
  });

  cliHub.onPresence(({ userId }) => {
    void (async () => {
      webHub.sendToUser(userId, { v: 1, t: 'me.update', d: { me: await loadWebMe(userId, cliHub) } });
      for (const chatId of await chatsShowingAgentOf(userId, webHub.followedChats())) stateSoon(chatId);
    })().catch((err) => console.error('[web-wire] presence update failed:', err));
  });

  cliHub.onMessage(async (conn, msg) => {
    if (msg.t !== 'job.progress') return;
    const job = await jobInfo(msg.d.jobId);
    // Only for a job of this CLI's owner: nobody's CLI can put words in someone else's chat.
    if (!job || job.userId !== conn.userId) return;
    webHub.sendToChat(job.chatId, { v: 1, t: 'job.progress', d: { chatId: job.chatId, who: job.login, action: job.action, stage: msg.d.stage, text: msg.d.text } });
  });

  return {
    stop(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

/**
 * The chats whose view changes when this person's CLI comes or goes: where their agent has work ("waiting" ↔
 * "working", inbox rows too), and, among the chats someone has open, where they take part (the presence dot).
 */
async function chatsShowingAgentOf(userId: string, followed: string[]): Promise<string[]> {
  const active = await prisma.job.findMany({ where: { userId, status: { in: ['queued', 'running'] } }, select: { chatId: true }, distinct: ['chatId'] });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { githubId: true } });
  const taking = user && followed.length > 0 ? await prisma.participant.findMany({ where: { githubId: user.githubId, chatId: { in: followed } }, select: { chatId: true } }) : [];
  return [...new Set([...active, ...taking].map((row) => row.chatId))];
}

/** The Nitpilot users among the chat's people. */
async function participantsOnNitpilot(chatId: string): Promise<string[]> {
  const people = await prisma.participant.findMany({ where: { chatId, isBot: false }, select: { githubId: true } });
  const users = await prisma.user.findMany({ where: { githubId: { in: people.map((p) => p.githubId) } }, select: { id: true } });
  return users.map((u) => u.id);
}
