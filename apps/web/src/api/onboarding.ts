import { Onboarding } from '@nitpilot/protocol';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * The setup checklist's facts (`GET /api/onboarding`). Read again after every `me.update` (a CLI logged in or
 * connected: live/apply.ts) and whenever the window comes back into view (TanStack's default, since nothing here
 * sets a staleTime), which is how the install step ticks after GitHub's install page, in another tab.
 */
export function useOnboarding() {
  return useQuery({
    queryKey: ['onboarding'],
    queryFn: () => api.get('/api/onboarding', Onboarding),
  });
}
