import type { ServerToWeb } from '@nitpilot/protocol';
import { useQuery } from '@tanstack/react-query';

/** What an agent is doing right now, from its CLI's `job.progress` (spec §10). Never stored: gone once the work is. */
export type Progress = Extract<ServerToWeb, { t: 'job.progress' }>['d'];

/** Where a chat's progress line lives in the data cache. Only `/ws/web` writes it (live/apply.ts). */
export const progressKey = (chatId: string) => ['progress', chatId] as const;

/** The chat's live progress line, or null when no agent is at work. */
export function useProgress(chatId: string): Progress | null {
  const { data } = useQuery({ queryKey: progressKey(chatId), queryFn: () => null, enabled: false, staleTime: Infinity });
  return data ?? null;
}
