import { WebMe } from '@nitpilot/protocol';
import { useQuery } from '@tanstack/react-query';
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
