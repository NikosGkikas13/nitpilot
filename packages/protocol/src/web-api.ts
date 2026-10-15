import { z } from 'zod';
import { MeResponse } from './api';

// REST bodies the web app reads and sends (spec §10 "REST endpoints in Plan 2"). The web app parses every
// answer with these, as the CLI does with api.ts.

/**
 * `GET /api/me`, as the web app reads it: the CLI's answer plus who you are. The CLI parses the same answer
 * with `MeResponse`, which ignores the extra fields. Later milestones add settings, onboarding and push.
 */
export const WebMe = MeResponse.extend({
  id: z.string(),
  githubId: z.string(),
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
