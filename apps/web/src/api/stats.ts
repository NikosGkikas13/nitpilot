import { StatsResponse, type StatsDays } from '@nitpilot/protocol';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client';

/** How your agent's reviews went over the last `days` days (spec §10 "Stats"). Keeps the old numbers while a new window loads. */
export function useStats(days: StatsDays) {
  return useQuery({
    queryKey: ['stats', days],
    queryFn: () => api.get(`/api/me/stats?days=${days}`, StatsResponse),
    placeholderData: keepPreviousData,
  });
}
