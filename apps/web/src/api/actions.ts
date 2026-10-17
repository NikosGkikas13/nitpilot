import { ActionResponse, RetryResponse, type ChatResponse } from '@nitpilot/protocol';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toast/Toast';
import { useDraft } from '../routes/Shell/UiState';
import { api, ApiError } from './client';

/**
 * One chat write (spec §10 "Chat writes"): it resolves when the server answers, and says how it went in a toast. No
 * optimistic update: what changes on screen comes from the server, over `/ws/web`. A refusal shows the server's words
 * as an error toast (docs/why/races-and-conflicts.md), and then, by what the refusal says about what the screen shows:
 * - 409: nothing more. The change that caused it reaches the screen over the socket.
 * - 403: your role in this chat changed, so this chat is fetched again and its buttons follow `permissions`.
 * - 404 (the chat is gone) and 401 (a GitHub sign-in that expired, or Nitpilot's own): this chat is fetched again,
 *   and so are you (`['me']`), so the screen shows "Nothing here", "Sign in with GitHub again" or the signed-out
 *   page instead of buttons that can't work.
 * Only this chat is refreshed, the same way `live/apply.ts` finds it by its id; the other chats in the cache are fine.
 * `mutationKey` lets a field that was closed and opened again still see that a write of this kind is on its way.
 */
function useChatWrite<V, R>(chatId: string, kind: string, send: (vars: V) => Promise<R>, done: (answer: R, vars: V) => string, afterSuccess?: (vars: V) => void) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [kind, chatId],
    mutationFn: send,
    // These run even if the button that started the write is gone by then (you opened another chat).
    onSuccess: (answer, vars) => {
      toast.show(done(answer, vars));
      afterSuccess?.(vars);
    },
    onError: (err) => {
      toast.show(err.message, { error: true });
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 403 || status === 404 || status === 401) {
        void queryClient.invalidateQueries({ queryKey: ['chat'], predicate: (q) => (q.state.data as ChatResponse | undefined)?.view.id === chatId });
      }
      if (status === 404 || status === 401) void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

/** A note to the agents. */
export function useNote(chatId: string) {
  const [, setDraft] = useDraft(chatId);
  return useChatWrite(
    chatId,
    'note',
    (body: string) => api.send('POST', `/api/chats/${chatId}/notes`, { body }, ActionResponse),
    () => "Sent. Included in the agents' next round.",
    // The draft goes once the server took it, if it's still what was sent (not if you kept typing).
    (body) => setDraft((current) => (current.trim() === body ? '' : current)),
  );
}

/** Resolve an escalated point (only the reviewer who raised it). */
export function useResolve(chatId: string) {
  return useChatWrite(
    chatId,
    'resolve',
    (point: number) => api.send('POST', `/api/chats/${chatId}/points/${point}/resolve`, undefined, ActionResponse),
    (_answer, point) => `P${point} resolved.`,
  );
}

/** Hand an escalated point back to the agents (the author, or the reviewer who raised it). */
export function useContinue(chatId: string) {
  return useChatWrite(
    chatId,
    'continue',
    (point: number) => api.send('POST', `/api/chats/${chatId}/points/${point}/continue`, undefined, ActionResponse),
    (_answer, point) => `Agents will keep going on P${point}.`,
  );
}

/** Start the review of an outside contributor's PR (a requested reviewer). */
export function useReview(chatId: string) {
  return useChatWrite<void, ActionResponse>(
    chatId,
    'review',
    () => api.send('POST', `/api/chats/${chatId}/review`, undefined, ActionResponse),
    () => 'Your agent will start the review.',
  );
}

/** Run your failed job again. */
export function useRetry(chatId: string) {
  return useChatWrite<void, RetryResponse>(
    chatId,
    'retry',
    () => api.send('POST', `/api/chats/${chatId}/retry`, undefined, RetryResponse),
    (answer) => (answer.status === 'queued' ? 'Your agent will try again.' : 'Your agent will try again once the step before it is done.'),
  );
}
