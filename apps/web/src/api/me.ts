import { WebMe } from '@nitpilot/protocol';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';

/** Who is signed in. `null` means nobody: the server answered 401. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<WebMe | null> => {
      try {
        return await api.get('/api/me', WebMe);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

/**
 * Asks the server whether this tab is still signed in, and only a 401 changes anything: the page goes back to the
 * landing page. Any other failure (offline, a restart) leaves the app as it is, since the socket keeps retrying.
 */
export async function checkStillSignedIn(queryClient: QueryClient): Promise<void> {
  try {
    await api.get('/api/me', WebMe);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(['me'], null);
  }
}
