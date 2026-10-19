import { CliRequestView, type CliRequestDecision } from '@nitpilot/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

const path = (userCode: string) => `/api/cli/requests/${encodeURIComponent(userCode)}`;

/**
 * The `nitpilot login` waiting on the approve page (`GET /api/cli/requests/:userCode`). The page counts down to
 * `expiresAt` on its own. Coming back to the tab reads it again (TanStack's default), so a login decided in another
 * tab shows here too. `enabled` waits until we know someone is signed in.
 */
export function useCliRequest(userCode: string, enabled: boolean) {
  return useQuery({
    queryKey: ['cli-request', userCode],
    queryFn: () => api.get(path(userCode), CliRequestView),
    enabled,
  });
}

/** Approve or Deny. The server answers the login as it is now, which replaces what the page shows. */
export function useDecideCliRequest(userCode: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decision: CliRequestDecision['decision']) => api.send('POST', path(userCode), { decision } satisfies CliRequestDecision, CliRequestView),
    onSuccess: (view) => queryClient.setQueryData(['cli-request', userCode], view),
  });
}
