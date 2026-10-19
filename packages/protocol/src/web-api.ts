import { z } from 'zod';
import { MeResponse } from './api';
import { AgentId, AgentJobType, Attention, Category, EscalationReason, MessageKind, Phase, PointOrigin, PointStatus, Resolution, Role, Severity, Side } from './enums';
import { JobResult, Snippet } from './job-result';

// REST bodies the web app reads and sends (spec §10 "REST endpoints in Plan 2"). The web app parses every
// answer with these, as the CLI does with api.ts.

/**
 * A person's settings (spec §8 `User`), kept on the server and edited on the Settings page: the Auto defaults for new
 * chats (reviewing and fixing), and how many agent runs each of your CLIs starts in a day. `PUT /api/me/settings`
 * takes and answers it, and every connected CLI gets it in `welcome` and in `settings` (spec §10).
 */
export const Settings = z.object({
  autoReview: z.boolean(),
  autoAddress: z.boolean(),
  dailyJobCap: z.number().int().min(5).max(200),
});
export type Settings = z.infer<typeof Settings>;

/**
 * `GET /api/me`, as the web app reads it: the CLI's answer plus who you are. The CLI parses the same answer
 * with `MeResponse`, which ignores the extra fields. Later milestones add onboarding and push.
 */
export const WebMe = MeResponse.extend({
  id: z.string(),
  githubId: z.string(),
  /** True while any of your CLIs is connected: the inbox's "Your agent is offline" banner reads it. */
  agentOnline: z.boolean(),
  settings: Settings,
  /** Agent runs your connected CLIs started today, added up, each counted from its own midnight (the Settings page's usage bar). */
  usedToday: z.number().int().nonnegative(),
  /**
   * Web Push (spec §16): the server's public VAPID key, which the browser needs to subscribe (null: this server has
   * no keys, so push is off and the CLI notifies as in Plan 1), and whether you have any subscription.
   */
  push: z.object({ vapidPublicKey: z.string().nullable(), subscribed: z.boolean() }),
  /**
   * You finished the setup checklist once (`User.onboardedAt`): Settings stops offering "Finish setting up". The
   * checklist's own facts are a read of their own (`GET /api/onboarding`), since one of them asks GitHub.
   */
  onboarded: z.boolean(),
});
export type WebMe = z.infer<typeof WebMe>;

/**
 * One of your computers on the Settings page (`GET /api/devices`): a CLI token that `nitpilot login` made and nobody
 * revoked. `name` is the one the CLI gave when it logged in. `online` while its `nitpilot start` is connected;
 * `lastSeenAt` is when it last said anything (null: never connected). `agent` is the coding agent it reported in its
 * hello: the live one while online, else the one it remembered from its last hello (null: none yet, or one with no
 * modes). The Agent section is worked out from these on the page.
 */
export const DeviceView = z.object({
  id: z.string(),
  name: z.string(),
  lastSeenAt: z.string().nullable(),
  online: z.boolean(),
  agent: z.object({ id: AgentId, version: z.string().nullable() }).nullable(),
});
export type DeviceView = z.infer<typeof DeviceView>;

export const DevicesResponse = z.object({ devices: z.array(DeviceView) });
export type DevicesResponse = z.infer<typeof DevicesResponse>;

/**
 * The setup checklist (`GET /api/onboarding`, the `/setup` page, handoff §5). Step 1, signing in, is a given: only a
 * signed-in person can ask. `appInstalled`: GitHub lists an installation of this app that you can see.
 * `cliConnected`: you have a CLI token nobody revoked (`npx nitpilot login` worked). `repoLinked`: one of those CLIs
 * reported a linked repo when `nitpilot start` connected. `agentStarted`: one reported an agent it can run. `done`
 * once all four held at the same time; from then on every step reads true. `deviceName` is your newest computer's name
 * ("Connected: …"); `appSlug` makes the install link; `publicReposOnly` says this server reviews public repos only.
 */
export const Onboarding = z.object({
  steps: z.object({ appInstalled: z.boolean(), cliConnected: z.boolean(), repoLinked: z.boolean(), agentStarted: z.boolean() }),
  done: z.boolean(),
  deviceName: z.string().nullable(),
  appSlug: z.string(),
  publicReposOnly: z.boolean(),
});
export type Onboarding = z.infer<typeof Onboarding>;

