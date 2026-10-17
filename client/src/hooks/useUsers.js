import { useQuery } from '@tanstack/react-query';

import * as authApi from '../api/auth';

/**
 * Takers and accounters are needed by the order form and the bulk-send sheet.
 * They change rarely, so cache them for a few minutes rather than refetching
 * every time a sheet opens.
 */
export function useTakers(enabled = true) {
  return useQuery({
    queryKey: ['takers'],
    queryFn: authApi.fetchTakers,
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useAccounters(enabled = true) {
  return useQuery({
    queryKey: ['accounters'],
    queryFn: authApi.fetchAccounters,
    staleTime: 5 * 60_000,
    enabled,
  });
}
