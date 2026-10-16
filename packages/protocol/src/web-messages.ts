import { z } from 'zod';
import { message } from './envelope';
import { ChatView, InboxRow, TimelineItem, WebMe } from './web-api';

/** Where the web app opens its WebSocket (spec §10 "Web ↔ server"). */
export const WEB_WS_PATH = '/ws/web';

/** The biggest message a browser may send. Subscribing is all it does, so anything bigger is a mistake. */
export const MAX_WEB_MESSAGE_BYTES = 64 * 1024;

// ── browser → server ─────────────────────────────────────────

/** Send me this chat's new items: everything after `afterSeq` first, then each one as it happens. */
export const ChatSubscribe = message('chat.subscribe', z.object({ chatId: z.string(), afterSeq: z.number().int().nonnegative() }));
export const ChatUnsubscribe = message('chat.unsubscribe', z.object({ chatId: z.string() }));

export const WebToServer = z.discriminatedUnion('t', [ChatSubscribe, ChatUnsubscribe]);
export type WebToServer = z.infer<typeof WebToServer>;

// ── server → browser ─────────────────────────────────────────

/** New timeline items for a chat you subscribed to, oldest first. `lastSeq` is the newest one you now have. */
export const ChatItems = message('chat.items', z.object({ chatId: z.string(), items: z.array(TimelineItem), lastSeq: z.number().int().nonnegative() }));

/** The chat changed: its view as you see it now (points, phase, people, presence). Items come in chat.items. */
export const ChatState = message('chat.state', z.object({ chatId: z.string(), view: ChatView }));

/**
 * You can't (or can no longer) follow this chat. `not_found` covers "no such chat" and "you can't see its repo"
 * alike (spec §16); `reauth` means your GitHub sign-in expired; `unavailable` means GitHub didn't answer when
 * we asked. The subscription is gone either way.
 */
export const ChatError = message('chat.error', z.object({ chatId: z.string(), code: z.enum(['not_found', 'reauth', 'unavailable']) }));

/** A line of what an agent is doing right now (spec §10 `job.progress`, forwarded from its CLI; never stored). */
export const WebJobProgress = message('job.progress', z.object({
  chatId: z.string(),
  /** Whose agent: a GitHub login. */
  who: z.string(),
  action: z.enum(['reviewing', 'fixing']),
  stage: z.enum(['preparing', 'running_agent', 'pushing', 'finishing']),
  text: z.string(),
}));

/** Your inbox rows for one chat changed. `rows` replaces every row you had for `chatId`; empty removes them. */
export const InboxUpsert = message('inbox.upsert', z.object({ chatId: z.string(), rows: z.array(InboxRow) }));

/** What `GET /api/me` would answer now: one of your CLIs connected or disconnected. */
export const MeUpdate = message('me.update', z.object({ me: WebMe }));

export const ServerToWeb = z.discriminatedUnion('t', [ChatItems, ChatState, ChatError, WebJobProgress, InboxUpsert, MeUpdate]);
export type ServerToWeb = z.infer<typeof ServerToWeb>;
