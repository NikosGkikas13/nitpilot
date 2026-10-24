import { FirstRunManifestResponse, FirstRunStatus, type FirstRunManifestRequest } from '@nitpilot/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './client';

/** How often the page asks again while the server restarts after GitHub made its app. */
export const RESTART_POLL_MS = 2_000;

/** Which mode the server is in (`GET /api/first-run`): waiting to be set up, or ready with its app. */
export function useFirstRunStatus() {
  return useQuery({ queryKey: ['first-run'], queryFn: () => api.get('/api/first-run', FirstRunStatus) });
}

/**
 * The same question, every 2 seconds, while the server restarts into normal mode (spec §10 "First-run mode"). Until
 * the restart it still answers `first_run`; during it, nothing answers, or a proxy answers with its own error page.
 * All of those just mean "not yet", so a failed read is `null` rather than an error. It stops once the server is ready.
 */
export function useRestartedServer() {
  return useQuery({
    queryKey: ['first-run', 'restart'],
    queryFn: () => api.get('/api/first-run', FirstRunStatus).catch(() => null),
    refetchInterval: (query) => (query.state.data?.mode === 'ready' ? false : RESTART_POLL_MS),
  });
}

/** Trade the setup code and the person's choices for the manifest, and where the page posts it (GitHub). */
export function useManifest() {
  return useMutation({
    mutationFn: (request: FirstRunManifestRequest) => api.send('POST', '/api/first-run/manifest', request, FirstRunManifestResponse),
  });
}