/**
 * A `nitpilot login` waiting on the approve page (`GET /api/cli/requests/:userCode`, `/cli/approve?code=…`, handoff
 * §6). `userCode` is the short code the terminal printed, for the person to compare. `requestedAt` is when the CLI
 * asked; `expiresAt` is 10 minutes later, and the page counts down to it. `status`: `pending` until someone decides,
 * then `approved` (also once the CLI has collected its token) or `denied`; `expired` once the 10 minutes ran out first.
 */
export const CliRequestView = z.object({
  userCode: z.string(),
  deviceName: z.string(),
  requestedAt: z.string(),
  expiresAt: z.string(),
  status: z.enum(['pending', 'approved', 'denied', 'expired']),
});
export type CliRequestView = z.infer<typeof CliRequestView>;

/** `POST /api/cli/requests/:userCode`: the person pressed Approve or Deny. It answers the request's new `CliRequestView`. */
export const CliRequestDecision = z.object({ decision: z.enum(['approve', 'deny']) });
export type CliRequestDecision = z.infer<typeof CliRequestDecision>;

/**
 * True for an address the server may send a push to: `https:`, and a host name that is neither an IP address nor
 * localhost. The server POSTs to whatever endpoint a browser registers, so without this anyone signed in could make it
 * call its own neighbours (127.0.0.1, the cloud's 169.254.169.254, …): a blind SSRF. Real push services are all
 * https names (fcm.googleapis.com, web.push.apple.com, updates.push.services.mozilla.com, …). `new URL` writes every
 * IPv4 form (`2130706433`, `0x7f.1`) as dotted digits and keeps IPv6 in brackets, so those two shapes cover them.
 * This checks the URL only: it can't see where a public name resolves. But the send is https with certificate
 * checking, so a name pointing at a private address only gets a TLS failure unless that address serves a valid
 * certificate for the name, and the server reads nothing from the answer but its status.
 */
export function isPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  if (url.protocol !== 'https:') return false;
  if (host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  return host !== 'localhost' && !host.endsWith('.localhost');
}

const PushEndpoint = z.string().max(2048).refine(isPushEndpoint, 'must be an https address of a push service');

/** A key from the browser's subscription, in base64url (what `PushSubscription.toJSON()` gives). */
const PushKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+={0,2}$/);

/**
 * `POST /api/push/subscriptions`: this browser's Web Push subscription (`pushManager.subscribe()`), and a label for the
 * Settings page ("Chrome on macOS"). Saved by endpoint: the same endpoint again updates its row.
 */
export const PushSubscriptionRequest = z.object({
  endpoint: PushEndpoint,
  keys: z.object({ p256dh: PushKey, auth: PushKey }),
  label: z.string().trim().min(1).max(100),
});
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequest>;

/** `DELETE /api/push/subscriptions`: stop pushing to this browser. */
export const PushUnsubscribeRequest = z.object({ endpoint: PushEndpoint });
export type PushUnsubscribeRequest = z.infer<typeof PushUnsubscribeRequest>;

/**
 * A row's status pill in the inbox (spec §16, handoff §1), worked out on the server for the person reading
 * it (`apps/server/src/chats/inbox-status.ts`). `who` is a GitHub login ("leo" → "Leo's agent working");
 * `reason` says why someone waits or is needed. `quiet` shows no pill.
 */
export const InboxStatus = z.object({
  kind: z.enum(['working', 'waiting', 'their_turn', 'needs_you', 'escalated', 'ready', 'merged', 'closed', 'quiet']),
  who: z.string().nullable(),
  reason: z.enum(['offline', 'repo_not_linked', 'cap_reached', 'decision', 'manual_review', 'failed', 'drafts']).nullable(),
});
export type InboxStatus = z.infer<typeof InboxStatus>;

/** One row of `GET /api/inbox`: one chat, seen in one of your roles (an author who also reviews gets two rows). */
export const InboxRow = z.object({
  chatId: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  /** The PR on GitHub. */
  url: z.string(),
  role: Role,
  /** The person on the other side: a reviewer for your PR, the author for a review. */
  other: z.object({ login: z.string(), avatarUrl: z.string().nullable(), agentActive: z.boolean() }).nullable(),
  status: InboxStatus,
  round: z.number().int().positive(),
  maxRounds: z.number().int().positive(),
  /** The newest timeline item, on one line. */
  lastActivity: z.string(),
  updatedAt: z.string(),
  /** Timeline items someone else wrote after the last one you read. */
  unread: z.number().int().nonnegative(),
  /** Counts toward the tab's "need you" badge. */
  needsYou: z.boolean(),
});
export type InboxRow = z.infer<typeof InboxRow>;

export const InboxResponse = z.object({ rows: z.array(InboxRow) });
export type InboxResponse = z.infer<typeof InboxResponse>;

