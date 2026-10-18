import { ActionResponse, type AutoRequest, type DraftView } from '@nitpilot/protocol';
import { AUTO_LABEL } from '../lib/auto';
import { useChatWrite } from './actions';
import { api } from './client';

// Auto and drafts (spec §9 "Auto" and "Drafts"): writes like the others in actions.ts. Each resolves when the server
// answers; the switch moving and the card going come over /ws/web.

/** Turn your Auto switch for one of your roles in this chat on or off (`PUT /api/chats/:id/auto`). */
export function useAutoSwitch(chatId: string) {
  return useChatWrite(
    chatId,
    'auto',
    (req: AutoRequest) => api.send('PUT', `/api/chats/${chatId}/auto`, req, ActionResponse),
    (_answer, req) => (req.on ? `${AUTO_LABEL[req.role]} is on. Your agent's work goes out as soon as it's done.` : `${AUTO_LABEL[req.role]} is off. Your agent's work will wait as drafts.`),
  );
}

/**
 * Send your waiting draft. A reviewer's is applied at once (its review goes to GitHub); so is an author's that has no
 * commit (only replies). An author's with a commit queues the push from the laptop that made it: the card says
 * "Sending…" until it's done (`DraftView.sending`).
 */
export function useSendDraft(chatId: string) {
  return useChatWrite(
    chatId,
    'draft_send',
    (draft: DraftView) => api.send('POST', `/api/chats/${chatId}/drafts/${draft.jobId}/send`, undefined, ActionResponse),
    (_answer, draft) => {
      if (draft.role === 'reviewer') return "Sent. Your agent's review is on its way to GitHub.";
      return draft.result.draft ? "Sending your agent's fixes." : "Sent. Your agent's replies are on their way to GitHub.";
    },
  );
}

/** Discard your waiting draft: the agent won't start the same work again by itself, so it's yours now (spec §9 "Drafts"). */
export function useDiscardDraft(chatId: string) {
  return useChatWrite(
    chatId,
    'draft_discard',
    (draft: DraftView) => api.send('POST', `/api/chats/${chatId}/drafts/${draft.jobId}/discard`, undefined, ActionResponse),
    (_answer, draft) => (draft.role === 'reviewer' ? 'Discarded. The review of this commit is yours now.' : 'Discarded. The points are yours to handle by hand.'),
  );
}
