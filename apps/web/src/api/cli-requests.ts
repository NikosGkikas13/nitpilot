import { CliRequestView, type CliRequestDecision } from '@nitpilot/protocol';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';

const path = (userCode: string) => `/api/cli/requests/${encodeURIComponent(userCode)}`;

/**
 * The `nitpilot login` waiting on the approve page (`GET /api/cli/requests/:userCode`). The page counts down to
 * `expiresAt` on its own. Coming back to the tab reads it again (TanStack's default), so a login decided in another
 * tab shows here too. `enabled` waits until we know someone is signed in.
 */
export function useCliRequest(userCode: string, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['cli-request', userCode],
    queryFn: () => api.get(path(userCode), CliRequestView).catch((err: unknown) => signedOutOrThrow(err, queryClient)),
    enabled,
  });
}

/** Approve or Deny. The server answers the login as it is now, which replaces what the page shows. */
export function useDecideCliRequest(userCode: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (decision: CliRequestDecision['decision']) => api.send('POST', path(userCode), { decision } satisfies CliRequestDecision, CliRequestView),
    onSuccess: (view) => queryClient.setQueryData(['cli-request', userCode], view),
    onError: (err) => {
      if (isUnauthorized(err)) void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

const isUnauthorized = (err: unknown) => err instanceof ApiError && err.status === 401;

/**
 * The session ended while the page was open (signed out in another tab). Read `me` again: it answers signed out, and
 * the page sends the browser to GitHub sign-in instead of offering a Try again that would be refused forever.
 */
function signedOutOrThrow(err: unknown, queryClient: QueryClient): never {
  if (isUnauthorized(err)) void queryClient.invalidateQueries({ queryKey: ['me'] });
  throw err;
}
