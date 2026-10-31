import { DemoResponse, HealthResponse } from '@nitpilot/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { publicChatQuery } from './chat';
import { api, ApiError } from './client';

/** How long to wait between looks for the demo's chat, and how many looks (about a minute): GitHub's webhook takes a moment to arrive. */
export const DEMO_POLL_MS = 1_500;
export const DEMO_POLL_TRIES = 40;

/** Does this server run the public playground's demo (`demo` in `GET /healthz`)? False when it doesn't say. */
export function useDemoAvailable(): boolean {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get('/healthz', HealthResponse), staleTime: Infinity });
  return health.data?.demo === true;
}

/**
 * "Run a demo": the server opens a PR in the playground (or hands back the one running), then we wait until its
 * chat exists, since the chat starts when GitHub's webhook reaches the server. `onOpened`: the PR is open, the wait begins. Resolves to the chat page's path,
 * with the chat already in the cache for PublicChat.
 */
export function useRunDemo(onOpened: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { url } = await api.send('POST', '/api/demo', undefined, DemoResponse);
      onOpened();
      const path = new URL(url, window.location.origin).pathname;
      const [, , owner = '', repo = '', number = ''] = path.split('/');
      for (let tries = 1; ; tries++) {
        try {
          await queryClient.fetchQuery({ ...publicChatQuery(owner, repo, number), retry: false });
          return path;
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404) || tries >= DEMO_POLL_TRIES) {
            throw err instanceof ApiError && err.status === 404 ? new Error("The demo PR is open, but its chat hasn't started yet. Try again in a minute.") : err;
          }
          await new Promise((resolve) => setTimeout(resolve, DEMO_POLL_MS));
        }
      }
    },
  });
}
