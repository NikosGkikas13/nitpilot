import { ActionResponse, RetryResponse } from '@nitpilot/protocol';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toast/Toast';
import { api, ApiError } from './client';

/**
 * One chat write (spec §10 "Chat writes"): it resolves when the server answers, and says how it went in a toast. No
 * optimistic update: what changes on screen comes from the server, over `/ws/web`. A refusal (403, 409) shows the
 * server's words as an error toast (docs/why/races-and-conflicts.md); a chat that turned out to be gone, or a GitHub
 * sign-in that expired, also refreshes the chat and you, so the screen shows that instead of buttons that can't work.
 */
function useChatWrite<V, R>(send: (vars: V) => Promise<R>, done: (answer: R, vars: V) => string) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (answer, vars) => toast.show(done(answer, vars)),
    onError: (err) => {
      toast.show(err.message, { error: true });
      if (err instanceof ApiError && (err.status === 404 || err.code === 'reauth')) {
        void queryClient.invalidateQueries({ queryKey: ['chat'] });
        void queryClient.invalidateQueries({ queryKey: ['me'] });
      }
    },
  });
}

/** A note to the agents. */
export function useNote(chatId: string) {
  return useChatWrite(
    (body: string) => api.send('POST', `/api/chats/${chatId}/notes`, { body }, ActionResponse),
    () => "Sent. Included in the agents' next round.",
  );
}

/** Resolve an escalated point (only the reviewer who raised it). */
export function useResolve(chatId: string) {
  return useChatWrite(
    (point: number) => api.send('POST', `/api/chats/${chatId}/points/${point}/resolve`, undefined, ActionResponse),
    (_answer, point) => `P${point} resolved.`,
  );
}

/** Hand an escalated point back to the agents (the author, or the reviewer who raised it). */
export function useContinue(chatId: string) {
  return useChatWrite(
    (point: number) => api.send('POST', `/api/chats/${chatId}/points/${point}/continue`, undefined, ActionResponse),
    (_answer, point) => `Agents will keep going on P${point}.`,
  );
}

/** Start the review of an outside contributor's PR (a requested reviewer). */
export function useReview(chatId: string) {
  return useChatWrite<void, ActionResponse>(
    () => api.send('POST', `/api/chats/${chatId}/review`, undefined, ActionResponse),
    () => 'Your agent will start the review.',
  );
}

/** Run your failed job again. */
export function useRetry(chatId: string) {
  return useChatWrite<void, RetryResponse>(
    () => api.send('POST', `/api/chats/${chatId}/retry`, undefined, RetryResponse),
    (answer) => (answer.status === 'queued' ? 'Your agent will try again.' : 'Your agent will try again once the step before it is done.'),
  );
}