/** `POST /api/chats/:id/read`: you've read up to this timeline item. */
export const MarkReadRequest = z.object({ seq: z.number().int().nonnegative() });
export type MarkReadRequest = z.infer<typeof MarkReadRequest>;

/**
 * One item of a chat's timeline (spec §8 `Message`), as the web app reads it over REST and `/ws/web`. `seq` is the
 * chat's resume cursor: 1, 2, 3… with no gaps. `pointNumber` also names the point for a person's reply in its
 * GitHub thread, so the web app can show the reply in that point's card. `author` is null for a system event.
 */
export const TimelineItem = z.object({
  seq: z.number().int().positive(),
  kind: MessageKind,
  author: z.object({ githubId: z.string(), login: z.string() }).nullable(),
  pointNumber: z.number().int().positive().nullable(),
  jobId: z.string().nullable(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
  at: z.string(),
});
export type TimelineItem = z.infer<typeof TimelineItem>;

/** `GET /api/chats/:id/messages?before=`: older items, oldest first. `hasOlder` says whether there are more before them. */
export const MessagesResponse = z.object({ items: z.array(TimelineItem), hasOlder: z.boolean() });
export type MessagesResponse = z.infer<typeof MessagesResponse>;

/**
 * What a chat is waiting on right now (spec §9.1 "Activity"), worked out when it's read: an agent at work, an
 * agent that can't start (`why`), a person's turn, or nothing. `who` is a GitHub login.
 */
export const ActivityView = z.object({
  kind: z.enum(['agent_working', 'agent_waiting', 'human_turn', 'none']),
  who: z.string().nullable(),
  why: z.enum(['offline', 'repo_not_linked', 'cap_reached']).nullable(),
  /** For an agent waiting offline: when its CLI was last seen (null if it never connected). */
  offlineSince: z.string().nullable(),
});
export type ActivityView = z.infer<typeof ActivityView>;

/** A person in the chat, and their agent: null for someone who isn't on Nitpilot (or a bot). */
export const ParticipantView = z.object({
  githubId: z.string(),
  login: z.string(),
  avatarUrl: z.string(),
  role: Role,
  isBot: z.boolean(),
  onNitpilot: z.boolean(),
  /** A reviewer the author asked for. */
  requested: z.boolean(),
  /**
   * Their Auto switch in this chat, in this role (spec §9 "Auto"): off means their agent's work waits as a draft. It's
   * what they set; a team rule in `.nitpilot.yml` can still forbid the auto mode (`rules.autoReview` / `autoAddress`).
   */
  auto: z.boolean(),
  agent: z.object({ online: z.boolean(), offlineSince: z.string().nullable(), working: z.boolean() }).nullable(),
});
export type ParticipantView = z.infer<typeof ParticipantView>;

/** A review point (spec §8 `Point`), with who raised it and a link to its line on GitHub. */
export const PointView = z.object({
  number: z.number().int().positive(),
  raisedBy: z.object({ githubId: z.string(), login: z.string() }),
  origin: PointOrigin,
  path: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  side: Side.nullable(),
  /** The file at that line on GitHub; null for a point about the whole PR. */
  url: z.string().nullable(),
  severity: Severity,
  category: Category,
  title: z.string(),
  body: z.string(),
  snippet: Snippet.nullable(),
  status: PointStatus,
  authorResolution: Resolution.nullable(),
  escalationReason: EscalationReason.nullable(),
  trusted: z.boolean(),
  round: z.number().int().positive(),
});
export type PointView = z.infer<typeof PointView>;

/**
 * What the person reading a chat may do in it right now (spec §16 "Who can act in a chat"), worked out on the
 * server (`apps/server/src/chats/permissions.ts`). `resolve` and `continue` list escalated points by number. The
 * server checks again on every write; this only decides which buttons to show.
 */
export const Permissions = z.object({
  note: z.boolean(),
  resolve: z.array(z.number().int().positive()),
  continue: z.array(z.number().int().positive()),
  /** Start the review of an outside contributor's PR (the untrusted card's Review). */
  review: z.boolean(),
  /** Run your failed job again. */
  retry: z.boolean(),
  /** The roles whose Auto switch you may flip: your own. */
  auto: z.array(Role),
  /** The waiting drafts you may Send or Discard, by job id: your agent's. */
  drafts: z.array(z.string()),
});
export type Permissions = z.infer<typeof Permissions>;

/**
 * Work an agent finished with Auto off, waiting for its owner to Send or Discard it (spec §9 "Drafts"). Everyone who
 * reads the chat sees it; only the owner gets the buttons (`Permissions.drafts`). `result` is what the agent produced:
 * a reviewer's points and decisions, or an author's replies with `result.draft`, the commit that stays on the laptop
 * that made it. `sending` is true while the publish job that pushes an author's draft is queued or running.
 */
export const DraftView = z.object({
  jobId: z.string(),
  /** Whose agent made it: a GitHub login. */
  owner: z.string(),
  role: Role,
  jobType: AgentJobType,
  /** The head commit the agent worked on. */
  headSha: z.string(),
  createdAt: z.string(),
  result: JobResult,
  sending: z.boolean(),
});
export type DraftView = z.infer<typeof DraftView>;

/**
 * A chat as the person reading it sees it (spec §10, handoff §2): the PR, the people and their agents, the
 * points, the team rules, and the reader's own place in it (`viewer`). `/ws/web` sends it again (`chat.state`)
 * whenever it changes. The timeline items travel separately: in `ChatResponse`, then in `chat.items`.
 */
export const ChatView = z.object({
  id: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  /** The PR on GitHub. */
  url: z.string(),
  /** The PR author's GitHub login. */
  author: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  phase: Phase,
  round: z.number().int().positive(),
  maxRounds: z.number().int().positive(),
  merged: z.boolean(),
  closed: z.boolean(),
  /** False for a PR from an outside contributor: agents don't start on it by themselves (spec §6.1). */
  trusted: z.boolean(),
  isDraft: z.boolean(),
  viewer: z.object({
    /** Your role here, or null if you only read along. An author who also reviews is the author. */
    role: Role.nullable(),
    attention: Attention,
    /** Why you're flagged `failed`: your agent's job failed (Retry), or a GitHub post in your name did (Reconnect). */
    failure: z.enum(['agent', 'github_post']).nullable(),
  }),
  participants: z.array(ParticipantView),
  activity: ActivityView,
  points: z.array(PointView),
  /** The drafts waiting for their owners, oldest first. */
  drafts: z.array(DraftView),
  rules: z.object({
    maxRounds: z.number().int().positive(),
    alwaysEscalate: z.array(Category),
    autoReview: z.boolean(),
    autoAddress: z.boolean(),
    /** Why `.nitpilot.yml` couldn't be used, so the defaults apply; null when it's fine or missing. */
    error: z.string().nullable(),
  }),
  permissions: Permissions,
  /** Nitpilot's summary comment on GitHub, once it's posted. */
  summaryUrl: z.string().nullable(),
  /** The newest timeline item's seq (0 for none). */
  lastSeq: z.number().int().nonnegative(),
});
export type ChatView = z.infer<typeof ChatView>;

/** `GET /api/chats/:owner/:repo/:number`: the chat, and its newest 200 timeline items, oldest first. */
export const ChatResponse = z.object({ view: ChatView, items: z.array(TimelineItem), hasOlder: z.boolean() });
export type ChatResponse = z.infer<typeof ChatResponse>;

/** `POST /api/chats/:id/notes`: a note to the agents, 1 to 4,000 characters once trimmed. */
export const NoteRequest = z.object({ body: z.string().trim().min(1).max(4000) });
export type NoteRequest = z.infer<typeof NoteRequest>;

/** `PUT /api/chats/:id/auto`: turn your Auto switch for one of your roles in this chat on or off. */
export const AutoRequest = z.object({ role: Role, on: z.boolean() });
export type AutoRequest = z.infer<typeof AutoRequest>;

/** What a chat write answers when it worked (notes, Resolve, Continue, Review, Auto, Send, Discard). The change itself arrives on `/ws/web`. */
export const ActionResponse = z.object({ ok: z.literal(true) });
export type ActionResponse = z.infer<typeof ActionResponse>;

/** One changed file of the PR (spec §10 `GET /api/chats/:id/files`). */
export const PrFile = z.object({
  path: z.string(),
  /** Its old path, for a renamed file. */
  oldPath: z.string().nullable(),
  status: z.enum(['added', 'modified', 'removed', 'renamed']),
  adds: z.number().int().nonnegative(),
  dels: z.number().int().nonnegative(),
});
export type PrFile = z.infer<typeof PrFile>;

/** The PR's changed files, at most 300; `truncated` when it has more. `adds` and `dels` add up the files listed. */
export const FilesResponse = z.object({ files: z.array(PrFile), adds: z.number().int(), dels: z.number().int(), truncated: z.boolean() });
export type FilesResponse = z.infer<typeof FilesResponse>;
