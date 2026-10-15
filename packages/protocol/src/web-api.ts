import { z } from 'zod';
import { MeResponse } from './api';
import { Role } from './enums';

// REST bodies the web app reads and sends (spec §10 "REST endpoints in Plan 2"). The web app parses every
// answer with these, as the CLI does with api.ts.

/**
 * `GET /api/me`, as the web app reads it: the CLI's answer plus who you are. The CLI parses the same answer
 * with `MeResponse`, which ignores the extra fields. Later milestones add settings, onboarding and push.
 */
export const WebMe = MeResponse.extend({
  id: z.string(),
  githubId: z.string(),
  /** True while any of your CLIs is connected: the inbox's "Your agent is offline" banner reads it. */
  agentOnline: z.boolean(),
});
export type WebMe = z.infer<typeof WebMe>;

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
