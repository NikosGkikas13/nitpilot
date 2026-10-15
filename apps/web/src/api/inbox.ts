import { InboxResponse } from '@nitpilot/protocol';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/** Your inbox rows, as the server sorted them (newest first). Not live yet: W3 pushes changes into this cache. */
export function useInbox() {
  return useQuery({
    queryKey: ['inbox'],
    queryFn: async () => (await api.get('/api/inbox', InboxResponse)).rows,
  });
}
