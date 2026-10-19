import { DevicesResponse, Settings, type DeviceView, type WebMe } from '@nitpilot/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toast/Toast';
import { api } from './client';

/** Your computers (`GET /api/devices`), as the Settings page lists them. A `me.update` reads them again (live/apply.ts). */
export function useDevices() {
  return useQuery({
    queryKey: ['devices'],
    queryFn: async (): Promise<DeviceView[]> => (await api.get('/api/devices', DevicesResponse)).devices,
  });
}

/**
 * Revoke one computer (`DELETE /api/devices/:id`): its CLI is signed out at once and has to log in again. No Undo: the
 * token is gone. Either way the list is read again, so it shows what the server has.
 */
export function useRevokeDevice() {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.send('DELETE', `/api/devices/${encodeURIComponent(id)}`),
    onSuccess: () => toast.show('Revoked. That computer has to log in again.'),
    onError: (err) => toast.show(err.message, { error: true }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });
}

/**
 * Save your settings (`PUT /api/me/settings`), the whole of them at once. The server's answer goes into `['me']`,
 * which every page reads; a refusal is said in a toast and `['me']` is read again.
 */
export function useSaveSettings() {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: Settings) => api.send('PUT', '/api/me/settings', settings, Settings),
    onSuccess: (saved) => queryClient.setQueryData<WebMe | null>(['me'], (old) => (old ? { ...old, settings: saved } : old)),
    onError: (err) => {
      toast.show(err.message, { error: true });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
