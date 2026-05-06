import { QueryClient } from '@tanstack/react-query';

/**
 * Shared react-query client. Conservative defaults for an internal-tool UX:
 * - one retry on transient failures (no thundering herd on 4xx)
 * - no refetch-on-focus (avoids surprise reloads while editing forms)
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});
