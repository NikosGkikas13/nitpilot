import { z } from 'zod';
import { NeedsReauthError } from '../../auth/user-tokens';
import type { Dispatch } from '../../chats/dispatch';
import type { DomainEvent } from '../../engine/types';
import type { GiveUpHandler } from '../runner';

const ReviewPayload = z.object({ reviewerGithubId: z.string(), pointNumbers: z.array(z.number().int()) });
const RepliesPayload = z.object({ asGithubId: z.string(), replies: z.array(z.object({ pointNumber: z.number().int() })) });

/**
 * When the runner gives up on a review or replies posted in someone's name, tell the engine, so
 * the chat says so and that person is flagged and notified (spec §15). The summary is left out:
 * the next change to the chat writes it again, and reporting it would itself change the chat.
 */
export function reportFailedWrite(dispatch: Dispatch): GiveUpHandler {
  return async (task, error) => {
    if (!task.chatId) return;
    const reason = isNeedsReauth(error) ? 'needs_reauth' : 'github_error';
    let event: DomainEvent | null = null;
    if (task.kind === 'post_review') {
      const { reviewerGithubId, pointNumbers } = ReviewPayload.parse(task.payload);
      event = { type: 'write_failed', write: 'review', asGithubId: reviewerGithubId, pointNumbers, reason };
    } else if (task.kind === 'thread_replies') {
      const { asGithubId, replies } = RepliesPayload.parse(task.payload);
      event = { type: 'write_failed', write: 'replies', asGithubId, pointNumbers: replies.map((r) => r.pointNumber), reason };
    }
    if (event) await dispatch(task.chatId, event);
  };
}

/** asUser (shared.ts) wraps NeedsReauthError in a PermanentTaskError; the original is its cause. */
function isNeedsReauth(error: unknown): boolean {
  return error instanceof NeedsReauthError || (error instanceof Error && error.cause instanceof NeedsReauthError);
}
