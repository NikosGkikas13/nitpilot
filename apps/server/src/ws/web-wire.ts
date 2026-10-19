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

type Action = 'reviewing' | 'fixing' | 'sending';

/** What a progress line needs to know about a job: its chat, whose it is, and what kind of work. */
type JobInfo = { chatId: string; userId: string; login: string; action: Action };

/** What each kind of job is doing, for "leo's agent is reviewing…". A publish job runs no agent: it sends a draft. */
const ACTION: Record<JobType, Action> = { review: 'reviewing', re_review: 'reviewing', address: 'fixing', publish: 'sending' };

export type WebWiring = {
  webHub: WebHub;
  dispatcher: Dispatcher;
  cliHub: CliHub;
  access: RepoAccess;
  /** The server's public Web Push key, for `me.update` (null when push is off). Required, so a caller can't forget it. */
  vapidPublicKey: string | null;
  debounceMs?: number;
  /** Reads a chat's items after a seq (chats/timeline.ts). Tests pass one that fails. */
  loadItems?: (chatId: string, afterSeq: number) => Promise<TimelineItem[]>;
};

/**
 * Send someone's open tabs a fresh `me.update` (who they are, their settings, push, their agent's presence). The
 * routes that change those call it after saving (settings, devices, push subscriptions), so every tab of theirs
 * shows the change, not only the one that made it. Resolves once sent; never throws: a failure is logged.
 */
export type MeUpdates = { sendMeUpdate(userId: string): Promise<void> };

/** What the wiring hands back: `sendMeUpdate` for the HTTP routes (http/app.ts `AppDeps.meUpdates`), `stop` for shutdown. */
export type WebWired = MeUpdates & { stop(): void };

/**
 * Connect `/ws/web` to the rest of the server (spec §10 "Web ↔ server"). After each commit, the chat's followers get
 * its new items and their own view of it, and its participants their inbox rows. When a CLI comes or goes, its owner
 * gets `me.update` (so do the person's tabs after the routes' personal writes, `sendMeUpdate`), and the chats where their agent has work or shows its presence are sent again. A CLI's progress
 * lines go to the chat's followers. A chat's items and views go out in order; its inbox rows go out in order among
 * themselves, but apart, so a slow GitHub check for a row never holds back an item. A failure is logged and never
 * reaches the dispatcher; if a chat's new items can't be read, its open tabs are told to resume. main.ts and the
 * tests call this, so the tests run what production runs.
 */
export function wireWebHub({ webHub, dispatcher, cliHub, access, vapidPublicKey, debounceMs = STATE_DEBOUNCE_MS, loadItems = loadItemsAfter }: WebWiring): WebWired {
  // Work under one key goes out in order: a chat's items before the state that follows them (and its inbox rows apart, under `inbox:<chatId>`).
  const perChat = new KeyedLock();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const jobs = new TtlCache<JobInfo>(60 * 60_000, 10_000);

  /** Run `work` after what's already queued under this key. Never throws: publishing must not break a commit. */
  function inOrder(key: string, what: string, work: () => Promise<void>): void {
    perChat.run(key, work).catch((err) => console.error(`[web-wire] ${what} failed:`, err));
  }

  /** Send the chat's state and the inbox rows soon, once for all the commits in the next `debounceMs`. */
  function stateSoon(chatId: string): void {
    if (timers.has(chatId)) return;
    timers.set(
      chatId,
      setTimeout(() => {
        timers.delete(chatId);
        inOrder(chatId, `the state of chat ${chatId}`, () => publishState(chatId));
        // Their own key: checking each person's access can take GitHub a while, and the chat's items must not wait for it.
        inOrder(`inbox:${chatId}`, `the inbox rows of chat ${chatId}`, () => publishInboxRows(chatId));
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

  /** Each follower's own view (your role and attention are yours). */
  async function publishState(chatId: string): Promise<void> {
    for (const viewer of webHub.subscribers(chatId)) {
      const view = await loadChatView(chatId, viewer, cliHub);
      webHub.sendToChatViewer(chatId, viewer.id, { v: 1, t: 'chat.state', d: { chatId, view } });
    }
  }

  /** Each participant's inbox rows (people with a tab open only). Their access checks run together. */
  async function publishInboxRows(chatId: string): Promise<void> {
    const connected = (await participantsOnNitpilot(chatId)).filter((userId) => webHub.connected(userId));
    await Promise.all(
      connected.map(async (userId) => {
        const rows = await readableRows(userId, await loadInboxRow(chatId, userId, cliHub));
        if (rows) webHub.sendToUser(userId, { v: 1, t: 'inbox.upsert', d: { chatId, rows } });
      }),
    );
  }

  /**
   * A row shows the PR's title and newest message, so it goes only to someone who can still read the repo, the
   * same check the inbox makes (http/routes/inbox.ts): without access, an empty list (the row goes). Null, and
   * nothing is sent this time, when the check couldn't be made: GitHub didn't answer, or the person's GitHub
   * sign-in has expired (the inbox answers them 401).
   */
  async function readableRows(userId: string, rows: InboxRow[]): Promise<InboxRow[] | null> {
    if (rows.length === 0) return rows;
    try {
      const answer = await access.check(userId, rows[0]!.repo);
      if (answer === 'reauth') return null;
      return answer === 'read' ? rows : [];
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
    const info: JobInfo = { chatId: job.chatId, userId: job.userId, login: job.participant.login, action: ACTION[job.type as JobType] };
    jobs.set(jobId, info);
    return info;
  }

  dispatcher.onCommit((chatId, effects) => {
    const range = effects.timeline;
    if (range) inOrder(chatId, `the items of chat ${chatId}`, () => publishItems(chatId, range));
    stateSoon(chatId);
  });

  async function sendMeUpdate(userId: string): Promise<void> {
    // Nobody to tell: skip the read.
    if (!webHub.connected(userId)) return;
    try {
      webHub.sendToUser(userId, { v: 1, t: 'me.update', d: { me: await loadWebMe(userId, cliHub, vapidPublicKey) } });
    } catch (err) {
      console.error(`[web-wire] could not send a me.update to user ${userId}:`, err);
    }
  }

  cliHub.onPresence(({ userId }) => {
    void (async () => {
      await sendMeUpdate(userId);
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
    sendMeUpdate,
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
